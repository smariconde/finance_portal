import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLiveSuccessionEvidenceSource } from "@/modules/corporate-actions/application/live-succession-evidence-source";
import { readLineageObservations } from "@/modules/corporate-actions/application/read-lineage-observations";
import { recordSuccession } from "@/modules/corporate-actions/application/record-succession";
import {
  buildFixtureDeclaration,
  buildSubmissionsPayload,
  buildSuccessionFixtureGraph,
  FIXTURE_EFFECTIVE_FROM,
  FIXTURE_PREDECESSOR_CIK,
  FIXTURE_PREDECESSOR_FILINGS,
  FIXTURE_PREDECESSOR_NAME,
  FIXTURE_SUCCESSION_ACCEPTED_AT,
  FIXTURE_SUCCESSOR_CIK,
  FIXTURE_SUCCESSOR_ENTITY_ID,
  FIXTURE_SUCCESSOR_FILINGS,
  FIXTURE_SUCCESSOR_NAME,
} from "@/modules/corporate-actions/infrastructure/fixture-succession";
import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  computeIdempotencyKey,
  ingestionRunSchema,
} from "@/modules/ingestion/domain/ingestion-run";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  computeObservationContentHash,
  computeRevisionGroupId,
  observationSchema,
  withIngestionFlags,
  type ObservationLogicalKey,
} from "@/modules/observations/domain/observation";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { createPostgresCorporateActionRepository } from "@/server/db/postgres-corporate-action-repository";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresObservationRepository } from "@/server/db/postgres-observation-repository";
import { createPostgresSourceDocumentRepository } from "@/server/db/postgres-source-document-repository";
import { createPostgresSourceRegistryRepository } from "@/server/db/postgres-source-registry-repository";
import { createPostgresUniverseRepository } from "@/server/db/postgres-universe-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const CLOCK = "2025-09-10T12:00:00.000Z";

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

const fetch: EgressFetch = async ({ url }) => {
  const payload =
    url === buildSubmissionsUrl(FIXTURE_SUCCESSOR_CIK)
      ? buildSubmissionsPayload({
          cik: FIXTURE_SUCCESSOR_CIK,
          name: FIXTURE_SUCCESSOR_NAME,
          filings: FIXTURE_SUCCESSOR_FILINGS,
        })
      : buildSubmissionsPayload({
          cik: FIXTURE_PREDECESSOR_CIK,
          name: FIXTURE_PREDECESSOR_NAME,
          filings: FIXTURE_PREDECESSOR_FILINGS,
        });
  const body = new TextEncoder().encode(JSON.stringify(payload));

  return {
    status: 200,
    body,
    byteLength: body.byteLength,
    fetchedAt: "2025-09-10T11:59:00.000Z",
  };
};

describe("PostgreSQL corporate actions", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;

  function dependencies() {
    const universe = createPostgresUniverseRepository(database);

    return {
      sourceRegistry: createPostgresSourceRegistryRepository(database),
      ingestionRuns: createPostgresIngestionRunRepository(database),
      sourceDocuments: createPostgresSourceDocumentRepository(database),
      corporateActions: createPostgresCorporateActionRepository(database),
      loadIdentityGraph: async () =>
        (await universe.loadState({ indexId: "fixture-index" })).graph,
      source: createLiveSuccessionEvidenceSource({ fetch }),
      now: () => CLOCK,
      newId: () => randomUUID(),
    };
  }

  function record() {
    return recordSuccession(
      { declaration: buildFixtureDeclaration(), mode: "personal" },
      dependencies(),
    );
  }

  async function clean() {
    await database.delete(schema.legalEntityRelationships);
    await database.delete(schema.corporateActions);
    await database
      .delete(schema.observations)
      .where(
        inArray(
          schema.observations.ingestionRunId,
          database
            .select({ runId: schema.ingestionRuns.runId })
            .from(schema.ingestionRuns)
            .where(eq(schema.ingestionRuns.sourceId, "sec-edgar")),
        ),
      );
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

  /** El sucesor existe en el grafo desde la constitución, como XOM. */
  async function seedSuccessor() {
    const graph = buildSuccessionFixtureGraph();
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
    await seedSuccessor();
  });

  afterAll(async () => {
    if (database) {
      await clean();
    }
    await client?.end();
  });

  it("registra antecesor, CIK, evento y vínculo en una transacción legible de vuelta", async () => {
    const outcome = await record();

    expect(outcome.run?.status).toBe("succeeded");
    expect(outcome.applied).toStrictEqual({
      legalEntities: 1,
      identifierAssignments: 1,
      corporateActions: 1,
      relationships: 1,
    });

    const repository = createPostgresCorporateActionRepository(database);
    const [relationship] = await repository.listRelationships();

    expect(relationship).toMatchObject({
      predecessorLegalEntityId: outcome.plan!.predecessorLegalEntityId,
      successorLegalEntityId: FIXTURE_SUCCESSOR_ENTITY_ID,
      effectiveOn: "2025-07-01",
      validFrom: FIXTURE_EFFECTIVE_FROM,
      availableAt: FIXTURE_SUCCESSION_ACCEPTED_AT,
      sourceDocumentId: outcome.evidence!.successionFiling.accessionNumber,
    });

    // El hash leído de la base es el del plan: la conversión de fila no altera
    // el contenido, que es lo que hace idempotente la segunda corrida.
    expect(relationship!.contentHash).toBe(
      outcome.plan!.relationships[0]!.contentHash,
    );

    const graph = await dependencies().loadIdentityGraph();
    expect(
      graph.identifierAssignments
        .filter((assignment) => assignment.identifierType === "cik")
        .map((assignment) => assignment.normalizedValue)
        .sort(),
    ).toStrictEqual([FIXTURE_PREDECESSOR_CIK, FIXTURE_SUCCESSOR_CIK]);
  });

  it("la segunda corrida no agrega filas", async () => {
    await record();
    const counts = async () =>
      (
        await database.execute<{
          relationships: string;
          actions: string;
          entities: string;
        }>(
          sql`select
            (select count(*) from legal_entity_relationships) as relationships,
            (select count(*) from corporate_actions) as actions,
            (select count(*) from legal_entity_versions) as entities`,
        )
      )[0];
    const before = await counts();
    const second = await record();

    expect(second.run?.status).toBe("duplicate");
    expect(second.plan?.status).toBe("unchanged");
    expect(await counts()).toStrictEqual(before);
  });

  it("lee la historia unida desde PostgreSQL sin reasignar sujetos", async () => {
    const outcome = await record();
    const predecessorId = outcome.plan!.predecessorLegalEntityId!;
    const runs = createPostgresIngestionRunRepository(database);
    const observations = createPostgresObservationRepository(database);

    const run = await runs.append(
      ingestionRunSchema.parse({
        runId: randomUUID(),
        sourceId: "sec-edgar",
        datasetId: "sec.companyfacts",
        parserVersion: "sec-companyfacts-1.0.0",
        idempotencyKey: computeIdempotencyKey({
          sourceId: "sec-edgar",
          datasetId: "sec.companyfacts",
          parserVersion: "sec-companyfacts-1.0.0",
          requestedAsOf: null,
          cursor: null,
          subjectKey: "lineage-test",
        }),
        requestedAsOf: null,
        cursor: null,
        nextCursor: null,
        status: "succeeded",
        startedAt: CLOCK,
        finishedAt: CLOCK,
        counts: { fetched: 2, accepted: 2, rejected: 0, duplicate: 0 },
        contentHash: computeContentHash("lineage-test"),
        failure: null,
        qualityFlags: [],
        replayOfRunId: null,
        recordedAt: CLOCK,
      }),
    );

    const fact = (
      subjectId: string,
      asOf: string,
      rawValue: string,
      availableAt: string,
    ) => {
      const key: ObservationLogicalKey = {
        subjectType: "legal_entity",
        subjectId,
        metricId: "us-gaap:Revenues",
        concept: "us-gaap:Revenues",
        asOf,
        periodStart: `${asOf.slice(0, 4)}-01-01`,
        periodEnd: asOf,
        periodType: "annual",
        unit: "monetary",
        currency: "USD",
        sourceId: "sec-edgar",
        datasetId: "sec.companyfacts",
        valueBasis: "reported",
      };
      const externalId = `${subjectId}:${asOf}`;

      return observationSchema.parse({
        observationId: randomUUID(),
        ...key,
        parserVersion: "sec-companyfacts-1.0.0",
        rawValue,
        rawValueStatus: "stored",
        normalizedValue: null,
        transformationId: null,
        availableAt,
        supersededAt: null,
        fetchedAt: CLOCK,
        recordedAt: CLOCK,
        revisionGroupId: computeRevisionGroupId(key),
        revisionNumber: 1,
        restatementOfId: null,
        contentHash: computeObservationContentHash({
          logicalKey: key,
          parserVersion: "sec-companyfacts-1.0.0",
          rawValue,
          rawValueStatus: "stored",
          normalizedValue: null,
          availableAt,
          sourceDocumentId: null,
          externalId,
          qualityFlags: [],
        }),
        qualityFlags: withIngestionFlags([], availableAt, CLOCK),
        sourceDocumentId: null,
        ingestionRunId: run.runId,
      });
    };

    await observations.publish({
      ingestionRunId: run.runId,
      observations: [
        fact(predecessorId, "2024-12-31", "1000", "2025-02-20T21:05:00.000Z"),
        fact(
          FIXTURE_SUCCESSOR_ENTITY_ID,
          "2025-12-31",
          "1200",
          "2026-02-18T21:00:00.000Z",
        ),
      ],
      supersessions: [],
    });

    const read = (knownAt: string) =>
      readLineageObservations(
        {
          legalEntityId: FIXTURE_SUCCESSOR_ENTITY_ID,
          metricIds: ["us-gaap:Revenues"],
        },
        pointInTimeQuerySchema.parse({
          effectiveAt: knownAt,
          revisionPolicy: "as_known",
          knownAt,
          sourcePolicyVersion: "source-policy-1.0.0",
        }),
        {
          corporateActions: createPostgresCorporateActionRepository(database),
          observations,
        },
      );

    const today = await read("2026-06-01T00:00:00.000Z");
    expect(
      today.observations.map((row) => [row.asOf, row.subjectId]),
    ).toStrictEqual([
      ["2024-12-31", predecessorId],
      ["2025-12-31", FIXTURE_SUCCESSOR_ENTITY_ID],
    ]);

    // Un segundo antes de la 8-K12B el vínculo no se conoce: el sucesor no tiene
    // historia propia todavía.
    const before = await read("2025-07-01T15:09:59.000Z");
    expect(before.lineage.segments).toHaveLength(1);
    expect(before.observations).toHaveLength(0);
  });

  it("rechaza en la base la vigencia leída como medianoche UTC", async () => {
    await record();

    await expectConstraintViolation(
      () =>
        database.execute(
          sql`update legal_entity_relationships set valid_from = '2025-07-01T00:00:00Z'`,
        ),
      "legal_entity_relationships_valid_from_check",
    );
  });

  it("rechaza en la base un segundo antecesor abierto para el mismo sucesor", async () => {
    const outcome = await record();
    const other = randomUUID();
    const [existing] =
      await createPostgresCorporateActionRepository(
        database,
      ).listRelationships();

    await database
      .insert(schema.legalEntities)
      .values({ legalEntityId: other });

    await expectConstraintViolation(
      () =>
        database.insert(schema.legalEntityRelationships).values({
          relationshipId: randomUUID(),
          relationshipType: "reporting_successor",
          predecessorLegalEntityId: other,
          successorLegalEntityId: FIXTURE_SUCCESSOR_ENTITY_ID,
          corporateActionId: existing!.corporateActionId,
          effectiveOn: "2025-07-01",
          decidedBy: "owner",
          decisionRuleVersion: "sec-succession-evidence-1.0.0",
          validFrom: new Date(FIXTURE_EFFECTIVE_FROM),
          availableAt: new Date(FIXTURE_SUCCESSION_ACCEPTED_AT),
          sourceId: "sec-edgar",
          contentHash: "c".repeat(64),
        }),
      "legal_entity_relationships_successor_open_uidx",
    );
    expect(outcome.plan?.status).toBe("planned");
  });

  it("rechaza en la base una entidad que se sucede a sí misma", async () => {
    await record();

    await expectConstraintViolation(
      () =>
        database.execute(
          sql`update legal_entity_relationships set predecessor_legal_entity_id = successor_legal_entity_id`,
        ),
      "legal_entity_relationships_distinct_entities_check",
    );
  });

  it("rechaza en la base una segunda descripción del mismo evento", async () => {
    await record();

    await expectConstraintViolation(
      () =>
        database.execute(
          sql`insert into corporate_actions
            (corporate_action_id, action_type, subject_type, subject_id, effective_on, available_at, source_id, source_document_id, content_hash)
            select gen_random_uuid(), action_type, subject_type, subject_id, effective_on, available_at, source_id, source_document_id, repeat('d', 64)
            from corporate_actions`,
        ),
      "corporate_actions_source_document_uidx",
    );
  });
});
