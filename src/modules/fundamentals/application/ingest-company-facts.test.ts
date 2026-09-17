import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import {
  sourceRegistryEntrySchema,
  type SourceRegistryEntry,
} from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import type { ObservationRepository } from "@/modules/observations/application/observation-repository";
import { queryObservations } from "@/modules/observations/domain/select-observations";
import { createInMemoryObservationRepository } from "@/modules/observations/infrastructure/in-memory-observation-repository";
import { createInMemorySourceDocumentRepository } from "@/modules/observations/infrastructure/in-memory-source-document-repository";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import { SEC_COMPANY_FACTS_PARSER_VERSION } from "../domain/parse-sec-company-facts";
import { SEC_SUBMISSIONS_PARSER_VERSION } from "../domain/parse-sec-submissions";
import { SEC_FACT_RULES_VERSION } from "../domain/sec-fact-rules";
import {
  buildFixtureCompanyFactsText,
  buildFixtureFilerGraph,
  buildFixtureSubmissions,
  buildFixtureSubmissionsHistory,
  FIXTURE_ACCEPTED_AT,
  FIXTURE_ACCESSIONS,
  FIXTURE_FILER_CIK,
  FIXTURE_FILER_ENTITY_ID,
  FIXTURE_HISTORY_FILE,
  FIXTURE_RECENT_FILINGS,
} from "../infrastructure/fixture-sec-filer";
import type { CompanyFactsSource } from "./company-facts-source";
import {
  COMPANY_FACTS_PIPELINE,
  ingestCompanyFacts,
  SubjectNotInUniverseError,
} from "./ingest-company-facts";
import {
  buildCompanyFactsUrl,
  buildSubmissionsUrl,
  createLiveCompanyFactsSource,
} from "./live-company-facts-source";

const CLOCK = "2026-09-14T15:00:00.000Z";
const SUBJECT = {
  subjectType: "legal_entity" as const,
  subjectId: FIXTURE_FILER_ENTITY_ID,
};

type Documents = {
  submissions: string;
  companyFacts: { status: number; body: string };
  history: string;
  /** Archivo histórico anterior, servido sólo si el test lo define. */
  olderHistory?: string;
};

const OLDER_HISTORY_FILE = "CIK0000000042-submissions-002.json";
const OLD_ANNUAL = "0000000042-04-000003";
const OLD_ANNUAL_ACCEPTED_AT = "2004-03-01T21:02:03.000Z";

function wire(overrides: Partial<Documents> = {}): Documents {
  return {
    submissions: JSON.stringify(buildFixtureSubmissions()),
    companyFacts: { status: 200, body: buildFixtureCompanyFactsText() },
    history: JSON.stringify(buildFixtureSubmissionsHistory()),
    ...overrides,
  };
}

function egressFor(documents: () => Documents) {
  const encoder = new TextEncoder();

  return vi.fn<EgressFetch>(async ({ url }) => {
    const current = documents();
    const [status, text] =
      url === buildSubmissionsUrl(FIXTURE_FILER_CIK)
        ? [200, current.submissions]
        : url === buildCompanyFactsUrl(FIXTURE_FILER_CIK)
          ? [current.companyFacts.status, current.companyFacts.body]
          : url === `https://data.sec.gov/submissions/${FIXTURE_HISTORY_FILE}`
            ? [200, current.history]
            : url ===
                  `https://data.sec.gov/submissions/${OLDER_HISTORY_FILE}` &&
                current.olderHistory !== undefined
              ? [200, current.olderHistory]
              : [599, ""];
    const body = encoder.encode(text);

    return { status, body, byteLength: body.byteLength, fetchedAt: CLOCK };
  });
}

function createIds() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  };
}

function createHarness(
  options: {
    registry?: readonly SourceRegistryEntry[];
    observations?: ObservationRepository;
  } = {},
) {
  let documents = wire();
  const fetch = egressFor(() => documents);
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const sourceDocuments = createInMemorySourceDocumentRepository();
  const observations =
    options.observations ?? createInMemoryObservationRepository();
  const source = createLiveCompanyFactsSource({ fetch });
  const newId = createIds();

  const dependencies = {
    sourceRegistry: createInMemorySourceRegistryRepository(
      options.registry ?? DEMO_SOURCE_REGISTRY,
    ),
    ingestionRuns,
    sourceDocuments,
    observations,
    identity: createGraphIdentityResolver(buildFixtureFilerGraph),
    source,
    now: () => CLOCK,
    newId,
  };

  return {
    fetch,
    ingestionRuns,
    sourceDocuments,
    observations,
    dependencies,
    serve(next: Partial<Documents>) {
      documents = wire(next);
    },
    ingest(overrides: { dryRun?: boolean; cik?: string } = {}) {
      return ingestCompanyFacts(
        {
          cik: overrides.cik ?? "42",
          mode: "personal",
          dryRun: overrides.dryRun,
        },
        dependencies,
      );
    },
  };
}

function asKnown(knownAt: string) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: "2011-01-01T00:00:00.000Z",
    revisionPolicy: "as_known",
    knownAt,
    sourcePolicyVersion: "source-policy-1.0.0",
  });
}

/**
 * Un 10-K de 2004 que sólo aparece en un archivo histórico anterior, con el
 * ejercicio 2003: seis años antes del ancla del filer sintético (2009-12-31).
 */
function withOldAnnualReport(points: {
  readonly netIncome?: boolean;
  readonly eps?: boolean;
}): Partial<Documents> {
  const submissions = buildFixtureSubmissions() as {
    filings: { files: unknown[] };
  };
  submissions.filings.files.push({
    name: OLDER_HISTORY_FILE,
    filingCount: 1,
    filingFrom: "2004-01-02",
    filingTo: "2004-12-30",
  });
  const point = (val: number) => ({
    start: "2003-01-01",
    end: "2003-12-31",
    val,
    accn: OLD_ANNUAL,
    fy: 2003,
    fp: "FY",
    form: "10-K",
    filed: "2004-03-01",
  });

  return {
    submissions: JSON.stringify(submissions),
    companyFacts: {
      status: 200,
      body: buildFixtureCompanyFactsText({
        extraPoints: {
          ...(points.netIncome === true
            ? { "USD@NetIncomeLoss": [point(21000000)] }
            : {}),
          ...(points.eps === true
            ? { "USD/shares@EarningsPerShareBasic": [point(0.42)] }
            : {}),
        },
      }),
    },
    olderHistory: JSON.stringify({
      accessionNumber: [OLD_ANNUAL],
      filingDate: ["2004-03-01"],
      reportDate: ["2003-12-31"],
      acceptanceDateTime: [OLD_ANNUAL_ACCEPTED_AT],
      act: ["34"],
      form: ["10-K"],
      size: [1],
    }),
  };
}

// `TM-08`: la ingesta sólo sale por el `EgressFetch` inyectado.
const globalFetch = vi.spyOn(globalThis, "fetch");

describe("ingestCompanyFacts", () => {
  beforeEach(() => {
    globalFetch.mockClear();
  });

  it("pins the pipeline components behind the recorded parser version", () => {
    // Cambiar un parser o una regla sin subir `parserVersion` rompe acá.
    expect(COMPANY_FACTS_PIPELINE).toStrictEqual({
      parserVersion: "sec-companyfacts-1.0.0",
      components: {
        companyFacts: "sec-companyfacts-1.0.0",
        submissions: "sec-submissions-1.0.0",
        factRules: "sec-fact-rules-1.0.0",
      },
    });
    expect([
      SEC_COMPANY_FACTS_PARSER_VERSION,
      SEC_SUBMISSIONS_PARSER_VERSION,
      SEC_FACT_RULES_VERSION,
    ]).toStrictEqual(Object.values(COMPANY_FACTS_PIPELINE.components));
  });

  it("publishes a filer's facts as point-in-time observations with their filings", async () => {
    const harness = createHarness();
    const outcome = await harness.ingest();

    expect(outcome.persisted).toBe(true);
    expect(outcome.legalEntityId).toBe(FIXTURE_FILER_ENTITY_ID);
    expect(outcome.run).toMatchObject({
      status: "succeeded",
      sourceId: "sec-edgar",
      datasetId: "sec.companyfacts",
      parserVersion: "sec-companyfacts-1.0.0",
      subjectKey: FIXTURE_FILER_CIK,
      selectionVersion: "sec-core-concepts-2.0.0",
      selectionAnchorOn: "2009-12-31",
      counts: { fetched: 7, accepted: 7, rejected: 0, duplicate: 0 },
    });
    expect(outcome.window).toStrictEqual({
      window: {
        version: "sec-history-5fy-1.0.0",
        anchorOn: "2009-12-31",
        anchorBasis: "annual_report",
        periodsEndingFrom: "2004-12-17",
        evidencePeriodsEndingFrom: "2003-12-17",
      },
      counts: { points: 8, kept: 8, outside: 0 },
    });
    expect(outcome.publication).toStrictEqual({
      published: 7,
      restated: 1,
      duplicates: 0,
      rejections: {},
    });
    expect(outcome.sourceDocuments?.inserted).toHaveLength(4);
    expect(globalFetch).not.toHaveBeenCalled();

    const stored = await harness.observations.list(SUBJECT);

    expect(stored).toHaveLength(7);
    expect(
      stored.every(
        (observation) => observation.ingestionRunId === outcome.run.runId,
      ),
    ).toBe(true);

    const [amendment] = await harness.sourceDocuments.findByIds({
      sourceId: "sec-edgar",
      sourceDocumentIds: [FIXTURE_ACCESSIONS.amendment],
    });

    expect(amendment).toMatchObject({
      documentType: "10-K/A",
      acceptedAt: FIXTURE_ACCEPTED_AT.amendment,
      subjectId: FIXTURE_FILER_ENTITY_ID,
      ingestionRunId: outcome.run.runId,
    });
  });

  it("answers as_known before the amendment with the original value", async () => {
    const harness = createHarness();
    await harness.ingest();

    const stored = await harness.observations.list({
      ...SUBJECT,
      metricIds: ["us-gaap:Assets"],
    });
    const assetsAt = (knownAt: string) =>
      queryObservations(
        stored,
        { ...SUBJECT, metricIds: ["us-gaap:Assets"] },
        asKnown(knownAt),
      )[0]?.rawValue ?? null;

    // Antes del 10-Q que lo reveló, no se conocía.
    expect(assetsAt("2009-11-03T21:15:10.000Z")).toBeNull();
    expect(assetsAt("2009-11-03T21:15:11.000Z")).toBe("412000000");
    // `TM-06`: la 10-K/A no se filtra hacia atrás.
    expect(assetsAt("2010-05-12T20:05:13.000Z")).toBe("412000000");
    expect(assetsAt("2010-05-12T20:05:14.000Z")).toBe("396500000");
  });

  it("writes nothing on a dry run and still reports what it would publish", async () => {
    const harness = createHarness();
    const outcome = await harness.ingest({ dryRun: true });

    expect(outcome.persisted).toBe(false);
    expect(outcome.run.status).toBe("succeeded");
    expect(outcome.vintages).toMatchObject({ vintages: 7, restated: 1 });
    await expect(
      harness.ingestionRuns.list({ sourceId: "sec-edgar" }),
    ).resolves.toHaveLength(0);
    await expect(harness.observations.list(SUBJECT)).resolves.toHaveLength(0);
  });

  it("blocks a source without approved rights before any egress", async () => {
    const blocked = DEMO_SOURCE_REGISTRY.map((entry) =>
      entry.sourceId === "sec-edgar"
        ? sourceRegistryEntrySchema.parse({
            ...entry,
            approvalStatus: "rights_review_pending",
          })
        : entry,
    );
    const harness = createHarness({ registry: blocked });
    const outcome = await harness.ingest();

    expect(outcome.run).toMatchObject({
      status: "failed",
      failure: { code: "rights_not_approved" },
      qualityFlags: ["rights_blocked"],
    });
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it("refuses a CIK the universe does not know, without traffic or a run", async () => {
    const harness = createHarness();

    await expect(harness.ingest({ cik: "43" })).rejects.toBeInstanceOf(
      SubjectNotInUniverseError,
    );
    expect(harness.fetch).not.toHaveBeenCalled();
    await expect(
      harness.ingestionRuns.list({ sourceId: "sec-edgar" }),
    ).resolves.toHaveLength(0);
  });

  it("records an unchanged document as a duplicate and publishes nothing new", async () => {
    const harness = createHarness();
    const first = await harness.ingest();
    const second = await harness.ingest();

    expect(second.run).toMatchObject({
      status: "duplicate",
      replayOfRunId: first.run.runId,
      counts: { fetched: 7, accepted: 0, rejected: 0, duplicate: 7 },
    });
    expect(second.publication).toMatchObject({ published: 0, duplicates: 7 });
    await expect(harness.observations.list(SUBJECT)).resolves.toHaveLength(7);
  });

  it("keeps pointing at the original run on a third look at unchanged content", async () => {
    // Con el reloj fijo las tres corridas empatan y el orden estable escondía el
    // defecto: la más reciente tiene que ser una `duplicate` para verlo.
    const harness = createHarness();
    let tick = 0;
    const dependencies = {
      ...harness.dependencies,
      now: () => new Date(Date.parse(CLOCK) + 1000 * tick++).toISOString(),
    };
    const ingest = () =>
      ingestCompanyFacts({ cik: "42", mode: "personal" }, dependencies);

    const first = await ingest();
    const second = await ingest();
    const third = await ingest();

    expect(second.run).toMatchObject({
      status: "duplicate",
      replayOfRunId: first.run.runId,
    });
    expect(third.run).toMatchObject({
      status: "duplicate",
      replayOfRunId: first.run.runId,
    });
    expect(third.publication).toMatchObject({ published: 0, duplicates: 7 });
    await expect(
      harness.ingestionRuns.findByIdempotencyKey(first.run.idempotencyKey),
    ).resolves.toMatchObject({ runId: first.run.runId });
  });

  it("quarantines a broken document and leaves the last valid batch untouched", async () => {
    const harness = createHarness();
    await harness.ingest();
    const before = await harness.observations.list(SUBJECT);

    harness.serve({
      companyFacts: { status: 200, body: '{"cik": 42, "facts": []}' },
    });
    const broken = await harness.ingest();

    // `TM-05`: cuarentena, sin publicación y sin reemplazar lo que había.
    expect(broken.run).toMatchObject({
      status: "quarantined",
      counts: { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 },
      qualityFlags: ["companyfacts_payload_schema_invalid"],
    });
    expect(broken.publication).toBeNull();
    await expect(harness.observations.list(SUBJECT)).resolves.toStrictEqual(
      before,
    );
  });

  it("chains an amendment that arrives in a later download", async () => {
    const harness = createHarness();
    const withoutAmendment = buildFixtureCompanyFactsText({
      rawValues: { "Assets|2": "412000000" },
    });

    harness.serve({ companyFacts: { status: 200, body: withoutAmendment } });
    const first = await harness.ingest();
    harness.serve({});
    const second = await harness.ingest();

    expect(first.publication).toMatchObject({ published: 6, restated: 0 });
    expect(second.run.status).toBe("succeeded");
    expect(second.publication).toMatchObject({
      published: 1,
      restated: 1,
      duplicates: 6,
    });

    const chain = (
      await harness.observations.list({
        ...SUBJECT,
        metricIds: ["us-gaap:Assets"],
      })
    ).sort((left, right) => left.revisionNumber - right.revisionNumber);

    expect(
      chain.map((observation) => observation.ingestionRunId),
    ).toStrictEqual([first.run.runId, second.run.runId]);
    expect(chain[0]?.supersededAt).toBe(FIXTURE_ACCEPTED_AT.amendment);
  });

  it("completes a publication that was cut after its run was recorded", async () => {
    const observations = createInMemoryObservationRepository();
    const publish = vi
      .spyOn(observations, "publish")
      .mockRejectedValueOnce(new Error("connection lost"));
    const harness = createHarness({ observations });

    await expect(harness.ingest()).rejects.toThrow("connection lost");
    await expect(observations.list(SUBJECT)).resolves.toHaveLength(0);

    const retry = await harness.ingest();

    expect(retry.run.status).toBe("duplicate");
    expect(retry.publication).toMatchObject({ published: 7 });
    expect(publish).toHaveBeenCalledTimes(2);
    // Lo que se completó queda atribuido a la corrida que lo descargó primero.
    const stored = await observations.list(SUBJECT);
    expect(new Set(stored.map((o) => o.ingestionRunId))).toStrictEqual(
      new Set([retry.run.replayOfRunId]),
    );
  });

  it("neither publishes nor fetches the filing index of what is outside the history window", async () => {
    const harness = createHarness();
    harness.serve(withOldAnnualReport({ netIncome: true }));

    const outcome = await harness.ingest();

    expect(outcome.run).toMatchObject({
      status: "succeeded",
      selectionAnchorOn: "2009-12-31",
      counts: { fetched: 7, accepted: 7, rejected: 0, duplicate: 0 },
    });
    expect(outcome.window?.counts).toStrictEqual({
      points: 9,
      kept: 8,
      outside: 1,
    });
    // El único hecho que necesitaba el archivo de 2004 quedó afuera: no se pide.
    expect(harness.fetch.mock.calls.map(([request]) => request.url)).toEqual([
      buildSubmissionsUrl(FIXTURE_FILER_CIK),
      buildCompanyFactsUrl(FIXTURE_FILER_CIK),
      `https://data.sec.gov/submissions/${FIXTURE_HISTORY_FILE}`,
    ]);
    await expect(
      harness.observations.list({
        ...SUBJECT,
        metricIds: ["us-gaap:NetIncomeLoss"],
      }),
    ).resolves.toHaveLength(0);
  });

  it("keeps one more fiscal year of split evidence, with its filing's acceptance", async () => {
    const harness = createHarness();
    harness.serve(withOldAnnualReport({ netIncome: true, eps: true }));

    const outcome = await harness.ingest();

    expect(outcome.run).toMatchObject({
      status: "succeeded",
      counts: { fetched: 8, accepted: 8, rejected: 0, duplicate: 0 },
    });
    expect(outcome.window?.counts).toStrictEqual({
      points: 10,
      kept: 9,
      outside: 1,
    });
    expect(harness.fetch.mock.calls.map(([request]) => request.url)).toContain(
      `https://data.sec.gov/submissions/${OLDER_HISTORY_FILE}`,
    );

    const [eps] = await harness.observations.list({
      ...SUBJECT,
      metricIds: ["us-gaap:EarningsPerShareBasic"],
    });

    expect(eps).toMatchObject({
      periodEnd: "2003-12-31",
      rawValue: "0.42",
      availableAt: OLD_ANNUAL_ACCEPTED_AT,
      sourceDocumentId: OLD_ANNUAL,
    });
    await expect(
      harness.observations.list({
        ...SUBJECT,
        metricIds: ["us-gaap:NetIncomeLoss"],
      }),
    ).resolves.toHaveLength(0);
  });

  it("keeps the anchor on a duplicate run of unchanged content", async () => {
    const harness = createHarness();
    const first = await harness.ingest();
    const second = await harness.ingest();

    expect(second.run).toMatchObject({
      status: "duplicate",
      selectionAnchorOn: "2009-12-31",
      idempotencyKey: first.run.idempotencyKey,
      replayOfRunId: first.run.runId,
    });
  });

  it("records a filer without XBRL facts as an empty run", async () => {
    const harness = createHarness();
    harness.serve({ companyFacts: { status: 404, body: "" } });

    const outcome = await harness.ingest();

    expect(outcome.run).toMatchObject({
      status: "empty",
      qualityFlags: ["no_company_facts"],
      // Sin hechos no hay ancla: la corrida no leyó ningún período.
      selectionAnchorOn: null,
    });
    expect(outcome.window).toBeNull();
  });

  it("records a throttled source as a retryable failure", async () => {
    const harness = createHarness();
    harness.serve({ companyFacts: { status: 429, body: "" } });

    const outcome = await harness.ingest();

    expect(outcome.run).toMatchObject({
      status: "failed",
      failure: { code: "provider_error", retryable: true },
    });
  });

  it("rejects facts of an unreadable filing row instead of inferring their availability", async () => {
    const harness = createHarness();
    harness.serve({
      submissions: JSON.stringify(
        buildFixtureSubmissions({
          recent: FIXTURE_RECENT_FILINGS.map((filing) =>
            filing.accessionNumber === FIXTURE_ACCESSIONS.amendment
              ? { ...filing, acceptanceDateTime: "12/05/2010 16:05" }
              : filing,
          ),
        }),
      ),
    });

    const outcome = await harness.ingest();

    expect(outcome.run).toMatchObject({
      status: "partial",
      counts: { fetched: 7, accepted: 6, rejected: 1, duplicate: 0 },
      qualityFlags: ["partial_batch"],
    });
    expect(outcome.rejections.map((rejection) => rejection.code)).toStrictEqual(
      ["filing_conflict"],
    );
  });

  it("keeps the source independent: a fake source needs no egress at all", async () => {
    const harness = createHarness();
    const source: CompanyFactsSource = {
      load: vi.fn(async () => ({
        status: "no_company_facts" as const,
        cik: FIXTURE_FILER_CIK,
        fetchedAt: CLOCK,
        documents: [],
      })),
    };

    const outcome = await ingestCompanyFacts(
      { cik: FIXTURE_FILER_CIK, mode: "personal" },
      { ...harness.dependencies, source },
    );

    expect(outcome.run.status).toBe("empty");
    expect(harness.fetch).not.toHaveBeenCalled();
  });
});
