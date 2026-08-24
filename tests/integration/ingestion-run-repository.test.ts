import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { executeIngestionRun } from "@/modules/ingestion/application/execute-ingestion-run";
import { createDemoDatasetProvider } from "@/modules/ingestion/infrastructure/demo-dataset-provider";
import {
  DEMO_DATASETS,
  DEMO_PARSER_VERSION,
  DEMO_SOURCE_ID,
} from "@/modules/ingestion/infrastructure/demo-ingestion-fixtures";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresSourceRegistryRepository } from "@/server/db/postgres-source-registry-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const FIXED_NOW = "2026-08-23T10:00:00.000Z";

type PostgresErrorShape = { code?: string; constraint_name?: string };

/**
 * Drizzle envuelve el error de PostgreSQL, así que el nombre del constraint sólo
 * está en la causa. Afirmar sobre el mensaje daría un test que pasa con
 * cualquier fallo de query.
 */
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

const fixtureEntry = DEMO_SOURCE_REGISTRY.find(
  (entry) => entry.sourceId === DEMO_SOURCE_ID,
)!;
const blockedEntry = DEMO_SOURCE_REGISTRY.find(
  (entry) => entry.sourceId === "sec-edgar",
)!;

describe("PostgreSQL ingestion persistence", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;

  function createRunIds() {
    return () => randomUUID();
  }

  beforeAll(async () => {
    client = postgres(databaseTestUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    database = drizzle(client, { schema });

    const registry = createPostgresSourceRegistryRepository(database);
    await registry.upsert(fixtureEntry);
    await registry.upsert(blockedEntry);
  });

  afterAll(async () => {
    if (database) {
      await database
        .delete(schema.ingestionRuns)
        .where(eq(schema.ingestionRuns.sourceId, DEMO_SOURCE_ID));
      await database
        .delete(schema.ingestionRuns)
        .where(eq(schema.ingestionRuns.sourceId, blockedEntry.sourceId));
      await database
        .delete(schema.sourceRegistry)
        .where(eq(schema.sourceRegistry.sourceId, DEMO_SOURCE_ID));
      await database
        .delete(schema.sourceRegistry)
        .where(eq(schema.sourceRegistry.sourceId, blockedEntry.sourceId));
    }
    if (client) {
      await client.end();
    }
  });

  it("round-trips a registry entry keeping unknown rights fail-closed", async () => {
    const registry = createPostgresSourceRegistryRepository(database);

    await expect(
      registry.findBySourceId(blockedEntry.sourceId),
    ).resolves.toMatchObject({
      approvalStatus: "rights_review_pending",
      rightsReviewedAt: null,
      rights: {
        automatedAccess: "unknown",
        rawStorage: "unknown",
        publicDisplay: "unknown",
      },
    });
  });

  it("rejects a public demo approval without public display rights", async () => {
    await expectConstraintViolation(
      () =>
        database.insert(schema.sourceRegistry).values({
          sourceId: `check-${randomUUID().slice(0, 8)}`,
          displayName: "Constraint probe",
          owner: "test",
          canonicalUrl: "https://fixtures.invalid/probe",
          authentication: "none",
          expectedCadence: "n/a",
          freshnessTarget: "n/a",
          fixturePolicy: "n/a",
          technicalStatus: "integrated",
          approvalStatus: "approved_public_demo",
          rightsReviewedAt: new Date(FIXED_NOW),
          publicDisplayRight: "unknown",
        }),
      "source_registry_public_display_check",
    );
  });

  it("rejects an ingestion run whose counts do not add up", async () => {
    await expectConstraintViolation(
      () =>
        database.insert(schema.ingestionRuns).values({
          runId: randomUUID(),
          sourceId: DEMO_SOURCE_ID,
          datasetId: DEMO_DATASETS.annual,
          parserVersion: DEMO_PARSER_VERSION,
          idempotencyKey: "c".repeat(64),
          status: "succeeded",
          startedAt: new Date(FIXED_NOW),
          finishedAt: new Date(FIXED_NOW),
          fetchedCount: 5,
          acceptedCount: 4,
          contentHash: "d".repeat(64),
        }),
      "ingestion_runs_counts_balance_check",
    );
  });

  it("persists a full run and replays it without contacting the provider", async () => {
    const dependencies = {
      sourceRegistry: createPostgresSourceRegistryRepository(database),
      ingestionRuns: createPostgresIngestionRunRepository(database),
      provider: createDemoDatasetProvider(() => FIXED_NOW),
      now: () => FIXED_NOW,
      newRunId: createRunIds(),
    };
    const command = {
      sourceId: DEMO_SOURCE_ID,
      datasetId: DEMO_DATASETS.annual,
      parserVersion: DEMO_PARSER_VERSION,
      requestedAsOf: "2024-12-31",
    };

    const first = await executeIngestionRun(command, dependencies);
    const replay = await executeIngestionRun(command, dependencies);

    expect(first.run.status).toBe("succeeded");
    expect(first.run.counts.accepted).toBe(5);
    expect(replay.run.runId).toBe(first.run.runId);
    expect(replay.providerCalled).toBe(false);

    const stored = await dependencies.ingestionRuns.list({
      sourceId: DEMO_SOURCE_ID,
      datasetId: DEMO_DATASETS.annual,
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      status: "succeeded",
      requestedAsOf: "2024-12-31",
      contentHash: first.run.contentHash,
      failure: null,
    });
  });

  it("persists a rights-blocked attempt as a failed run with a safe error", async () => {
    const dependencies = {
      sourceRegistry: createPostgresSourceRegistryRepository(database),
      ingestionRuns: createPostgresIngestionRunRepository(database),
      provider: createDemoDatasetProvider(() => FIXED_NOW),
      now: () => FIXED_NOW,
      newRunId: createRunIds(),
    };

    const outcome = await executeIngestionRun(
      {
        sourceId: blockedEntry.sourceId,
        datasetId: "sec.companyfacts",
        parserVersion: "sec-1.0.0",
      },
      dependencies,
    );

    expect(outcome.run.status).toBe("failed");
    expect(outcome.providerCalled).toBe(false);

    const [stored] = await dependencies.ingestionRuns.list({
      sourceId: blockedEntry.sourceId,
    });

    expect(stored).toMatchObject({
      status: "failed",
      contentHash: null,
      failure: { code: "rights_not_approved", retryable: false },
    });
    expect(stored?.failure?.message).not.toMatch(/[A-Za-z0-9_-]{24,}/u);
  });

  it("allows retrying a failed key but never two publishable runs for it", async () => {
    const runs = createPostgresIngestionRunRepository(database);
    const idempotencyKey = "e".repeat(64);
    const base = {
      sourceId: DEMO_SOURCE_ID,
      datasetId: DEMO_DATASETS.partial,
      parserVersion: DEMO_PARSER_VERSION,
      idempotencyKey,
      requestedAsOf: null,
      cursor: null,
      nextCursor: null,
      startedAt: FIXED_NOW,
      finishedAt: FIXED_NOW,
      qualityFlags: [],
      replayOfRunId: null,
      recordedAt: FIXED_NOW,
    };

    await runs.append({
      ...base,
      runId: randomUUID(),
      status: "failed",
      counts: { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 },
      contentHash: null,
      failure: { code: "provider_error", message: "caída", retryable: true },
    });

    // Un reintento tras el fallo es legítimo y sí publica.
    await runs.append({
      ...base,
      runId: randomUUID(),
      status: "succeeded",
      counts: { fetched: 2, accepted: 2, rejected: 0, duplicate: 0 },
      contentHash: "f".repeat(64),
      failure: null,
    });

    // Publicar dos veces la misma clave sí es un duplicado real.
    await expectConstraintViolation(
      () =>
        runs.append({
          ...base,
          runId: randomUUID(),
          status: "succeeded",
          counts: { fetched: 2, accepted: 2, rejected: 0, duplicate: 0 },
          contentHash: "f".repeat(64),
          failure: null,
        }),
      "ingestion_runs_publishable_idempotency_uidx",
    );
  });
});
