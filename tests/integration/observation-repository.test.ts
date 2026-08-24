import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import {
  DEMO_IDENTITY_GRAPH,
  DEMO_IDENTITY_IDS,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { executeIngestionRun } from "@/modules/ingestion/application/execute-ingestion-run";
import {
  createDemoDatasetProvider,
  createDemoRestatedDatasetProvider,
} from "@/modules/ingestion/infrastructure/demo-dataset-provider";
import {
  DEMO_DATASETS,
  DEMO_PARSER_VERSION,
  DEMO_SOURCE_ID,
} from "@/modules/ingestion/infrastructure/demo-ingestion-fixtures";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { publishObservations } from "@/modules/observations/application/publish-observations";
import { computeRevisionGroupId } from "@/modules/observations/domain/observation";
import { queryObservations } from "@/modules/observations/domain/select-observations";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresObservationRepository } from "@/server/db/postgres-observation-repository";
import { createPostgresSourceRegistryRepository } from "@/server/db/postgres-source-registry-repository";
import * as schema from "@/server/db/schema";
import {
  pointInTimeQuerySchema,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const RUN_CLOCK = "2026-08-24T10:00:00.000Z";
const PUBLISH_CLOCK = "2026-08-24T10:05:00.000Z";
const LATER_PUBLISH_CLOCK = "2026-08-24T11:00:00.000Z";

const SUBJECT = {
  subjectType: "legal_entity" as const,
  subjectId: DEMO_IDENTITY_IDS.fixtureCoEntity,
};

type PostgresErrorShape = { code?: string; constraint_name?: string };

async function expectConstraintViolation(
  operation: () => Promise<unknown>,
  constraintName: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const cause = ((error as { cause?: unknown }).cause ??
      error) as PostgresErrorShape;
    expect(cause.constraint_name).toBe(constraintName);
    return;
  }

  throw new Error(`Expected ${constraintName} to reject the statement.`);
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

const fixtureEntry = DEMO_SOURCE_REGISTRY.find(
  (entry) => entry.sourceId === DEMO_SOURCE_ID,
)!;

describe("PostgreSQL point-in-time observations", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;

  async function ingestAndPublish(
    provider: ReturnType<typeof createDemoDatasetProvider>,
    options: { vintage: string | null; publishedAt: string },
  ) {
    const outcome = await executeIngestionRun(
      {
        sourceId: DEMO_SOURCE_ID,
        datasetId: DEMO_DATASETS.annual,
        parserVersion: DEMO_PARSER_VERSION,
        requestedAsOf: "2024-12-31",
        requestedVintage: options.vintage,
      },
      {
        sourceRegistry: createPostgresSourceRegistryRepository(database),
        ingestionRuns: createPostgresIngestionRunRepository(database),
        provider,
        now: () => RUN_CLOCK,
        newRunId: () => randomUUID(),
      },
    );

    const publication = await publishObservations(
      outcome.run,
      outcome.records,
      { fetchedAt: outcome.fetchedAt!, mode: "personal" },
      {
        identity: createGraphIdentityResolver(() => DEMO_IDENTITY_GRAPH),
        observations: createPostgresObservationRepository(database),
        now: () => options.publishedAt,
        newObservationId: () => randomUUID(),
      },
    );

    return { outcome, publication };
  }

  beforeAll(async () => {
    client = postgres(databaseTestUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    database = drizzle(client, { schema });

    await createPostgresSourceRegistryRepository(database).upsert(fixtureEntry);
    // Estado conocido: una corrida publicable previa para el mismo dataset
    // haría que la primera de este archivo se dedupe por content hash.
    await database
      .delete(schema.observations)
      .where(eq(schema.observations.sourceId, DEMO_SOURCE_ID));
    await database
      .delete(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.sourceId, DEMO_SOURCE_ID));

    await ingestAndPublish(
      createDemoDatasetProvider(() => RUN_CLOCK),
      {
        vintage: null,
        publishedAt: PUBLISH_CLOCK,
      },
    );
    await ingestAndPublish(
      createDemoRestatedDatasetProvider(() => RUN_CLOCK),
      {
        vintage: "2025-05-01",
        publishedAt: LATER_PUBLISH_CLOCK,
      },
    );
  });

  afterAll(async () => {
    if (database) {
      await database
        .delete(schema.observations)
        .where(eq(schema.observations.sourceId, DEMO_SOURCE_ID));
      await database
        .delete(schema.ingestionRuns)
        .where(eq(schema.ingestionRuns.sourceId, DEMO_SOURCE_ID));
      await database
        .delete(schema.sourceRegistry)
        .where(eq(schema.sourceRegistry.sourceId, DEMO_SOURCE_ID));
    }
    if (client) {
      await client.end();
    }
  });

  it("persists one revision chain per fact with its lineage intact", async () => {
    const observations = createPostgresObservationRepository(database);
    const stored = await observations.list(SUBJECT);

    expect(stored).toHaveLength(6);
    expect(
      stored.every((observation) => observation.sourceId === DEMO_SOURCE_ID),
    ).toBe(true);
    expect(
      new Set(stored.map((observation) => observation.ingestionRunId)).size,
    ).toBe(2);
  });

  it("round-trips exact decimals, nulls and their reason", async () => {
    const observations = createPostgresObservationRepository(database);
    const stored = await observations.list(SUBJECT);
    const byMetric = new Map(
      stored
        .filter((observation) => observation.asOf === "2024-12-31")
        .map((observation) => [observation.metricId, observation]),
    );

    // El decimal vuelve exactamente como se publicó: sin float intermedio.
    expect(byMetric.get("net_income")?.rawValue).toBe("-4200000");
    expect(byMetric.get("capital_expenditure")).toMatchObject({
      rawValue: null,
      rawValueStatus: "not_provided",
    });
    expect(byMetric.get("shares_outstanding")).toMatchObject({
      rawValue: null,
      rawValueStatus: "license_restricted",
      currency: null,
      periodType: "instant",
    });
  });

  it("answers as_known against multiple revisions without look-ahead", async () => {
    const observations = createPostgresObservationRepository(database);
    const stored = await observations.list({
      ...SUBJECT,
      metricIds: ["revenue"],
    });

    const revenueAt = (knownAt: string) =>
      queryObservations(
        stored,
        { ...SUBJECT, metricIds: ["revenue"] },
        query({ knownAt }),
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

  it("separates public availability from what the installation had recorded", async () => {
    const observations = createPostgresObservationRepository(database);
    const stored = await observations.list({
      ...SUBJECT,
      metricIds: ["revenue"],
    });
    const knownAt = "2025-06-01T00:00:00.000Z";

    expect(
      queryObservations(
        stored,
        { ...SUBJECT, metricIds: ["revenue"] },
        query({ knownAt, knowledgeBasis: "public_availability" }),
      ),
    ).not.toHaveLength(0);
    // La instalación registró todo en 2026: en 2025 no tenía nada.
    expect(
      queryObservations(
        stored,
        { ...SUBJECT, metricIds: ["revenue"] },
        query({ knownAt, knowledgeBasis: "system_recorded" }),
      ),
    ).toHaveLength(0);
  });

  it("closes the previous revision in the same transaction that opens the new one", async () => {
    const observations = createPostgresObservationRepository(database);
    const revisionGroupId = computeRevisionGroupId({
      subjectType: "legal_entity",
      subjectId: DEMO_IDENTITY_IDS.fixtureCoEntity,
      metricId: "revenue",
      concept: "Revenues",
      asOf: "2024-12-31",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      periodType: "annual",
      unit: "monetary",
      currency: "USD",
      sourceId: DEMO_SOURCE_ID,
      datasetId: DEMO_DATASETS.annual,
      valueBasis: "reported",
    });

    const chain = await observations.listByRevisionGroup(revisionGroupId);

    expect(chain).toHaveLength(2);
    expect(chain[0]).toMatchObject({
      revisionNumber: 1,
      rawValue: "100000000",
      supersededAt: "2025-05-01T14:00:00.000Z",
    });
    expect(chain[1]).toMatchObject({
      revisionNumber: 2,
      rawValue: "96000000",
      supersededAt: null,
      restatementOfId: chain[0]!.observationId,
    });
  });

  it("refuses a second current revision for the same fact", async () => {
    const observations = createPostgresObservationRepository(database);
    const [current] = await observations.list({
      ...SUBJECT,
      metricIds: ["net_income"],
    });

    await expectConstraintViolation(
      () =>
        database.insert(schema.observations).values({
          ...{
            observationId: randomUUID(),
            subjectType: current!.subjectType,
            subjectId: current!.subjectId,
            metricId: current!.metricId,
            concept: current!.concept,
            asOf: current!.asOf,
            periodStart: current!.periodStart,
            periodEnd: current!.periodEnd,
            periodType: current!.periodType,
            unit: current!.unit,
            currency: current!.currency,
            rawValue: "1",
            rawValueStatus: "stored" as const,
            valueBasis: current!.valueBasis,
            availableAt: new Date(current!.availableAt),
            fetchedAt: new Date(current!.fetchedAt),
            recordedAt: new Date(current!.recordedAt),
            revisionGroupId: current!.revisionGroupId,
            revisionNumber: 9,
            restatementOfId: current!.observationId,
            contentHash: "a".repeat(64),
            sourceId: current!.sourceId,
            datasetId: current!.datasetId,
            parserVersion: current!.parserVersion,
            externalId: "constraint-probe",
            ingestionRunId: current!.ingestionRunId,
          },
        }),
      "observations_current_revision_uidx",
    );
  });

  it("rejects a zero standing in for a value the source never published", async () => {
    const observations = createPostgresObservationRepository(database);
    const [current] = await observations.list({
      ...SUBJECT,
      metricIds: ["capital_expenditure"],
    });

    await expectConstraintViolation(
      () =>
        database.insert(schema.observations).values({
          observationId: randomUUID(),
          subjectType: "legal_entity",
          subjectId: DEMO_IDENTITY_IDS.fixtureCoEntity,
          metricId: "capital_expenditure",
          concept: "PaymentsToAcquirePropertyPlantAndEquipment",
          asOf: "2023-12-31",
          periodStart: "2023-01-01",
          periodEnd: "2023-12-31",
          periodType: "annual",
          unit: "monetary",
          currency: "USD",
          rawValue: "0",
          rawValueStatus: "not_provided",
          valueBasis: "reported",
          availableAt: new Date("2024-02-15T21:00:00.000Z"),
          fetchedAt: new Date(RUN_CLOCK),
          recordedAt: new Date(PUBLISH_CLOCK),
          revisionGroupId: "b".repeat(64),
          revisionNumber: 1,
          restatementOfId: null,
          contentHash: "c".repeat(64),
          sourceId: DEMO_SOURCE_ID,
          datasetId: DEMO_DATASETS.annual,
          parserVersion: DEMO_PARSER_VERSION,
          externalId: "constraint-probe-zero",
          ingestionRunId: current!.ingestionRunId,
        }),
      "observations_raw_value_status_check",
    );
  });

  it("keeps an observation tied to the run that produced it", async () => {
    const observations = createPostgresObservationRepository(database);
    const [current] = await observations.list({
      ...SUBJECT,
      metricIds: ["net_income"],
    });

    await expect(
      database.insert(schema.observations).values({
        observationId: randomUUID(),
        subjectType: "legal_entity",
        subjectId: DEMO_IDENTITY_IDS.fixtureCoEntity,
        metricId: "net_income",
        concept: "NetIncomeLoss",
        asOf: "2022-12-31",
        periodStart: "2022-01-01",
        periodEnd: "2022-12-31",
        periodType: "annual",
        unit: "monetary",
        currency: "USD",
        rawValue: "1",
        rawValueStatus: "stored",
        valueBasis: "reported",
        availableAt: new Date("2023-02-15T21:00:00.000Z"),
        fetchedAt: new Date(RUN_CLOCK),
        recordedAt: new Date(PUBLISH_CLOCK),
        revisionGroupId: "d".repeat(64),
        revisionNumber: 1,
        restatementOfId: null,
        contentHash: "e".repeat(64),
        sourceId: DEMO_SOURCE_ID,
        datasetId: DEMO_DATASETS.annual,
        parserVersion: DEMO_PARSER_VERSION,
        externalId: "constraint-probe-lineage",
        ingestionRunId: randomUUID(),
      }),
    ).rejects.toThrow();

    expect(current!.ingestionRunId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("registers the amendment as its own run instead of replaying the first", async () => {
    const runs = await createPostgresIngestionRunRepository(database).list({
      sourceId: DEMO_SOURCE_ID,
      datasetId: DEMO_DATASETS.annual,
    });

    expect(runs).toHaveLength(2);
    expect(
      runs
        .map((run) => run.requestedVintage)
        .sort((left, right) => String(left).localeCompare(String(right))),
    ).toStrictEqual(
      ["2025-05-01", null].sort((left, right) =>
        String(left).localeCompare(String(right)),
      ),
    );
    expect(new Set(runs.map((run) => run.idempotencyKey)).size).toBe(2);
  });
});
