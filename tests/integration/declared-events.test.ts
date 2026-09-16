import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeSymbol } from "@/modules/identity/domain/identity-graph";
import { resolveIdentity } from "@/modules/identity/domain/resolve-identity";
import { planDeclaredEvent } from "@/modules/corporate-actions/domain/plan-declared-event";
import { resolveReportingLineage } from "@/modules/corporate-actions/domain/reporting-lineage";
import { recordDeclaredEvent } from "@/modules/corporate-actions/application/record-declared-event";
import type { DeclaredEvent } from "@/modules/corporate-actions/domain/declared-event";
import { createLiveListingEvidenceSource } from "@/modules/corporate-actions/application/live-listing-evidence-source";
import {
  acquisitionEvidence,
  symbolEvidence,
  FIXTURE_ACQUISITION,
  FIXTURE_SYMBOL_CHANGE,
  DECLARED_EVENT_CLOCK,
} from "@/modules/corporate-actions/infrastructure/fixture-declared-events";
import {
  buildFixtureListingGraph,
  fixtureSubmissionsPayload,
  fixtureIds,
  FIXTURE_LISTING_FILERS,
} from "@/modules/corporate-actions/infrastructure/fixture-listing-events";
import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import { ASSIGNMENTS_URL } from "@/modules/universe/application/live-universe-source";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createPostgresCorporateActionRepository } from "@/server/db/postgres-corporate-action-repository";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresSourceDocumentRepository } from "@/server/db/postgres-source-document-repository";
import { createPostgresSourceRegistryRepository } from "@/server/db/postgres-source-registry-repository";
import { createPostgresUniverseRepository } from "@/server/db/postgres-universe-repository";
import * as schema from "@/server/db/schema";
import { toTemporalRow, toTemporalFields } from "@/server/db/temporal-row";

describe("PostgreSQL declared corporate events", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;
  async function clean() {
    await database.delete(schema.legalEntityRelationships);
    await database.delete(schema.corporateActions);
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

  /** El grafo como lo dejó una constitución. */
  async function seedGraph() {
    const graph = buildFixtureListingGraph();

    await database
      .insert(schema.legalEntities)
      .values(
        graph.legalEntities.map(({ legalEntityId }) => ({ legalEntityId })),
      );
    await database.insert(schema.legalEntityVersions).values(
      graph.legalEntities.map((version) => ({
        ...toTemporalRow(version),
        legalEntityId: version.legalEntityId,
        legalName: version.legalName,
        entityType: version.entityType,
        jurisdiction: version.jurisdiction,
        status: version.status,
      })),
    );
    await database
      .insert(schema.securities)
      .values(graph.securities.map(({ securityId }) => ({ securityId })));
    await database.insert(schema.securityVersions).values(
      graph.securities.map((version) => ({
        ...toTemporalRow(version),
        securityId: version.securityId,
        issuerLegalEntityId: version.issuerLegalEntityId,
        securityType: version.securityType,
        shareClass: version.shareClass,
        economicCurrency: version.economicCurrency,
        status: version.status,
      })),
    );
    await database
      .insert(schema.listings)
      .values(graph.listings.map(({ listingId }) => ({ listingId })));
    await database.insert(schema.listingVersions).values(
      graph.listings.map((version) => ({
        ...toTemporalRow(version),
        listingId: version.listingId,
        securityId: version.securityId,
        mic: version.mic,
        quoteCurrency: version.quoteCurrency,
        country: version.country,
        status: version.status,
        primaryListing: version.primaryListing,
      })),
    );
    await database.insert(schema.listingSymbols).values(
      graph.listingSymbols.map((version) => ({
        ...toTemporalRow(version),
        listingSymbolId: version.listingSymbolId,
        listingId: version.listingId,
        symbol: version.symbol,
        normalizedSymbol: normalizeSymbol(version.symbol),
        symbolType: version.symbolType,
      })),
    );
    await database.insert(schema.identifierAssignments).values(
      graph.identifierAssignments.map((version) => ({
        ...toTemporalRow(version),
        identifierAssignmentId: version.identifierAssignmentId,
        subjectType: version.subjectType,
        subjectId: version.subjectId,
        identifierType: version.identifierType,
        identifierValue: version.identifierValue,
        normalizedValue: version.normalizedValue,
        scope: version.scope,
        issuingAuthority: version.issuingAuthority,
        confidence: version.confidence,
      })),
    );
  }

  const acquisition = acquisitionEvidence();
  const payloads = new Map<string, unknown>([
    [
      buildSubmissionsUrl(FIXTURE_ACQUISITION.acquiredCik),
      fixtureSubmissionsPayload(acquisition.acquired),
    ],
    [
      buildSubmissionsUrl(FIXTURE_ACQUISITION.acquirerCik),
      fixtureSubmissionsPayload(acquisition.acquirer),
    ],
    [
      ASSIGNMENTS_URL,
      {
        fields: ["cik", "name", "ticker", "exchange"],
        data: symbolEvidence().assignments.map((a) => [
          Number(a.cik),
          a.name,
          a.ticker,
          a.exchange,
        ]),
      },
    ],
  ]);
  function record(declaration: DeclaredEvent) {
    return recordDeclaredEvent(
      { declaration, mode: "personal", dryRun: false },
      {
        sourceRegistry: createPostgresSourceRegistryRepository(database),
        ingestionRuns: createPostgresIngestionRunRepository(database),
        sourceDocuments: createPostgresSourceDocumentRepository(database),
        corporateActions: createPostgresCorporateActionRepository(database),
        loadIdentityGraph: async () =>
          (
            await createPostgresUniverseRepository(database).loadState({
              indexId: "fixture-index",
            })
          ).graph,
        source: createLiveListingEvidenceSource({
          fetch: async ({ url }) => {
            const body = new TextEncoder().encode(
              JSON.stringify(payloads.get(url)),
            );
            return {
              status: 200,
              body,
              byteLength: body.byteLength,
              fetchedAt: DECLARED_EVENT_CLOCK,
            };
          },
        }),
        now: () => DECLARED_EVENT_CLOCK,
        newId: randomUUID,
      },
    );
  }
  beforeAll(async () => {
    client = postgres(process.env.DATABASE_TEST_URL!.trim(), {
      max: 1,
      prepare: false,
      connect_timeout: 10,
    });
    database = drizzle(client, { schema });
    await createPostgresSourceRegistryRepository(database).upsert(
      DEMO_SOURCE_REGISTRY.find((e) => e.sourceId === "sec-edgar")!,
    );
  });
  beforeEach(async () => {
    await clean();
    await seedGraph();
  });
  afterAll(async () => {
    if (database) await clean();
    await client?.end();
  });

  it("persists acquisition and replays without duplicating edges or events", async () => {
    const first = await record(FIXTURE_ACQUISITION);
    expect(first.run.status).toBe("succeeded");
    expect(first.applied).toEqual({
      corporateActions: 1,
      relationships: 1,
      listingSymbols: 0,
      supersessions: 0,
    });
    const repository = createPostgresCorporateActionRepository(database);
    const edges = await repository.listRelationships();
    expect(edges[0]!.availableAt).toBe("2025-09-17T20:01:49.000Z");
    const query = {
      effectiveAt: DECLARED_EVENT_CLOCK,
      knownAt: DECLARED_EVENT_CLOCK,
      revisionPolicy: "as_known" as const,
      adjustmentPolicy: "as_known" as const,
      knowledgeBasis: "public_availability" as const,
      sourcePolicyVersion: "fixture-1.0.0",
    };
    expect(
      resolveReportingLineage(edges, edges[0]!.successorLegalEntityId, query)
        .segments,
    ).toHaveLength(1);
    const second = await record(FIXTURE_ACQUISITION);
    expect(second.run.status).toBe("duplicate");
    expect(await repository.listRelationships()).toEqual(edges);
    expect(await repository.listCorporateActions()).toHaveLength(1);
  });

  it("persists a ticker correction with original answers before owner knowledge", async () => {
    const first = await record(FIXTURE_SYMBOL_CHANGE);
    expect(first.run.status).toBe("succeeded");
    expect(first.applied).toEqual({
      corporateActions: 1,
      relationships: 0,
      listingSymbols: 2,
      supersessions: 1,
    });
    const state = await createPostgresUniverseRepository(database).loadState({
      indexId: "fixture-index",
    });
    const rows = await database.select().from(schema.listingSymbols);
    const graph = {
      ...state.graph,
      listingSymbols: rows.map((r) => ({
        ...toTemporalFields(r),
        listingSymbolId: r.listingSymbolId,
        listingId: r.listingId,
        symbol: r.symbol,
        symbolType: r.symbolType,
      })),
    };
    const query = {
      effectiveAt: "2025-09-18T00:00:00.000Z",
      knownAt: "2025-09-20T18:00:04.000Z",
      revisionPolicy: "as_known" as const,
      adjustmentPolicy: "as_known" as const,
      knowledgeBasis: "public_availability" as const,
      sourcePolicyVersion: "fixture-1.0.0",
    };
    expect(
      resolveIdentity(graph, { symbol: "OLDT", mic: "XNYS" }, query).status,
    ).toBe("resolved");
    expect(
      resolveIdentity(graph, { symbol: "NEWT", mic: "XNYS" }, query).status,
    ).toBe("not_found");
    expect(
      resolveIdentity(
        graph,
        { symbol: "NEWT", mic: "XNYS" },
        { ...query, knownAt: DECLARED_EVENT_CLOCK },
      ).status,
    ).toBe("resolved");
    expect((await record(FIXTURE_SYMBOL_CHANGE)).run.status).toBe("duplicate");
    expect(await database.select().from(schema.listingSymbols)).toHaveLength(
      rows.length,
    );
  });

  it("permits many acquisitions per buyer while preserving a unique reporting predecessor", async () => {
    await record(FIXTURE_ACQUISITION);
    const [edge] = await database
      .select()
      .from(schema.legalEntityRelationships);
    await database.insert(schema.legalEntityRelationships).values({
      ...edge!,
      relationshipId: randomUUID(),
      predecessorLegalEntityId: fixtureIds(FIXTURE_LISTING_FILERS.transfer)
        .legalEntityId,
    });
    expect(
      await database.select().from(schema.legalEntityRelationships),
    ).toHaveLength(2);
    await expect(
      database
        .insert(schema.legalEntityRelationships)
        .values({ ...edge!, relationshipId: randomUUID() }),
    ).rejects.toThrow();
    await database.insert(schema.legalEntityRelationships).values({
      ...edge!,
      relationshipType: "reporting_successor",
      relationshipId: randomUUID(),
    });
    await expect(
      database.insert(schema.legalEntityRelationships).values({
        ...edge!,
        relationshipType: "reporting_successor",
        relationshipId: randomUUID(),
        predecessorLegalEntityId: fixtureIds(FIXTURE_LISTING_FILERS.transfer)
          .legalEntityId,
      }),
    ).rejects.toThrow();
  });

  it("rolls back symbol supersession when a later action insert conflicts", async () => {
    const graph = (
      await createPostgresUniverseRepository(database).loadState({
        indexId: "fixture-index",
      })
    ).graph;
    const plan = planDeclaredEvent({
      declaration: FIXTURE_SYMBOL_CHANGE,
      evidence: symbolEvidence(),
      graph,
      relationships: [],
      corporateActions: [],
      recordedAt: DECLARED_EVENT_CLOCK,
      newId: randomUUID,
    });
    const [action] = plan.corporateActions;
    await database.insert(schema.corporateActions).values({
      ...action!,
      availableAt: new Date(action!.availableAt),
      announcedAt: null,
      recordedAt: new Date(action!.recordedAt),
    });
    const before = await database.select().from(schema.listingSymbols);
    await expect(
      createPostgresCorporateActionRepository(database).applyDeclaredEventPlan(
        plan,
      ),
    ).rejects.toThrow();
    expect(await database.select().from(schema.listingSymbols)).toEqual(before);
  });

  it("refuses a stale plan atomically", async () => {
    const first = await record(FIXTURE_SYMBOL_CHANGE);
    await expect(
      createPostgresCorporateActionRepository(database).applyDeclaredEventPlan(
        first.plan!,
      ),
    ).rejects.toThrow("no longer open");
    expect(
      await createPostgresCorporateActionRepository(
        database,
      ).listCorporateActions(),
    ).toHaveLength(1);
  });

  it.each(["acquisition", "symbol_change"] as const)(
    "checks %s subject and mandatory declaration terms in PostgreSQL",
    async (actionType) => {
      await expect(
        database.insert(schema.corporateActions).values({
          corporateActionId: randomUUID(),
          actionType,
          subjectType: "security",
          subjectId: randomUUID(),
          effectiveOn: "2025-09-17",
          availableAt: new Date(DECLARED_EVENT_CLOCK),
          sourceId: "sec-edgar",
          sourceDocumentId: "fixture-invalid",
          contentHash: "a".repeat(64),
          terms: {},
        }),
      ).rejects.toThrow();
      const [row] = await database.execute<{ count: string }>(
        sql`select count(*) from corporate_actions`,
      );
      expect(Number(row!.count)).toBe(0);
    },
  );
});
