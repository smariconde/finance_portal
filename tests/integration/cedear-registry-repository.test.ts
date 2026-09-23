import { createHash, randomUUID } from "node:crypto";

import { inArray } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CedearSourceProvider } from "@/modules/cedears/application/live-cedear-source";
import { recordCedearRegistry } from "@/modules/cedears/application/record-cedear-registry";
import { COMAFI_DEPOSITARY } from "@/modules/cedears/domain/cedear-depositaries";
import { parseComafiProducts } from "@/modules/cedears/domain/parse-comafi-products";
import { resolveCedearAccess } from "@/modules/cedears/domain/resolve-cedear-access";
import {
  FIXTURE_CEDEAR_ISINS,
  FIXTURE_UNDERLYING_IDS,
  fixtureCedearGraph,
  fixtureComafiProducts,
} from "@/modules/cedears/infrastructure/fixture-cedear-publications";
import { normalizeSymbol } from "@/modules/identity/domain/identity-graph";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { createPostgresCedearRegistryRepository } from "@/server/db/postgres-cedear-registry-repository";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresUniverseRepository } from "@/server/db/postgres-universe-repository";
import * as schema from "@/server/db/schema";
import { toTemporalRow } from "@/server/db/temporal-row";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const CEDEAR_SOURCES = ["comafi-cedear", "caja-valores-cedear"];
const FIRST_SEEN = "2026-09-23T03:00:00.000Z";
const RATIO_CHANGE_SEEN = "2026-10-01T03:00:00.000Z";
const WITHDRAWAL_SEEN = "2026-10-08T03:00:00.000Z";

type PostgresErrorShape = { code?: string; constraint_name?: string };

let sql: Sql;
let database: PostgresJsDatabase<typeof schema>;

function source(
  observedAt: string,
  overrides: Parameters<typeof fixtureComafiProducts>[0] = {},
): CedearSourceProvider {
  return {
    async load(sourceId) {
      const publication = parseComafiProducts(fixtureComafiProducts(overrides));

      if (!publication.ok) {
        throw new Error(publication.code);
      }

      return { sourceId, publication, byteLength: 2048, fetchedAt: observedAt };
    },
  };
}

function record(
  observedAt: string,
  overrides: Parameters<typeof fixtureComafiProducts>[0] = {},
) {
  const universe = createPostgresUniverseRepository(database);

  return recordCedearRegistry(
    { sourceId: "comafi-cedear" },
    {
      source: source(observedAt, overrides),
      repository: createPostgresCedearRegistryRepository(database),
      ingestionRuns: createPostgresIngestionRunRepository(database),
      loadGraph: async () =>
        (await universe.loadState({ indexId: "sp500" })).graph,
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
      hashContent: (input) => createHash("sha256").update(input).digest("hex"),
    },
  );
}

async function resetRegistry() {
  // Primero lo que apunta a la identidad: varios archivos vecinos vacían
  // `securities` y `legal_entities`, y una fila del registro dejada atrás les
  // bloquearía el borrado con su foreign key.
  await database.delete(schema.depositaryRatios);
  await database.delete(schema.depositaryProgramVersions);
  await database.delete(schema.depositaryPrograms);
  await database
    .delete(schema.ingestionRuns)
    .where(inArray(schema.ingestionRuns.sourceId, CEDEAR_SOURCES));
  await database.delete(schema.legalEntityRelationships);
  await database.delete(schema.corporateActions);
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

/** El grafo sintético de la fixture, escrito como lo dejaría la constitución. */
async function seedGraph() {
  const graph = fixtureCedearGraph();

  await database
    .insert(schema.legalEntities)
    .values(
      graph.legalEntities.map(({ legalEntityId }) => ({ legalEntityId })),
    );
  await database.insert(schema.legalEntityVersions).values(
    graph.legalEntities.map((entity) => ({
      ...toTemporalRow(entity),
      legalEntityId: entity.legalEntityId,
      legalName: entity.legalName,
      entityType: entity.entityType,
      jurisdiction: entity.jurisdiction,
      status: entity.status,
    })),
  );
  await database
    .insert(schema.securities)
    .values(graph.securities.map(({ securityId }) => ({ securityId })));
  await database.insert(schema.securityVersions).values(
    graph.securities.map((security) => ({
      ...toTemporalRow(security),
      securityId: security.securityId,
      issuerLegalEntityId: security.issuerLegalEntityId,
      securityType: security.securityType,
      shareClass: security.shareClass,
      economicCurrency: security.economicCurrency,
      status: security.status,
    })),
  );
  await database
    .insert(schema.listings)
    .values(graph.listings.map(({ listingId }) => ({ listingId })));
  await database.insert(schema.listingVersions).values(
    graph.listings.map((listing) => ({
      ...toTemporalRow(listing),
      listingId: listing.listingId,
      securityId: listing.securityId,
      mic: listing.mic,
      quoteCurrency: listing.quoteCurrency,
      country: listing.country,
      status: listing.status,
      primaryListing: listing.primaryListing,
    })),
  );
  await database.insert(schema.listingSymbols).values(
    graph.listingSymbols.map((symbol) => ({
      ...toTemporalRow(symbol),
      listingSymbolId: symbol.listingSymbolId,
      listingId: symbol.listingId,
      symbol: symbol.symbol,
      normalizedSymbol: normalizeSymbol(symbol.symbol),
      symbolType: symbol.symbolType,
    })),
  );
}

async function openPrograms() {
  const registry = await createPostgresCedearRegistryRepository(
    database,
  ).loadRegistry({});

  return registry.programs.filter((program) => program.supersededAt === null);
}

function asKnown(at: string) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: at,
    revisionPolicy: "as_known",
    knownAt: at,
    sourcePolicyVersion: "source-policy-1.0.0",
  });
}

function violation(error: unknown): PostgresErrorShape {
  const cause = (error as { cause?: PostgresErrorShape }).cause;

  return cause ?? (error as PostgresErrorShape);
}

beforeAll(() => {
  sql = postgres(databaseTestUrl, { max: 2 });
  database = drizzle(sql, { schema });
});

afterAll(async () => {
  await resetRegistry();
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await resetRegistry();
  await seedGraph();
});

describe("CEDEAR registry on PostgreSQL", () => {
  it("records the depositary, each CEDEAR as its own security, its program and its ratio", async () => {
    const outcome = await record(FIRST_SEEN);

    expect(outcome.runStatus).toBe("partial");
    expect(outcome.summary?.applied).toEqual({
      legalEntities: 1,
      securities: 3,
      identifierAssignments: 6,
      programs: 3,
      programSupersessions: 0,
      ratios: 3,
      ratioSupersessions: 0,
    });

    const cedears = await database
      .select()
      .from(schema.securityVersions)
      .where(
        inArray(schema.securityVersions.issuerLegalEntityId, [
          COMAFI_DEPOSITARY.legalEntityId,
        ]),
      );

    expect(cedears).toHaveLength(3);

    for (const row of cedears) {
      expect(row.securityType).toBe("depositary_receipt");
      // La vigencia es la observación, no el instante de la escritura.
      expect(row.availableAt.toISOString()).toBe(FIRST_SEEN);
    }

    const ratios = await database.select().from(schema.depositaryRatios);

    expect(
      ratios.map((row) => [row.depositaryUnits, row.underlyingUnits]).sort(),
    ).toEqual([
      ["1", "4"],
      ["10", "1"],
      ["144", "1"],
    ]);
  });

  it("puts the open programs in the persisted graph", async () => {
    await record(FIRST_SEEN);
    const { graph } = await createPostgresUniverseRepository(
      database,
    ).loadState({
      indexId: "sp500",
    });

    expect(
      graph.depositaryPrograms
        .map((program) => program.underlyingSecurityId)
        .sort(),
    ).toEqual(
      [
        FIXTURE_UNDERLYING_IDS.alphaSecurity,
        FIXTURE_UNDERLYING_IDS.betaSecurity,
        FIXTURE_UNDERLYING_IDS.gammaClassA,
      ].sort(),
    );
    expect(graph.depositaryRatios).toHaveLength(3);
  });

  it("is idempotent: the same publication again writes nothing", async () => {
    await record(FIRST_SEEN);
    const again = await record(RATIO_CHANGE_SEEN);

    expect(again.runStatus).toBe("duplicate");
    expect(again.summary).toBeNull();
    expect(
      await database.select().from(schema.depositaryProgramVersions),
    ).toHaveLength(3);
    expect(await database.select().from(schema.depositaryRatios)).toHaveLength(
      3,
    );
  });

  it("supersedes a changed ratio without leaking it into an earlier as_known", async () => {
    await record(FIRST_SEEN);
    const changed = await record(RATIO_CHANGE_SEEN, { alphaRatio: "20:1" });

    expect(changed.summary?.applied).toMatchObject({
      programs: 0,
      ratios: 1,
      ratioSupersessions: 1,
    });

    const registry = await createPostgresCedearRegistryRepository(
      database,
    ).loadRegistry({});
    const unitsAt = (at: string) => {
      const access = resolveCedearAccess(
        registry,
        FIXTURE_UNDERLYING_IDS.alphaSecurity,
        asKnown(at),
      );

      return access.status === "program"
        ? access.programs[0]!.ratio?.depositaryUnits
        : access.reason;
    };

    expect(unitsAt("2026-09-30T00:00:00.000Z")).toBe("10");
    expect(unitsAt("2026-10-02T00:00:00.000Z")).toBe("20");
  });

  it("withdraws a program the issuer stops listing and reopens it under the same ID", async () => {
    await record(FIRST_SEEN);
    const withdrawn = await record(WITHDRAWAL_SEEN, {
      omit: [FIXTURE_CEDEAR_ISINS.alpha],
    });

    expect(withdrawn.plan.withdrawn).toHaveLength(1);
    expect(await openPrograms()).toHaveLength(2);

    const reopened = await record("2026-10-15T03:00:00.000Z");
    const programs = await database
      .select()
      .from(schema.depositaryProgramVersions);
    const alpha = programs.filter(
      (row) =>
        row.underlyingSecurityId === FIXTURE_UNDERLYING_IDS.alphaSecurity,
    );

    expect(reopened.summary?.applied.securities).toBe(0);
    expect(alpha).toHaveLength(2);
    expect(new Set(alpha.map((row) => row.depositaryProgramId)).size).toBe(1);
    expect(await openPrograms()).toHaveLength(3);
  });

  it("refuses two open programs for the same CEDEAR and a program that merges instruments", async () => {
    await record(FIRST_SEEN);
    const [program] = await database
      .select()
      .from(schema.depositaryProgramVersions)
      .limit(1);

    const secondId = randomUUID();
    await database
      .insert(schema.depositaryPrograms)
      .values({ depositaryProgramId: secondId });

    const duplicateOpen = await database
      .insert(schema.depositaryProgramVersions)
      .values({ ...program!, depositaryProgramId: secondId })
      .then(
        () => null,
        (error: unknown) => violation(error),
      );

    expect(duplicateOpen).toMatchObject({
      code: "23505",
      constraint_name: "depositary_program_versions_depositary_open_uidx",
    });

    const merged = await database
      .insert(schema.depositaryProgramVersions)
      .values({
        ...program!,
        depositaryProgramId: secondId,
        underlyingSecurityId: program!.depositarySecurityId,
        supersededAt: new Date("2026-12-01T00:00:00.000Z"),
      })
      .then(
        () => null,
        (error: unknown) => violation(error),
      );

    expect(merged).toMatchObject({
      code: "23514",
      constraint_name: "depositary_program_versions_distinct_securities_check",
    });
  });

  it("refuses a second open ratio and a zero ratio", async () => {
    await record(FIRST_SEEN);
    const [ratio] = await database
      .select()
      .from(schema.depositaryRatios)
      .limit(1);

    const secondOpen = await database
      .insert(schema.depositaryRatios)
      .values({
        ...ratio!,
        depositaryRatioId: randomUUID(),
        validFrom: new Date("2026-11-01T00:00:00.000Z"),
      })
      .then(
        () => null,
        (error: unknown) => violation(error),
      );

    expect(secondOpen).toMatchObject({
      code: "23505",
      constraint_name: "depositary_ratios_open_uidx",
    });

    const zero = await database
      .insert(schema.depositaryRatios)
      .values({
        ...ratio!,
        depositaryRatioId: randomUUID(),
        depositaryUnits: "0",
        supersededAt: new Date("2026-12-01T00:00:00.000Z"),
      })
      .then(
        () => null,
        (error: unknown) => violation(error),
      );

    expect(zero).toMatchObject({
      code: "23514",
      constraint_name: "depositary_ratios_units_check",
    });
  });
});
