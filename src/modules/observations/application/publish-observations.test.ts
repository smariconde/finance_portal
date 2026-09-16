import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import { identityGraphSchema } from "@/modules/identity/domain/identity-graph";
import { resolveIdentity } from "@/modules/identity/domain/resolve-identity";
import {
  DEMO_IDENTITY_GRAPH,
  DEMO_IDENTITY_IDS,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { executeIngestionRun } from "@/modules/ingestion/application/execute-ingestion-run";
import type { DatasetProvider } from "@/modules/ingestion/application/dataset-provider";
import {
  createDemoDatasetProvider,
  createDemoRestatedDatasetProvider,
} from "@/modules/ingestion/infrastructure/demo-dataset-provider";
import {
  DEMO_DATASETS,
  DEMO_PARSER_VERSION,
  DEMO_SOURCE_ID,
} from "@/modules/ingestion/infrastructure/demo-ingestion-fixtures";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import type { ObservationRepository } from "@/modules/observations/application/observation-repository";
import {
  PublicationNotAllowedError,
  publishObservations,
} from "@/modules/observations/application/publish-observations";
import { LATE_INGESTION_FLAG } from "@/modules/observations/domain/observation";
import { queryObservations } from "@/modules/observations/domain/select-observations";
import { createInMemoryObservationRepository } from "@/modules/observations/infrastructure/in-memory-observation-repository";
import {
  pointInTimeQuerySchema,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";

const RUN_CLOCK = "2026-08-24T10:00:00.000Z";
const PUBLISH_CLOCK = "2026-08-24T10:05:00.000Z";
const LATER_PUBLISH_CLOCK = "2026-08-24T11:00:00.000Z";

const SUBJECT = {
  subjectType: "legal_entity" as const,
  subjectId: DEMO_IDENTITY_IDS.fixtureCoEntity,
};

function createIds(prefix: string) {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${prefix}${String(sequence).padStart(10, "0")}`;
  };
}

function createHarness() {
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const observations = createInMemoryObservationRepository();
  const identity = createGraphIdentityResolver(() => DEMO_IDENTITY_GRAPH);

  async function ingest(
    provider: DatasetProvider,
    overrides: Record<string, unknown> = {},
  ) {
    return executeIngestionRun(
      {
        sourceId: DEMO_SOURCE_ID,
        datasetId: DEMO_DATASETS.annual,
        parserVersion: DEMO_PARSER_VERSION,
        requestedAsOf: "2024-12-31",
        ...overrides,
      },
      {
        sourceRegistry: createInMemorySourceRegistryRepository(),
        ingestionRuns,
        provider,
        now: () => RUN_CLOCK,
        newRunId: createIds("aa"),
      },
    );
  }

  async function publish(
    outcome: Awaited<ReturnType<typeof ingest>>,
    now = PUBLISH_CLOCK,
    repository: ObservationRepository = observations,
  ) {
    return publishObservations(
      outcome.run,
      outcome.records,
      { fetchedAt: outcome.fetchedAt!, mode: "personal" },
      {
        identity,
        observations: repository,
        now: () => now,
        newObservationId: createIds("bb"),
      },
    );
  }

  return { ingestionRuns, observations, identity, ingest, publish };
}

function query(overrides: Partial<PointInTimeQueryInput> = {}) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: "2025-06-01T00:00:00.000Z",
    revisionPolicy: "as_known",
    knownAt: "2025-06-01T00:00:00.000Z",
    sourcePolicyVersion: "source-policy-1.0.0",
    ...overrides,
  } as PointInTimeQueryInput);
}

// `TM-08`: publicar una observación no puede abrir red.
const fetchSpy = vi.spyOn(globalThis, "fetch");

describe("publishObservations", () => {
  beforeEach(() => {
    fetchSpy.mockClear();
  });

  it("publishes the fixture company with full identity and provenance", async () => {
    const harness = createHarness();
    const outcome = await harness.ingest(
      createDemoDatasetProvider(() => RUN_CLOCK),
    );

    const publication = await harness.publish(outcome);

    expect(publication.published).toHaveLength(5);
    expect(publication.rejections).toHaveLength(0);

    for (const observation of publication.published) {
      // El sujeto es la entidad legal interna, nunca el ticker de la fuente.
      expect(observation.subjectId).toBe(DEMO_IDENTITY_IDS.fixtureCoEntity);
      expect(observation.subjectType).toBe("legal_entity");
      expect(observation.revisionNumber).toBe(1);
      expect(observation.restatementOfId).toBeNull();
      expect(observation.ingestionRunId).toBe(outcome.run.runId);
      expect(observation.sourceId).toBe(DEMO_SOURCE_ID);
      expect(observation.parserVersion).toBe(DEMO_PARSER_VERSION);
      expect(observation.fetchedAt).toBe(RUN_CLOCK);
      expect(observation.recordedAt).toBe(PUBLISH_CLOCK);
      expect(observation.availableAt < observation.recordedAt).toBe(true);
      expect(observation.revisionGroupId).toMatch(/^[a-f0-9]{64}$/u);
      expect(observation.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps units, currency and missing reasons instead of coercing them", async () => {
    const harness = createHarness();
    const publication = await harness.publish(
      await harness.ingest(createDemoDatasetProvider(() => RUN_CLOCK)),
    );
    const byMetric = new Map(
      publication.published.map((observation) => [
        observation.metricId,
        observation,
      ]),
    );

    expect(byMetric.get("net_income")).toMatchObject({
      rawValue: "-4200000",
      unit: "monetary",
      currency: "USD",
      periodType: "annual",
    });
    expect(byMetric.get("capital_expenditure")).toMatchObject({
      rawValue: null,
      rawValueStatus: "not_provided",
      qualityFlags: expect.arrayContaining(["missing_from_source"]),
    });
    expect(byMetric.get("shares_outstanding")).toMatchObject({
      rawValue: null,
      rawValueStatus: "license_restricted",
      currency: null,
      periodType: "instant",
    });
  });

  it("flags a late ingestion so both knowledge bases stay distinguishable", async () => {
    const harness = createHarness();
    const publication = await harness.publish(
      await harness.ingest(createDemoDatasetProvider(() => RUN_CLOCK)),
    );

    expect(publication.published[0]?.qualityFlags).toContain(
      LATE_INGESTION_FLAG,
    );
  });

  it("emits the cache identities to invalidate only after the commit", async () => {
    const harness = createHarness();
    const publication = await harness.publish(
      await harness.ingest(createDemoDatasetProvider(() => RUN_CLOCK)),
    );

    expect(publication.invalidations).toStrictEqual([
      [
        "observation",
        "personal",
        "legal_entity",
        DEMO_IDENTITY_IDS.fixtureCoEntity,
      ],
    ]);
  });

  it("records an amendment as a new revision without rewriting the first", async () => {
    const harness = createHarness();
    await harness.publish(
      await harness.ingest(createDemoDatasetProvider(() => RUN_CLOCK)),
    );

    const amendmentRun = await harness.ingest(
      createDemoRestatedDatasetProvider(() => RUN_CLOCK),
      { requestedVintage: "2025-05-01" },
    );
    const amendment = await harness.publish(amendmentRun, LATER_PUBLISH_CLOCK);

    // Sólo el revenue cambió: los otros cuatro registros son idempotentes.
    expect(amendment.published).toHaveLength(1);
    expect(amendment.duplicates).toHaveLength(4);
    expect(amendment.restated).toStrictEqual(["fixtureco-2024-revenue"]);
    expect(amendment.published[0]).toMatchObject({
      rawValue: "96000000",
      revisionNumber: 2,
      metricId: "revenue",
    });

    const chain = await harness.observations.listByRevisionGroup(
      amendment.published[0]!.revisionGroupId,
    );

    expect(chain).toHaveLength(2);
    expect(chain[0]).toMatchObject({
      rawValue: "100000000",
      revisionNumber: 1,
      supersededAt: "2025-05-01T14:00:00.000Z",
    });
    expect(chain[1]?.restatementOfId).toBe(chain[0]?.observationId);
  });

  it("answers as_known without letting the amendment leak backwards", async () => {
    const harness = createHarness();
    await harness.publish(
      await harness.ingest(createDemoDatasetProvider(() => RUN_CLOCK)),
    );
    await harness.publish(
      await harness.ingest(
        createDemoRestatedDatasetProvider(() => RUN_CLOCK),
        {
          requestedVintage: "2025-05-01",
        },
      ),
      LATER_PUBLISH_CLOCK,
    );

    const stored = await harness.observations.list({
      ...SUBJECT,
      metricIds: ["revenue"],
    });
    const revenueAt = (knownAt: string) =>
      queryObservations(
        stored,
        { ...SUBJECT, metricIds: ["revenue"] },
        query({ knownAt, effectiveAt: "2025-06-01T00:00:00.000Z" }),
      ).find((observation) => observation.asOf === "2024-12-31")?.rawValue;

    expect(revenueAt("2025-03-01T00:00:00.000Z")).toBe("100000000");
    expect(revenueAt("2025-06-01T00:00:00.000Z")).toBe("96000000");

    const currentView = queryObservations(
      stored,
      { ...SUBJECT, metricIds: ["revenue"] },
      query({
        revisionPolicy: "latest_restated",
        knownAt: null,
      } as PointInTimeQueryInput),
    );

    expect(
      currentView.find((observation) => observation.asOf === "2024-12-31")
        ?.rawValue,
    ).toBe("96000000");
  });

  it("walks ticker to legal entity to observation at a single cutoff", async () => {
    const harness = createHarness();
    await harness.publish(
      await harness.ingest(createDemoDatasetProvider(() => RUN_CLOCK)),
    );

    const cutoff = query({
      effectiveAt: "2025-03-01T00:00:00.000Z",
      knownAt: "2025-03-01T00:00:00.000Z",
    });
    const resolution = await harness.identity.resolve(
      { symbol: "FXCO", mic: "XNAS" },
      cutoff,
    );

    expect(resolution.status).toBe("resolved");
    expect(resolution.securityId).toBe(DEMO_IDENTITY_IDS.fixtureCoClassA);

    const stored = await harness.observations.list({
      subjectType: "legal_entity",
      subjectId: resolution.legalEntityId!,
    });
    const result = queryObservations(
      stored,
      { subjectType: "legal_entity", subjectId: resolution.legalEntityId! },
      cutoff,
    );

    expect(result.map((observation) => observation.metricId).sort()).toEqual([
      "capital_expenditure",
      "net_income",
      "revenue",
      "revenue",
      "shares_outstanding",
    ]);
  });

  it("refuses to publish a quarantined run and leaves the last value untouched", async () => {
    const harness = createHarness();
    await harness.publish(
      await harness.ingest(createDemoDatasetProvider(() => RUN_CLOCK)),
    );

    const broken = await harness.ingest(
      createDemoDatasetProvider(() => RUN_CLOCK),
      { datasetId: DEMO_DATASETS.broken, requestedVintage: "2025-06-01" },
    );

    expect(broken.run.status).toBe("quarantined");
    await expect(
      harness.publish({ ...broken, fetchedAt: RUN_CLOCK }),
    ).rejects.toBeInstanceOf(PublicationNotAllowedError);

    // `TM-05`: el parser roto no reemplazó ni borró el último lote válido.
    const stored = await harness.observations.list(SUBJECT);
    expect(stored).toHaveLength(5);
    expect(
      stored.find(
        (observation) =>
          observation.metricId === "revenue" &&
          observation.asOf === "2024-12-31",
      ),
    ).toMatchObject({ rawValue: "100000000", revisionNumber: 1 });
  });

  it("rejects a record whose subject does not resolve, publishing nothing", async () => {
    const harness = createHarness();
    const outcome = await harness.ingest(
      createDemoDatasetProvider(() => RUN_CLOCK),
    );
    const emptyGraph = identityGraphSchema.parse({
      legalEntities: [],
      securities: [],
      listings: [],
      listingSymbols: [],
      depositaryPrograms: [],
      depositaryRatios: [],
      identifierAssignments: [],
    });
    const observations = createInMemoryObservationRepository();
    const publishSpy = vi.spyOn(observations, "publish");

    const publication = await publishObservations(
      outcome.run,
      outcome.records,
      { fetchedAt: outcome.fetchedAt!, mode: "personal" },
      {
        identity: {
          ruleVersion: "identity-resolution-1.0.0",
          resolve: async (lookup, temporalQuery) =>
            resolveIdentity(emptyGraph, lookup, temporalQuery),
        },
        observations,
        now: () => PUBLISH_CLOCK,
        newObservationId: createIds("cc"),
      },
    );

    expect(publication.published).toHaveLength(0);
    expect(publication.rejections).toHaveLength(5);
    expect(publication.rejections[0]).toMatchObject({
      code: "identity_not_found",
    });
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("stays idempotent when the same batch is published twice", async () => {
    const harness = createHarness();
    const outcome = await harness.ingest(
      createDemoDatasetProvider(() => RUN_CLOCK),
    );

    await harness.publish(outcome);
    const replay = await harness.publish(outcome, LATER_PUBLISH_CLOCK);

    expect(replay.published).toHaveLength(0);
    expect(replay.duplicates).toHaveLength(5);
    await expect(harness.observations.list(SUBJECT)).resolves.toHaveLength(5);
  });
});

describe("publishObservations con sujeto de documento", () => {
  /**
   * Un universo constituido en 2026 que conoce al filer por su CIK sólo desde
   * entonces: exactamente la situación del universo real frente a hechos de 2009.
   */
  const FILER_ENTITY = "00000000-0000-4000-8000-00000000f001";
  const FILER_CIK = "0000000042";
  const CONSTITUTED_AT = "2026-09-05T01:39:10.000Z";
  const DOWNLOADED_AT = "2026-09-14T15:00:00.000Z";

  const provenance = {
    validFrom: CONSTITUTED_AT,
    validTo: null,
    availableAt: CONSTITUTED_AT,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "e".repeat(64),
    recordedAt: CONSTITUTED_AT,
  };

  const graph = identityGraphSchema.parse({
    legalEntities: [
      {
        ...provenance,
        legalEntityId: FILER_ENTITY,
        legalName: "Filer sintético",
        entityType: "operating_company",
        jurisdiction: null,
        status: "active",
      },
    ],
    securities: [],
    listings: [],
    listingSymbols: [],
    depositaryPrograms: [],
    depositaryRatios: [],
    identifierAssignments: [
      {
        ...provenance,
        sourceId: "sec-edgar",
        identifierAssignmentId: "00000000-0000-4000-8000-00000000f101",
        subjectType: "legal_entity",
        subjectId: FILER_ENTITY,
        identifierType: "cik",
        identifierValue: FILER_CIK,
        normalizedValue: FILER_CIK,
        scope: "sec:filer",
        issuingAuthority: "U.S. Securities and Exchange Commission",
        confidence: "authoritative",
      },
    ],
  });

  const run = {
    runId: "00000000-0000-4000-8000-00000000d001",
    sourceId: "sec-edgar",
    datasetId: "sec.companyfacts",
    parserVersion: "sec-companyfacts-1.0.0",
    idempotencyKey: "f".repeat(64),
    requestedAsOf: null,
    requestedVintage: null,
    cursor: null,
    nextCursor: null,
    subjectKey: FILER_CIK,
    selectionVersion: "sec-core-concepts-1.0.0",
    status: "succeeded" as const,
    startedAt: DOWNLOADED_AT,
    finishedAt: DOWNLOADED_AT,
    counts: { fetched: 2, accepted: 2, rejected: 0, duplicate: 0 },
    contentHash: "a".repeat(64),
    failure: null,
    qualityFlags: [],
    replayOfRunId: null,
    recordedAt: DOWNLOADED_AT,
  };

  function vintage(
    accession: string,
    value: string,
    availableAt: string,
    subjectKey = FILER_CIK,
  ) {
    return {
      externalId: `${subjectKey}:us-gaap:Assets:USD:instant:2008-12-31:${accession}`,
      concept: "us-gaap:Assets",
      subjectKey,
      metricId: "us-gaap:Assets",
      asOf: "2008-12-31",
      periodStart: null,
      periodEnd: null,
      periodType: "instant" as const,
      unit: "monetary",
      currency: "USD",
      rawValue: value,
      rawValueStatus: "stored" as const,
      availableAt,
      sourceDocumentId: accession,
      qualityFlags: [],
    };
  }

  const ORIGINAL = vintage(
    "0000000042-09-000031",
    "412000000",
    "2009-11-03T21:15:11.000Z",
  );
  const AMENDED = vintage(
    "0000000042-10-000012",
    "396500000",
    "2010-05-12T20:05:14.000Z",
  );

  function dependencies(observations = createInMemoryObservationRepository()) {
    return {
      identity: createGraphIdentityResolver(() => graph),
      observations,
      now: () => DOWNLOADED_AT,
      newObservationId: createIds("dd"),
    };
  }

  const documentCommand = {
    fetchedAt: DOWNLOADED_AT,
    mode: "personal" as const,
    documentSubject: {
      identifierType: "cik",
      identifierValue: FILER_CIK,
      scope: "sec:filer",
      resolvedAt: DOWNLOADED_AT,
    },
  };

  it("keeps a 2009 fact that per-record resolution would have rejected", async () => {
    const perRecord = await publishObservations(
      run,
      [ORIGINAL],
      { fetchedAt: DOWNLOADED_AT, mode: "personal" },
      dependencies(),
    );
    const byDocument = await publishObservations(
      run,
      [ORIGINAL],
      documentCommand,
      dependencies(),
    );

    // Contraste explícito: resolver al corte del hecho no encuentra a nadie,
    // porque el universo no existía en 2009.
    expect(perRecord.published).toHaveLength(0);
    expect(perRecord.rejections[0]?.code).toBe("identity_not_found");

    expect(byDocument.rejections).toHaveLength(0);
    expect(byDocument.published[0]).toMatchObject({
      subjectType: "legal_entity",
      subjectId: FILER_ENTITY,
      // Resolver el sujeto hoy no adelanta el conocimiento del hecho.
      availableAt: "2009-11-03T21:15:11.000Z",
    });
  });

  it("rejects a record that names another filer than its document", async () => {
    const outcome = await publishObservations(
      run,
      [
        ORIGINAL,
        vintage(
          "0000000043-09-000001",
          "1",
          "2009-11-04T20:00:00.000Z",
          "0000000043",
        ),
      ],
      documentCommand,
      dependencies(),
    );

    expect(outcome.published).toHaveLength(1);
    expect(outcome.rejections).toStrictEqual([
      {
        externalId:
          "0000000043:us-gaap:Assets:USD:instant:2008-12-31:0000000043-09-000001",
        code: "subject_mismatch",
        candidateIds: [],
      },
    ]);
  });

  it("rejects every record when the document subject is not in the graph", async () => {
    const outcome = await publishObservations(
      run,
      [ORIGINAL],
      {
        ...documentCommand,
        documentSubject: {
          ...documentCommand.documentSubject,
          resolvedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      dependencies(),
    );

    expect(outcome.published).toHaveLength(0);
    expect(outcome.rejections[0]?.code).toBe("identity_not_found");
  });

  it("chains two vintages of one fact inside a single batch, whatever their order", async () => {
    const observations = createInMemoryObservationRepository();
    const outcome = await publishObservations(
      run,
      // El adaptador los entrega al revés: el orden no puede decidir la cadena.
      [AMENDED, ORIGINAL],
      documentCommand,
      dependencies(observations),
    );

    expect(outcome.rejections).toHaveLength(0);
    expect(outcome.restated).toStrictEqual([AMENDED.externalId]);

    const chain = await observations.listByRevisionGroup(
      outcome.published[0]!.revisionGroupId,
    );

    expect(chain.map((observation) => observation.rawValue)).toStrictEqual([
      "412000000",
      "396500000",
    ]);
    expect(chain[0]).toMatchObject({
      revisionNumber: 1,
      supersededAt: "2010-05-12T20:05:14.000Z",
    });
    expect(chain[1]).toMatchObject({
      revisionNumber: 2,
      supersededAt: null,
      restatementOfId: chain[0]!.observationId,
    });

    const assetsAt = (knownAt: string) =>
      queryObservations(
        chain,
        { subjectType: "legal_entity", subjectId: FILER_ENTITY },
        query({ knownAt, effectiveAt: "2011-01-01T00:00:00.000Z" }),
      )[0]?.rawValue;

    // `TM-06`: antes de la enmienda, la consulta no ve el valor enmendado.
    expect(assetsAt("2010-05-01T00:00:00.000Z")).toBe("412000000");
    expect(assetsAt("2010-06-01T00:00:00.000Z")).toBe("396500000");
  });

  it("extends a persisted chain from a later batch without touching the first row", async () => {
    const observations = createInMemoryObservationRepository();
    await publishObservations(
      run,
      [ORIGINAL],
      documentCommand,
      dependencies(observations),
    );
    const second = await publishObservations(
      { ...run, runId: "00000000-0000-4000-8000-00000000d002" },
      [ORIGINAL, AMENDED],
      documentCommand,
      dependencies(observations),
    );

    expect(second.duplicates).toStrictEqual([ORIGINAL.externalId]);
    expect(second.supersessions).toHaveLength(1);
    expect(second.published).toHaveLength(1);
  });

  it("recognizes a whole persisted chain as duplicates, not only its tip", async () => {
    // Regresión: la vintage original se comparaba sólo contra la punta de la
    // cadena —la enmienda— y se rechazaba como `ambiguous_revision` en vez de
    // reconocerse como ya publicada.
    const observations = createInMemoryObservationRepository();
    await publishObservations(
      run,
      [ORIGINAL, AMENDED],
      documentCommand,
      dependencies(observations),
    );
    const replay = await publishObservations(
      { ...run, runId: "00000000-0000-4000-8000-00000000d003" },
      [ORIGINAL, AMENDED],
      documentCommand,
      dependencies(observations),
    );

    expect(replay.rejections).toStrictEqual([]);
    expect(replay.duplicates).toStrictEqual([
      ORIGINAL.externalId,
      AMENDED.externalId,
    ]);
    expect(replay.published).toHaveLength(0);
  });

  it("reads persisted chains in bounded lookups instead of one query per record", async () => {
    const observations = createInMemoryObservationRepository();
    const single = vi.spyOn(observations, "findLatestRevision");
    const batched = vi.spyOn(observations, "listRevisionGroups");

    await publishObservations(
      run,
      [ORIGINAL, AMENDED],
      documentCommand,
      dependencies(observations),
    );

    expect(single).not.toHaveBeenCalled();
    expect(batched).toHaveBeenCalledTimes(1);
  });
});
