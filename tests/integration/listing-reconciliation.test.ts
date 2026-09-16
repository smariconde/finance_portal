import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { StaleListingPlanError } from "@/modules/corporate-actions/application/corporate-action-repository";
import { createLiveListingEvidenceSource } from "@/modules/corporate-actions/application/live-listing-evidence-source";
import { reconcileListings } from "@/modules/corporate-actions/application/reconcile-listings";
import {
  computeCorporateActionContentHash,
  corporateActionSchema,
} from "@/modules/corporate-actions/domain/reporting-succession";
import {
  buildFixtureListingGraph,
  FIXTURE_LISTING_ASSIGNMENTS,
  FIXTURE_LISTING_FILERS,
  FIXTURE_LISTINGS_FETCHED_AT,
  FIXTURE_RENAME_BORDER,
  FIXTURE_RENAMED_TO,
  FIXTURE_TRANSFER_EFFECTIVE_AT,
  fixtureIds,
  fixtureListingIndex,
  fixtureSubmissionsPayload,
} from "@/modules/corporate-actions/infrastructure/fixture-listing-events";
import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import { normalizeSymbol } from "@/modules/identity/domain/identity-graph";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { ASSIGNMENTS_URL } from "@/modules/universe/application/live-universe-source";
import { createPostgresCorporateActionRepository } from "@/server/db/postgres-corporate-action-repository";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresSourceDocumentRepository } from "@/server/db/postgres-source-document-repository";
import { createPostgresSourceRegistryRepository } from "@/server/db/postgres-source-registry-repository";
import { createPostgresUniverseRepository } from "@/server/db/postgres-universe-repository";
import * as schema from "@/server/db/schema";
import { toTemporalRow } from "@/server/db/temporal-row";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const CLOCK = "2025-09-20T18:00:05.000Z";

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

const encoder = new TextEncoder();
const bodies = new Map<string, unknown>([
  [
    ASSIGNMENTS_URL,
    {
      fields: ["cik", "name", "ticker", "exchange"],
      data: FIXTURE_LISTING_ASSIGNMENTS.map((row) => [
        Number(row.cik),
        row.name,
        row.ticker,
        row.exchange,
      ]),
    },
  ],
  ...(
    Object.keys(
      FIXTURE_LISTING_FILERS,
    ) as (keyof typeof FIXTURE_LISTING_FILERS)[]
  ).map(
    (filer) =>
      [
        buildSubmissionsUrl(FIXTURE_LISTING_FILERS[filer].cik),
        fixtureSubmissionsPayload(fixtureListingIndex(filer)),
      ] as const,
  ),
]);

const fetch: EgressFetch = async ({ url }) => {
  const body = encoder.encode(JSON.stringify(bodies.get(url) ?? {}));

  return {
    status: bodies.has(url) ? 200 : 404,
    body,
    byteLength: body.byteLength,
    fetchedAt: FIXTURE_LISTINGS_FETCHED_AT,
  };
};

describe("PostgreSQL reconciliación de listings", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;

  function reconcile() {
    const universe = createPostgresUniverseRepository(database);

    return reconcileListings(
      {
        mode: "personal",
        requestedCiks: [FIXTURE_LISTING_FILERS.delisting.cik],
      },
      {
        sourceRegistry: createPostgresSourceRegistryRepository(database),
        ingestionRuns: createPostgresIngestionRunRepository(database),
        sourceDocuments: createPostgresSourceDocumentRepository(database),
        corporateActions: createPostgresCorporateActionRepository(database),
        loadIdentityGraph: async () =>
          (await universe.loadState({ indexId: "fixture-index" })).graph,
        source: createLiveListingEvidenceSource({ fetch }),
        now: () => CLOCK,
        newId: () => randomUUID(),
      },
    );
  }

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

  async function countRows() {
    const [row] = await database.execute<Record<string, string>>(sql`
      select
        (select count(*) from legal_entity_versions) as entities,
        (select count(*) from listing_versions) as listings,
        (select count(*) from listing_symbols) as symbols,
        (select count(*) from corporate_actions) as actions
    `);

    return row;
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
    await seedGraph();
  });

  afterAll(async () => {
    if (database) {
      await clean();
    }
    await client?.end();
  });

  it("mueve el listing, deslista y corrige el nombre en una transacción por filer", async () => {
    const outcome = await reconcile();

    expect(
      outcome.filers.map((filer) => [filer.cik, filer.run.status]),
    ).toEqual([
      [FIXTURE_LISTING_FILERS.transfer.cik, "succeeded"],
      [FIXTURE_LISTING_FILERS.delisting.cik, "succeeded"],
      [FIXTURE_LISTING_FILERS.rename.cik, "succeeded"],
      [FIXTURE_LISTING_FILERS.symbolChange.cik, "quarantined"],
    ]);

    const transfer = fixtureIds(FIXTURE_LISTING_FILERS.transfer);
    const listings = await database
      .select()
      .from(schema.listingVersions)
      .where(eq(schema.listingVersions.securityId, transfer.securityId))
      .orderBy(schema.listingVersions.validFrom);

    // El intervalo viejo termina justo donde empieza el nuevo, con otro ID.
    expect(
      listings.map((row) => [
        row.mic,
        row.validTo?.toISOString() ?? null,
        row.validFrom.toISOString(),
      ]),
    ).toEqual([
      ["XNAS", FIXTURE_TRANSFER_EFFECTIVE_AT, "2025-09-05T01:00:00.000Z"],
      ["XNYS", null, FIXTURE_TRANSFER_EFFECTIVE_AT],
    ]);
    expect(listings[1]!.listingId).not.toBe(transfer.listingId);

    const renamed = await database
      .select()
      .from(schema.legalEntityVersions)
      .where(
        eq(
          schema.legalEntityVersions.legalEntityId,
          fixtureIds(FIXTURE_LISTING_FILERS.rename).legalEntityId,
        ),
      )
      .orderBy(schema.legalEntityVersions.validFrom);

    expect(
      renamed.map((row) => [
        row.legalName,
        row.validFrom.toISOString(),
        row.supersededAt?.toISOString() ?? null,
      ]),
    ).toEqual([
      [FIXTURE_RENAMED_TO, FIXTURE_RENAME_BORDER, null],
      [
        "NOMBRE VIEJO SINTETICO INC",
        "2025-09-05T01:00:00.000Z",
        FIXTURE_LISTINGS_FETCHED_AT,
      ],
    ]);

    const openDelisted = await database
      .select()
      .from(schema.listingSymbols)
      .where(
        and(
          eq(
            schema.listingSymbols.listingSymbolId,
            fixtureIds(FIXTURE_LISTING_FILERS.delisting).listingSymbolId,
          ),
          sql`${schema.listingSymbols.validTo} is null`,
        ),
      );

    expect(openDelisted).toEqual([]);

    // La tabla vigente vuelve a resolver lo movido y lo renombrado.
    const state = await createPostgresUniverseRepository(database).loadState({
      indexId: "fixture-index",
    });
    const actions =
      await createPostgresCorporateActionRepository(
        database,
      ).listCorporateActions();

    expect(state.graph.listings).toHaveLength(5);
    expect(actions.map((action) => action.actionType).sort()).toEqual([
      "delisting",
      "listing_transfer",
    ]);
  });

  it("la segunda corrida no escribe nada", async () => {
    await reconcile();
    const before = await countRows();
    const again = await reconcile();

    expect(again.filers.map((filer) => filer.run.status)).toEqual([
      "quarantined",
    ]);
    expect(await countRows()).toEqual(before);
  });

  it("un plan sobre un grafo que cambió se deshace entero", async () => {
    const outcome = await reconcile();
    const plan = outcome.filers[0]!.plan!;
    const before = await countRows();

    await expect(
      createPostgresCorporateActionRepository(database).applyListingPlan(plan),
    ).rejects.toBeInstanceOf(StaleListingPlanError);
    expect(await countRows()).toEqual(before);
  });

  it("PostgreSQL rechaza un traspaso sin dos mercados y un delisting sobre otra cosa", async () => {
    const transfer = fixtureIds(FIXTURE_LISTING_FILERS.transfer);
    const base = {
      announcedAt: null,
      effectiveOn: "2025-09-09",
      availableAt: FIXTURE_TRANSFER_EFFECTIVE_AT,
      sourceId: "sec-edgar",
      sourceDocumentId: "0000876661-25-000999",
    } as const;
    const insert = (content: Record<string, unknown>) =>
      database.insert(schema.corporateActions).values({
        ...base,
        corporateActionId: randomUUID(),
        contentHash: "b".repeat(64),
        effectiveOn: base.effectiveOn,
        availableAt: new Date(base.availableAt),
        ...(content as {
          actionType: "listing_transfer" | "delisting";
          subjectType: "security" | "listing" | "legal_entity";
          subjectId: string;
          terms: Record<string, string>;
        }),
      });

    await expectConstraintViolation(
      () =>
        insert({
          actionType: "listing_transfer",
          subjectType: "security",
          subjectId: transfer.securityId,
          terms: { fromMic: "XNAS", toMic: "XNAS" },
        }),
      "corporate_actions_listing_terms_check",
    );
    await expectConstraintViolation(
      () =>
        insert({
          actionType: "delisting",
          subjectType: "legal_entity",
          subjectId: transfer.legalEntityId,
          terms: { mic: "XNAS" },
        }),
      "corporate_actions_listing_terms_check",
    );

    // El dominio decide lo mismo antes de llegar a la base.
    const content = {
      actionType: "delisting" as const,
      subjectType: "listing" as const,
      subjectId: transfer.listingId,
      ...base,
      terms: { mic: "XNAS" },
    };

    expect(() =>
      corporateActionSchema.parse({
        ...content,
        subjectType: "legal_entity",
        corporateActionId: randomUUID(),
        contentHash: computeCorporateActionContentHash(content),
        recordedAt: CLOCK,
      }),
    ).toThrow();
  });
});
