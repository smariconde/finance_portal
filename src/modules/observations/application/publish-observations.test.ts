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
