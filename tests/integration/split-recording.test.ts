import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLiveSplitClaimSource } from "@/modules/corporate-actions/application/live-split-claim-source";
import { readLineageObservations } from "@/modules/corporate-actions/application/read-lineage-observations";
import { recordSplits } from "@/modules/corporate-actions/application/record-splits";
import {
  buildCompanyConceptPayload,
  buildSplitFixtureClaims,
  buildSplitFixtureDocuments,
  buildSplitFixtureGraph,
  buildSplitFixtureObservations,
  SPLIT_ACCEPTED_AT,
  SPLIT_ACCESSIONS,
  SPLIT_FILER_CIK,
  SPLIT_FILER_ENTITY_ID,
  SPLIT_FIXTURE_RECORDED_AT,
} from "@/modules/corporate-actions/infrastructure/fixture-split";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  computeIdempotencyKey,
  ingestionRunSchema,
} from "@/modules/ingestion/domain/ingestion-run";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { createPostgresCorporateActionRepository } from "@/server/db/postgres-corporate-action-repository";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresObservationRepository } from "@/server/db/postgres-observation-repository";
import { createPostgresSourceDocumentRepository } from "@/server/db/postgres-source-document-repository";
import { createPostgresSourceRegistryRepository } from "@/server/db/postgres-source-registry-repository";
import { createPostgresUniverseRepository } from "@/server/db/postgres-universe-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const CLOCK = "2025-09-15T12:00:00.000Z";
/** Corrida que publicó la fixture: sus observaciones y documentos la referencian. */
const FIXTURE_RUN_ID = "00000000-0000-4000-8000-00000000d0f1";

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

const secEntry = DEMO_SOURCE_REGISTRY.find(
  (entry) => entry.sourceId === "sec-edgar",
)!;

const fetch: EgressFetch = async () => {
  const body = new TextEncoder().encode(
    JSON.stringify(buildCompanyConceptPayload(buildSplitFixtureClaims())),
  );

  return {
    status: 200,
    body,
    byteLength: body.byteLength,
    fetchedAt: "2025-09-15T11:59:00.000Z",
  };
};

describe("PostgreSQL splits", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;

  function dependencies() {
    const universe = createPostgresUniverseRepository(database);

    return {
      sourceRegistry: createPostgresSourceRegistryRepository(database),
      ingestionRuns: createPostgresIngestionRunRepository(database),
      sourceDocuments: createPostgresSourceDocumentRepository(database),
      observations: createPostgresObservationRepository(database),
      corporateActions: createPostgresCorporateActionRepository(database),
      loadIdentityGraph: async () =>
        (await universe.loadState({ indexId: "fixture-index" })).graph,
      source: createLiveSplitClaimSource({ fetch }),
      now: () => CLOCK,
      newId: () => randomUUID(),
    };
  }

  function record() {
    return recordSplits(
      { cik: SPLIT_FILER_CIK, mode: "personal" },
      dependencies(),
    );
  }

  async function clean() {
    await database.delete(schema.legalEntityRelationships);
    await database.delete(schema.corporateActions);
    await database
      .delete(schema.observations)
      .where(eq(schema.observations.sourceId, "sec-edgar"));
    await database
      .delete(schema.sourceDocuments)
      .where(eq(schema.sourceDocuments.sourceId, "sec-edgar"));
    await database
      .delete(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.sourceId, "sec-edgar"));
    await database.delete(schema.indexMemberships);
    await database.delete(schema.identifierAssignments);
    await database.delete(schema.listingSymbols);
    await database.delete(schema.listingVersions);
    await database.delete(schema.listings);
    await database.delete(schema.securityVersions);
    await database.delete(schema.legalEntityVersions);
    await database.delete(schema.securities);
    await database.delete(schema.legalEntities);
  }

  /** El filer, sus presentaciones y sus hechos ya publicados por la ingesta. */
  async function seedPublishedFiler() {
    const graph = buildSplitFixtureGraph();
    const [entity] = graph.legalEntities;
    const [assignment] = graph.identifierAssignments;

    await database
      .insert(schema.legalEntities)
      .values({ legalEntityId: entity!.legalEntityId });
    await database.insert(schema.legalEntityVersions).values({
      legalEntityId: entity!.legalEntityId,
      legalName: entity!.legalName,
      entityType: entity!.entityType,
      jurisdiction: entity!.jurisdiction,
      status: entity!.status,
      validFrom: new Date(entity!.validFrom),
      availableAt: new Date(entity!.availableAt),
      sourceId: entity!.sourceId,
      contentHash: entity!.contentHash,
    });
    await database.insert(schema.identifierAssignments).values({
      identifierAssignmentId: assignment!.identifierAssignmentId,
      subjectType: assignment!.subjectType,
      subjectId: assignment!.subjectId,
      identifierType: assignment!.identifierType,
      identifierValue: assignment!.identifierValue,
      normalizedValue: assignment!.normalizedValue,
      scope: assignment!.scope,
      issuingAuthority: assignment!.issuingAuthority,
      confidence: assignment!.confidence,
      validFrom: new Date(assignment!.validFrom),
      availableAt: new Date(assignment!.availableAt),
      sourceId: assignment!.sourceId,
      contentHash: assignment!.contentHash,
    });

    await createPostgresIngestionRunRepository(database).append(
      ingestionRunSchema.parse({
        runId: FIXTURE_RUN_ID,
        sourceId: "sec-edgar",
        datasetId: "sec.companyfacts",
        parserVersion: "sec-companyfacts-1.0.0",
        idempotencyKey: computeIdempotencyKey({
          sourceId: "sec-edgar",
          datasetId: "sec.companyfacts",
          parserVersion: "sec-companyfacts-1.0.0",
          requestedAsOf: null,
          cursor: null,
          subjectKey: SPLIT_FILER_CIK,
        }),
        requestedAsOf: null,
        cursor: null,
        nextCursor: null,
        subjectKey: SPLIT_FILER_CIK,
        status: "succeeded",
        startedAt: SPLIT_FIXTURE_RECORDED_AT,
        finishedAt: SPLIT_FIXTURE_RECORDED_AT,
        counts: { fetched: 1, accepted: 1, rejected: 0, duplicate: 0 },
        contentHash: computeContentHash("split-fixture"),
        failure: null,
        qualityFlags: [],
        replayOfRunId: null,
        recordedAt: SPLIT_FIXTURE_RECORDED_AT,
      }),
    );
    await createPostgresSourceDocumentRepository(database).record(
      buildSplitFixtureDocuments(),
    );
    await createPostgresObservationRepository(database).publish({
      ingestionRunId: FIXTURE_RUN_ID,
      observations: buildSplitFixtureObservations(),
      supersessions: [],
    });
  }

  beforeAll(async () => {
    client = postgres(databaseTestUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    database = drizzle(client, { schema });
    await createPostgresSourceRegistryRepository(database).upsert(secEntry);
  });

  beforeEach(async () => {
    await clean();
    await seedPublishedFiler();
  });

  afterAll(async () => {
    if (database) {
      await clean();
    }
    await client?.end();
  });

  it("confirma el split contra los hechos persistidos y lo lee de vuelta idéntico", async () => {
    const outcome = await record();

    expect(outcome.run).toMatchObject({
      status: "succeeded",
      counts: { fetched: 4, accepted: 4, rejected: 0, duplicate: 0 },
    });
    expect(outcome.applied).toStrictEqual({ corporateActions: 1 });

    const [split] = await createPostgresCorporateActionRepository(
      database,
    ).listCorporateActions({
      subjectIds: [SPLIT_FILER_ENTITY_ID],
      actionTypes: ["split", "reverse_split"],
    });

    expect(split).toStrictEqual(outcome.plan!.corporateActions[0]);
    expect(split).toMatchObject({
      actionType: "split",
      sourceDocumentId: SPLIT_ACCESSIONS.annual2024,
      availableAt: SPLIT_ACCEPTED_AT,
      terms: { ratio: "4" },
    });
  });

  it("la segunda corrida no agrega eventos", async () => {
    await record();
    const second = await record();
    const [{ actions }] = await database.execute<{ actions: string }>(
      sql`select count(*) as actions from corporate_actions`,
    );

    expect(second.run?.status).toBe("duplicate");
    expect(second.plan?.status).toBe("unchanged");
    expect(Number(actions)).toBe(1);
  });

  it("filtra por sujeto o presentación y por tipo sin traer otros eventos", async () => {
    await record();
    const repository = createPostgresCorporateActionRepository(database);

    await expect(
      repository.listCorporateActions({ subjectIds: [randomUUID()] }),
    ).resolves.toHaveLength(0);
    await expect(
      repository.listCorporateActions({
        subjectIds: [randomUUID()],
        sourceDocumentIds: [SPLIT_ACCESSIONS.annual2024],
      }),
    ).resolves.toHaveLength(1);
    await expect(
      repository.listCorporateActions({
        subjectIds: [SPLIT_FILER_ENTITY_ID],
        actionTypes: ["successor_issuer"],
      }),
    ).resolves.toHaveLength(0);
  });

  it("lee la serie por acción en una sola base desde PostgreSQL", async () => {
    await record();
    const read = (input: Record<string, unknown>) =>
      readLineageObservations(
        {
          legalEntityId: SPLIT_FILER_ENTITY_ID,
          metricIds: ["us-gaap:EarningsPerShareBasic"],
          periodType: "annual",
        },
        pointInTimeQuerySchema.parse({
          effectiveAt: "2026-01-01T00:00:00.000Z",
          sourcePolicyVersion: "source-policy-1.0.0",
          ...input,
        }),
        {
          corporateActions: createPostgresCorporateActionRepository(database),
          observations: createPostgresObservationRepository(database),
        },
      );

    const adjusted = await read({
      revisionPolicy: "latest_restated",
      adjustmentPolicy: "latest_adjusted",
    });
    const beforeSplit = await read({
      revisionPolicy: "as_known",
      knownAt: "2025-01-01T00:00:00.000Z",
      adjustmentPolicy: "as_known",
    });

    expect(
      adjusted.rows.map((row) => [row.observation.asOf, row.value]),
    ).toStrictEqual([
      ["2021-12-31", "0.4"],
      ["2022-12-31", "0.48"],
      ["2023-12-31", "0.78"],
      ["2024-12-31", "0.9"],
    ]);
    expect(
      beforeSplit.rows.map((row) => [row.observation.asOf, row.value]),
    ).toStrictEqual([
      ["2021-12-31", "1.6"],
      ["2022-12-31", "1.9"],
      ["2023-12-31", "3.1"],
    ]);
  });

  it("rechaza en la base un split con ratio uno o sin ratio", async () => {
    await record();

    for (const terms of [`'{"ratio":"1"}'`, `'{"ratio":"0.5"}'`, `'{}'`]) {
      await expectConstraintViolation(
        () =>
          database.execute(
            sql.raw(
              `update corporate_actions set terms = ${terms}::jsonb where action_type = 'split'`,
            ),
          ),
        "corporate_actions_split_terms_check",
      );
    }
  });

  it("rechaza en la base un ratio que no es un decimal canónico sin romper el cast", async () => {
    await record();

    await expectConstraintViolation(
      () =>
        database.execute(
          sql`update corporate_actions set terms = '{"ratio":"4e0"}'::jsonb where action_type = 'split'`,
        ),
      "corporate_actions_split_terms_check",
    );
  });

  it("rechaza en la base un reverse split con ratio mayor que uno", async () => {
    await record();

    await expectConstraintViolation(
      () =>
        database.execute(
          sql`update corporate_actions set action_type = 'reverse_split' where action_type = 'split'`,
        ),
      "corporate_actions_split_terms_check",
    );
  });

  it("rechaza en la base un split sobre una security", async () => {
    await record();

    await expectConstraintViolation(
      () =>
        database.execute(
          sql`update corporate_actions set subject_type = 'security' where action_type = 'split'`,
        ),
      "corporate_actions_split_terms_check",
    );
  });
});
