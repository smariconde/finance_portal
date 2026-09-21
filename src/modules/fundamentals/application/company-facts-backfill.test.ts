import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import {
  createPacedEgressFetch,
  RequestBudgetExhaustedError,
  type EgressFetch,
} from "@/modules/ingestion/application/egress-fetch";
import { SEC_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import type { IngestionJobItem } from "@/modules/ingestion/domain/ingestion-job";
import { sourceRegistryEntrySchema } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemoryIngestionJobStore } from "@/modules/ingestion/infrastructure/in-memory-ingestion-job-store";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceBudgetStore } from "@/modules/ingestion/infrastructure/in-memory-source-budget-store";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import { createInMemoryObservationRepository } from "@/modules/observations/infrastructure/in-memory-observation-repository";
import { createInMemorySourceDocumentRepository } from "@/modules/observations/infrastructure/in-memory-source-document-repository";

import {
  buildFixtureCompanyFactsText,
  buildFixtureFilerGraph,
  buildFixtureSubmissions,
  buildFixtureSubmissionsHistory,
  FIXTURE_FILER_CIK,
  FIXTURE_HISTORY_FILE,
} from "../infrastructure/fixture-sec-filer";
import {
  assertCompanyFactsJob,
  buildCompanyFactsJobPlan,
  CompanyFactsJobMismatchError,
  createCompanyFactsAdmission,
  createCompanyFactsJobExecutor,
  hasBudgetForCompanyFactsLoad,
  observeSourceSignals,
} from "./company-facts-backfill";
import { ingestCompanyFacts } from "./ingest-company-facts";
import {
  buildCompanyFactsUrl,
  buildSubmissionsUrl,
  createLiveCompanyFactsSource,
  MAX_REQUESTS_PER_COMPANY_FACTS_LOAD,
} from "./live-company-facts-source";

const CLOCK = "2026-09-16T12:00:00.000Z";
/** Un CIK que el grafo sintético no conoce. */
const UNKNOWN_CIK = "0000000043";

type Reply =
  | { readonly status: number; readonly retryAfter?: string }
  | { readonly throws: Error };

function respond(url: string): { status: number; text: string } {
  if (url === buildSubmissionsUrl(FIXTURE_FILER_CIK)) {
    return { status: 200, text: JSON.stringify(buildFixtureSubmissions()) };
  }

  if (url === buildCompanyFactsUrl(FIXTURE_FILER_CIK)) {
    return { status: 200, text: buildFixtureCompanyFactsText() };
  }

  if (url === `https://data.sec.gov/submissions/${FIXTURE_HISTORY_FILE}`) {
    return {
      status: 200,
      text: JSON.stringify(buildFixtureSubmissionsHistory()),
    };
  }

  return { status: 404, text: "" };
}

function egressError(code: string): Error {
  return Object.assign(new Error(`Egress blocked (${code}).`), { code });
}

describe("backfill de companyfacts", () => {
  /** Respuestas forzadas por URL, en orden; sin entrada, responde el filer sintético. */
  let overrides: Map<string, Reply[]>;
  let egress: ReturnType<typeof vi.fn<EgressFetch>>;
  let registry = DEMO_SOURCE_REGISTRY;

  beforeEach(() => {
    overrides = new Map();
    registry = DEMO_SOURCE_REGISTRY;
    egress = vi.fn<EgressFetch>(async ({ url }) => {
      const forced = overrides.get(url)?.shift();

      if (forced && "throws" in forced) {
        throw forced.throws;
      }

      const { status, text } = respond(url);
      const body = new TextEncoder().encode(forced ? "" : text);

      return {
        status: forced?.status ?? status,
        body,
        byteLength: body.byteLength,
        fetchedAt: CLOCK,
        retryAfter: forced?.retryAfter ?? null,
      };
    });
  });

  function force(url: string, ...replies: Reply[]) {
    overrides.set(url, replies);
  }

  function harness() {
    const signals = observeSourceSignals(egress);
    const ingestionRuns = createInMemoryIngestionRunRepository();
    const ingestion = {
      sourceRegistry: createInMemorySourceRegistryRepository(registry),
      ingestionRuns,
      sourceDocuments: createInMemorySourceDocumentRepository(),
      observations: createInMemoryObservationRepository(),
      identity: createGraphIdentityResolver(buildFixtureFilerGraph),
      source: createLiveCompanyFactsSource({ fetch: signals.fetch }),
      now: () => CLOCK,
      newId: randomUUID,
    };
    const execute = createCompanyFactsJobExecutor({
      ingest: (cik) =>
        ingestCompanyFacts({ cik, mode: "personal", dryRun: false }, ingestion),
      takeSignal: signals.take,
    });

    return { execute, ingestionRuns };
  }

  const item = (subjectKey: string): IngestionJobItem => ({
    jobId: "00000000-0000-4000-8000-000000000001",
    ordinal: 0,
    subjectKey,
    status: "running",
    attempts: 1,
    notBefore: null,
    leaseToken: "00000000-0000-4000-8000-000000000002",
    startedAt: CLOCK,
    finishedAt: null,
    ingestionRunId: null,
    lastFailure: null,
    updatedAt: CLOCK,
  });

  async function executeFor(subjectKey = FIXTURE_FILER_CIK) {
    const { execute } = harness();
    const job = createInMemoryIngestionJobStore({ newId: randomUUID });
    const { job: planned } = await job.createJob(
      buildCompanyFactsJobPlan([
        {
          cik: subjectKey,
          legalEntityId: randomUUID(),
          role: "index_member",
          symbols: [],
          successorLegalEntityId: null,
        },
      ]),
      { now: CLOCK },
    );

    return execute(item(subjectKey), planned);
  }

  describe("clasificación de un intento", () => {
    it("una corrida publicada es un intento completo", async () => {
      expect(await executeFor()).toMatchObject({ kind: "ingested" });
    });

    it("un 429 es una señal de la fuente y conserva el Retry-After", async () => {
      force(buildSubmissionsUrl(FIXTURE_FILER_CIK), {
        status: 429,
        retryAfter: "600",
      });

      expect(await executeFor()).toMatchObject({
        kind: "source_signal",
        signal: "throttled",
        retryAfter: "600",
        message: "status 429",
        ingestionRunId: expect.any(String),
      });
    });

    it("un 403 frena por la fuente y un 503 la da por no disponible", async () => {
      force(buildCompanyFactsUrl(FIXTURE_FILER_CIK), { status: 403 });
      expect(await executeFor()).toMatchObject({
        kind: "source_signal",
        signal: "refused",
      });

      force(buildCompanyFactsUrl(FIXTURE_FILER_CIK), { status: 503 });
      expect(await executeFor()).toMatchObject({
        kind: "source_signal",
        signal: "unavailable",
      });
    });

    it("la red caída es de la fuente; un documento demasiado grande es del filer", async () => {
      force(buildSubmissionsUrl(FIXTURE_FILER_CIK), {
        throws: egressError("transport_error"),
      });
      expect(await executeFor()).toMatchObject({
        kind: "source_signal",
        signal: "unavailable",
        message: "transport_error",
      });

      force(buildSubmissionsUrl(FIXTURE_FILER_CIK), {
        throws: egressError("path_not_allowlisted"),
      });
      expect(await executeFor()).toMatchObject({
        kind: "source_signal",
        signal: "refused",
      });

      force(buildCompanyFactsUrl(FIXTURE_FILER_CIK), {
        throws: egressError("response_too_large"),
      });
      expect(await executeFor()).toMatchObject({
        kind: "ingestion_failed",
        retryable: false,
      });
    });

    it("un 5xx de un documento se reintenta como fallo de la corrida", async () => {
      force(buildCompanyFactsUrl(FIXTURE_FILER_CIK), { status: 502 });

      expect(await executeFor()).toMatchObject({
        kind: "ingestion_failed",
        retryable: true,
        message: expect.stringContaining("provider_error"),
      });
    });

    it("un filer que el universo no conoce se rechaza sin salir a la red", async () => {
      expect(await executeFor(UNKNOWN_CIK)).toMatchObject({
        kind: "subject_rejected",
        message: expect.stringContaining(UNKNOWN_CIK),
      });
      expect(egress).not.toHaveBeenCalled();
    });

    it("derechos sin aprobar frenan el job en vez de fallar cada empresa", async () => {
      registry = DEMO_SOURCE_REGISTRY.map((entry) =>
        entry.sourceId === "sec-edgar"
          ? sourceRegistryEntrySchema.parse({
              ...entry,
              approvalStatus: "rights_review_pending",
              rights: { ...entry.rights, automatedAccess: "unknown" },
            })
          : entry,
      );

      expect(await executeFor()).toMatchObject({
        kind: "source_signal",
        signal: "refused",
        message: "rights_not_approved",
      });
      expect(egress).not.toHaveBeenCalled();
    });

    it("una señal de un intento anterior no contamina al siguiente", async () => {
      const signals = observeSourceSignals(async () => {
        throw egressError("transport_error");
      });

      await expect(
        signals.fetch({ sourceId: "sec-edgar", url: "https://data.sec.gov/x" }),
      ).rejects.toThrow();

      const execute = createCompanyFactsJobExecutor({
        ingest: async () => {
          throw new TypeError("boom");
        },
        takeSignal: signals.take,
      });

      await expect(
        execute(item(FIXTURE_FILER_CIK), {} as never),
      ).rejects.toThrow("boom");
    });

    it("guarda la primera señal de una carga, no la última", async () => {
      const signals = observeSourceSignals(async (request) => {
        const status = request.url.endsWith("a") ? 429 : 503;
        return {
          status,
          body: new Uint8Array(),
          byteLength: 0,
          fetchedAt: CLOCK,
        };
      });

      await signals.fetch({
        sourceId: "sec-edgar",
        url: "https://data.sec.gov/a",
      });
      await signals.fetch({
        sourceId: "sec-edgar",
        url: "https://data.sec.gov/b",
      });

      expect(signals.take()?.kind).toBe("throttled");
      expect(signals.take()).toBeNull();
    });
  });

  describe("job de punta a punta", () => {
    it("un 429 frena el job sin gastar el intento y la corrida siguiente lo completa", async () => {
      const { execute, ingestionRuns } = harness();
      const store = createInMemoryIngestionJobStore({ newId: randomUUID });
      const { job } = await store.createJob(
        buildCompanyFactsJobPlan([
          {
            cik: FIXTURE_FILER_CIK,
            legalEntityId: randomUUID(),
            role: "index_member",
            symbols: [],
            successorLegalEntityId: null,
          },
          {
            cik: UNKNOWN_CIK,
            legalEntityId: randomUUID(),
            role: "index_member",
            symbols: [],
            successorLegalEntityId: null,
          },
        ]),
        { now: CLOCK },
      );
      let now = CLOCK;
      const dependencies = {
        store,
        execute,
        now: () => now,
        sleep: async () => undefined,
        newLeaseToken: randomUUID,
        startHeartbeat: () => () => undefined,
      };
      force(buildSubmissionsUrl(FIXTURE_FILER_CIK), { status: 429 });

      const throttled = await runIngestionJob(
        { jobId: job.jobId, holder: "worker-a" },
        dependencies,
      );

      expect(throttled.stopReason).toBe("source_signal");
      expect(throttled.waitUntil).toBe("2026-09-16T12:10:00.000Z");

      now = "2026-09-16T12:10:00.000Z";
      const resumed = await runIngestionJob(
        { jobId: job.jobId, holder: "worker-a" },
        dependencies,
      );

      expect(resumed.stopReason).toBe("completed");
      expect(
        resumed.attempts.map((attempt) => [
          attempt.subjectKey,
          attempt.attempt,
          attempt.decision.kind,
        ]),
      ).toEqual([
        [FIXTURE_FILER_CIK, 1, "complete"],
        [UNKNOWN_CIK, 1, "fail"],
      ]);

      const runs = await ingestionRuns.list({ sourceId: "sec-edgar" });
      expect(runs.map((run) => run.status).sort()).toEqual([
        "failed",
        "succeeded",
      ]);
    });
  });

  describe("guardas", () => {
    it("la reserva cubre el peor caso de una carga", () => {
      const policy = { minIntervalMs: 0, maxRequests: 100 };
      const paced = createPacedEgressFetch(egress, policy, {
        elapsedMs: () => 0,
        sleep: async () => undefined,
      });

      expect(MAX_REQUESTS_PER_COMPANY_FACTS_LOAD).toBe(66);
      expect(hasBudgetForCompanyFactsLoad(paced, policy)).toBe(true);
      expect(
        hasBudgetForCompanyFactsLoad(paced, { ...policy, maxRequests: 65 }),
      ).toBe(false);
    });

    it("la reserva evita que el presupuesto se agote a mitad de una empresa", async () => {
      const policy = { minIntervalMs: 0, maxRequests: 3 };
      const paced = createPacedEgressFetch(egress, policy, {
        elapsedMs: () => 0,
        sleep: async () => undefined,
      });

      await paced({
        sourceId: "sec-edgar",
        url: buildSubmissionsUrl(FIXTURE_FILER_CIK),
      });
      await paced({
        sourceId: "sec-edgar",
        url: buildSubmissionsUrl(FIXTURE_FILER_CIK),
      });
      await paced({
        sourceId: "sec-edgar",
        url: buildSubmissionsUrl(FIXTURE_FILER_CIK),
      });

      await expect(
        paced({
          sourceId: "sec-edgar",
          url: buildSubmissionsUrl(FIXTURE_FILER_CIK),
        }),
      ).rejects.toBeInstanceOf(RequestBudgetExhaustedError);
      expect(hasBudgetForCompanyFactsLoad(paced, policy)).toBe(false);
    });

    it("no corre un job planeado con otra selección o pipeline", async () => {
      const store = createInMemoryIngestionJobStore({ newId: randomUUID });
      const plan = buildCompanyFactsJobPlan([
        {
          cik: FIXTURE_FILER_CIK,
          legalEntityId: randomUUID(),
          role: "index_member",
          symbols: [],
          successorLegalEntityId: null,
        },
      ]);
      const { job } = await store.createJob(plan, { now: CLOCK });

      expect(() => assertCompanyFactsJob(job)).not.toThrow();
      expect(job.selectionVersion).toBe("sec-core-concepts-3.0.0");
      // Un job planeado antes de la ventana de historia bajaría otra cosa que
      // la que su plan nombra (ADR 0017).
      expect(() =>
        assertCompanyFactsJob({
          ...job,
          selectionVersion: "sec-core-concepts-1.0.0",
        }),
      ).toThrow(CompanyFactsJobMismatchError);
      expect(() =>
        assertCompanyFactsJob({
          ...job,
          parserVersion: "sec-companyfacts-0.9.0",
        }),
      ).toThrow(CompanyFactsJobMismatchError);
    });
  });
});

describe("admisión de una empresa", () => {
  const SEC = "sec-edgar";
  const NOW = "2026-09-18T10:00:00.000Z";

  function pacedDouble(requestCount: number) {
    return Object.assign(
      async () => {
        throw new Error("no debería salir a la red");
      },
      { requestCount: () => requestCount },
    );
  }

  it("admite mientras la corrida y el día cubran el peor caso de una empresa", async () => {
    const budgets = createInMemorySourceBudgetStore({ [SEC]: 2000 });
    const admit = createCompanyFactsAdmission({
      fetch: pacedDouble(0),
      pacing: SEC_REQUEST_PACING,
      budgets,
      now: () => NOW,
    });

    expect(await admit()).toEqual({ status: "ready" });
  });

  it("nombra el presupuesto de la corrida cuando es ese el que no alcanza", async () => {
    const budgets = createInMemorySourceBudgetStore({ [SEC]: 2000 });
    const admit = createCompanyFactsAdmission({
      // 1.000 − 66 + 1: no entra el peor caso de una empresa más.
      fetch: pacedDouble(SEC_REQUEST_PACING.maxRequests - 65),
      pacing: SEC_REQUEST_PACING,
      budgets,
      now: () => NOW,
    });

    expect(await admit()).toEqual({ status: "budget_reserve" });
  });

  it("nombra el día cuando lo que no alcanza es la cuota de la fuente", async () => {
    const budgets = createInMemorySourceBudgetStore({ [SEC]: 10 });
    const admit = createCompanyFactsAdmission({
      fetch: pacedDouble(0),
      pacing: SEC_REQUEST_PACING,
      budgets,
      now: () => NOW,
    });

    // Diez de cuota no cubren las 66 que una empresa puede necesitar.
    expect(await admit()).toEqual({
      status: "daily_budget_exhausted",
      resumesAt: "2026-09-19T00:00:00.000Z",
    });
  });

  it("nombra el kill switch, que gana sobre el presupuesto", async () => {
    const budgets = createInMemorySourceBudgetStore({ [SEC]: 2000 });

    await budgets.setControl({
      controlId: randomUUID(),
      sourceId: SEC,
      status: "disabled",
      dailyRequestLimit: null,
      reason: "sondeo manual en curso",
      actor: "owner",
      now: NOW,
    });

    const admit = createCompanyFactsAdmission({
      fetch: pacedDouble(0),
      pacing: SEC_REQUEST_PACING,
      budgets,
      now: () => NOW,
    });

    expect(await admit()).toEqual({
      status: "source_disabled",
      reason: "sondeo manual en curso",
    });
  });

  it("falla cerrado si la fuente no tiene presupuesto declarado", async () => {
    const admit = createCompanyFactsAdmission({
      fetch: pacedDouble(0),
      pacing: SEC_REQUEST_PACING,
      budgets: createInMemorySourceBudgetStore({}),
      now: () => NOW,
    });

    expect(await admit()).toMatchObject({ status: "source_disabled" });
  });
});
