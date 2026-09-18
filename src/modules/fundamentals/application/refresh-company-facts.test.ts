import { describe, expect, it, vi } from "vitest";

import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemoryRefreshStateStore } from "@/modules/ingestion/infrastructure/in-memory-refresh-state-store";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  ingestionRunSchema,
  type IngestionRun,
  type IngestionRunStatus,
} from "@/modules/ingestion/domain/ingestion-run";

import {
  FIXTURE_ACCEPTED_AT,
  FIXTURE_ACCESSIONS,
  FIXTURE_FILER_CIK,
} from "../infrastructure/fixture-sec-filer";
import type { SecFiling } from "../domain/parse-sec-submissions";
import {
  CompanyFactsSourceError,
  type CompanyFactsProbe,
  type CompanyFactsProbeSource,
} from "./company-facts-source";
import { COMPANY_FACTS_DATASET_ID } from "./ingest-company-facts";
import type { IngestCompanyFactsOutcome } from "./ingest-company-facts";
import { refreshCompanyFacts } from "./refresh-company-facts";

const CLOCK = "2026-09-18T12:00:00.000Z";
const STATE_KEY = {
  sourceId: "sec-edgar",
  datasetId: COMPANY_FACTS_DATASET_ID,
  subjectKey: FIXTURE_FILER_CIK,
};

const QUARTER: SecFiling = {
  accessionNumber: FIXTURE_ACCESSIONS.q2Filing,
  form: "10-Q",
  filingDate: "2010-08-04",
  reportDate: "2010-06-30",
  acceptedAt: FIXTURE_ACCEPTED_AT.q2Filing,
};

const NEW_ANNUAL: SecFiling = {
  accessionNumber: "0000000042-11-000009",
  form: "10-K",
  filingDate: "2011-02-22",
  reportDate: "2010-12-31",
  acceptedAt: "2011-02-22T21:30:00.000Z",
};

function createIds() {
  let sequence = 0;

  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  };
}

function probeSourceFor(
  filings: readonly SecFiling[],
): CompanyFactsProbeSource {
  return {
    probe: vi.fn(async (cik: string): Promise<CompanyFactsProbe> => ({
      cik,
      filings,
      filingRejections: [],
      fetchedAt: CLOCK,
      document: {
        kind: "submissions",
        url: `https://data.sec.gov/submissions/CIK${cik}.json`,
        fetchedAt: CLOCK,
        byteLength: 1024,
        parserVersion: "sec-submissions-1.0.0",
      },
    })),
  };
}

function ingestionRun(status: IngestionRunStatus, runId: string): IngestionRun {
  return ingestionRunSchema.parse({
    runId,
    sourceId: "sec-edgar",
    datasetId: COMPANY_FACTS_DATASET_ID,
    parserVersion: "sec-companyfacts-1.0.0",
    idempotencyKey: "a".repeat(64),
    requestedAsOf: null,
    requestedVintage: null,
    cursor: null,
    nextCursor: null,
    subjectKey: FIXTURE_FILER_CIK,
    selectionVersion: "sec-core-concepts-2.0.0",
    selectionAnchorOn: null,
    status,
    startedAt: CLOCK,
    finishedAt: CLOCK,
    counts:
      status === "failed"
        ? { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 }
        : status === "duplicate"
          ? { fetched: 1, accepted: 0, rejected: 0, duplicate: 1 }
          : { fetched: 1, accepted: 1, rejected: 0, duplicate: 0 },
    contentHash: status === "failed" ? null : "b".repeat(64),
    failure:
      status === "failed"
        ? {
            code: "provider_error",
            message: "la SEC no contestó",
            retryable: true,
          }
        : null,
    qualityFlags: [],
    replayOfRunId: null,
    recordedAt: CLOCK,
  });
}

function outcomeFor(
  status: IngestionRunStatus,
  runId: string,
): IngestCompanyFactsOutcome {
  return {
    persisted: true,
    run: ingestionRun(status, runId),
    legalEntityId: null,
    documents: [],
    wire: null,
    window: null,
    vintages: null,
    rejections: [],
    stagingRejections: 0,
    sourceDocuments: null,
    publication: null,
  };
}

function createHarness(
  options: {
    filings?: readonly SecFiling[];
    ingestStatus?: IngestionRunStatus;
    probeSource?: CompanyFactsProbeSource;
    registry?: typeof DEMO_SOURCE_REGISTRY;
  } = {},
) {
  const newId = createIds();
  const refreshState = createInMemoryRefreshStateStore();
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const probeSource =
    options.probeSource ?? probeSourceFor(options.filings ?? [QUARTER]);
  const ingest = vi.fn(async (cik: string) => {
    expect(cik).toBe(FIXTURE_FILER_CIK);
    return outcomeFor(options.ingestStatus ?? "succeeded", newId());
  });

  return {
    refreshState,
    ingestionRuns,
    probeSource,
    ingest,
    dependencies: {
      sourceRegistry: createInMemorySourceRegistryRepository(
        options.registry ?? DEMO_SOURCE_REGISTRY,
      ),
      ingestionRuns,
      refreshState,
      probeSource,
      ingest,
      now: () => CLOCK,
      newId,
    },
  };
}

const command = { cik: FIXTURE_FILER_CIK, mode: "personal" as const };

describe("refreshCompanyFacts", () => {
  it("la primera vuelta baja una vez y deja la marca escrita", async () => {
    const harness = createHarness();
    const outcome = await refreshCompanyFacts(command, harness.dependencies);

    expect(outcome.decision?.reason).toBe("never_probed");
    expect(harness.ingest).toHaveBeenCalledOnce();
    expect(outcome.probeRun.status).toBe("succeeded");
    expect(outcome.probeRun.datasetId).toBe("sec.submissions");
    expect(outcome.state).toMatchObject({
      ...STATE_KEY,
      watermarkAccession: FIXTURE_ACCESSIONS.q2Filing,
      watermarkAcceptedAt: FIXTURE_ACCEPTED_AT.q2Filing,
      lastCheckedAt: CLOCK,
      lastChangedAt: CLOCK,
    });
  });

  it("la vuelta siguiente sin novedades no baja nada y sólo avanza la mirada", async () => {
    const harness = createHarness();
    await refreshCompanyFacts(command, harness.dependencies);
    harness.ingest.mockClear();

    const outcome = await refreshCompanyFacts(command, harness.dependencies);

    expect(outcome.decision?.reason).toBe("up_to_date");
    expect(harness.ingest).not.toHaveBeenCalled();
    // El sondeo vio lo mismo que la vuelta anterior: es una repetición.
    expect(outcome.probeRun.status).toBe("duplicate");
    expect(outcome.state?.watermarkAccession).toBe(FIXTURE_ACCESSIONS.q2Filing);
    expect(outcome.state?.lastCheckedAt).toBe(CLOCK);
    // Dos vueltas, dos corridas de sondeo y ninguna de companyfacts.
    expect(
      await harness.ingestionRuns.list({
        sourceId: "sec-edgar",
        datasetId: "sec.submissions",
      }),
    ).toHaveLength(2);
  });

  it("una presentación relevante nueva vuelve a bajar y mueve la marca", async () => {
    const harness = createHarness();
    await refreshCompanyFacts(command, harness.dependencies);

    const next = createHarness({ filings: [QUARTER, NEW_ANNUAL] });
    // Arranca de la marca que dejó la vuelta anterior.
    await next.refreshState.record(
      (await harness.refreshState.find(STATE_KEY))!,
    );

    const outcome = await refreshCompanyFacts(command, next.dependencies);

    expect(outcome.decision?.reason).toBe("new_filing");
    expect(outcome.decision?.newFilings).toEqual([NEW_ANNUAL]);
    expect(next.ingest).toHaveBeenCalledOnce();
    expect(outcome.state?.watermarkAccession).toBe(NEW_ANNUAL.accessionNumber);
  });

  it("una ingesta que falla no mueve la marca", async () => {
    const harness = createHarness({ ingestStatus: "failed" });
    const outcome = await refreshCompanyFacts(command, harness.dependencies);

    expect(harness.ingest).toHaveBeenCalledOnce();
    expect(outcome.state).toBeNull();
    await expect(harness.refreshState.find(STATE_KEY)).resolves.toBeNull();
  });

  it("una ingesta sin nada nuevo que publicar igual deja al filer al día", async () => {
    const harness = createHarness({ ingestStatus: "duplicate" });
    const outcome = await refreshCompanyFacts(command, harness.dependencies);

    expect(outcome.state?.watermarkAccession).toBe(FIXTURE_ACCESSIONS.q2Filing);
  });

  it("el dry run sondea pero no escribe", async () => {
    const harness = createHarness();
    const outcome = await refreshCompanyFacts(
      { ...command, dryRun: true },
      harness.dependencies,
    );

    expect(outcome.persisted).toBe(false);
    expect(outcome.decision?.refresh).toBe(true);
    expect(harness.ingest).not.toHaveBeenCalled();
    await expect(harness.refreshState.find(STATE_KEY)).resolves.toBeNull();
    await expect(
      harness.ingestionRuns.list({
        sourceId: "sec-edgar",
        datasetId: "sec.submissions",
      }),
    ).resolves.toEqual([]);
  });

  it("sin derechos aprobados no sondea", async () => {
    const harness = createHarness({
      registry: DEMO_SOURCE_REGISTRY.map((entry) =>
        entry.sourceId === "sec-edgar"
          ? {
              ...entry,
              rights: { ...entry.rights, automatedAccess: "unknown" as const },
            }
          : entry,
      ),
    });

    const outcome = await refreshCompanyFacts(command, harness.dependencies);

    expect(outcome.probeRun.status).toBe("failed");
    expect(outcome.probeRun.failure?.code).toBe("rights_not_approved");
    expect(harness.probeSource.probe).not.toHaveBeenCalled();
    expect(harness.ingest).not.toHaveBeenCalled();
  });

  it("un índice que no se entiende se cuarentena y no dispara ninguna descarga", async () => {
    const harness = createHarness({
      probeSource: {
        probe: vi.fn(async () => {
          throw new CompanyFactsSourceError(
            "payload_schema_invalid",
            "submissions",
            { detail: "column_missing" },
          );
        }),
      },
    });

    const outcome = await refreshCompanyFacts(command, harness.dependencies);

    expect(outcome.probeRun.status).toBe("quarantined");
    expect(outcome.probeRun.qualityFlags).toContain(
      "submissions_payload_schema_invalid",
    );
    expect(harness.ingest).not.toHaveBeenCalled();
    await expect(harness.refreshState.find(STATE_KEY)).resolves.toBeNull();
  });
});
