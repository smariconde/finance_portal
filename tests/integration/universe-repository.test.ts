import { randomUUID } from "node:crypto";

import { eq, isNull, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveIdentity } from "@/modules/identity/domain/resolve-identity";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";
import { constituteUniverse } from "@/modules/universe/application/constitute-universe";
import {
  FIXTURE_CONSTITUENT_CLAIMS,
  FIXTURE_INDEX_ID,
  FIXTURE_TICKER_ASSIGNMENTS,
  FIXTURE_UNIVERSE_DOCUMENT,
  FIXTURE_UNIVERSE_SOURCE_ID,
} from "@/modules/universe/infrastructure/fixture-universe-source";
import { createPostgresUniverseRepository } from "@/server/db/postgres-universe-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

const AVAILABLE_AT = "2026-01-01T12:00:00.000Z";
const EFFECTIVE_AT = "2026-01-02T00:00:00.000Z";
const RECORDED_AT = "2026-01-03T00:00:00.000Z";
const LATER_AVAILABLE_AT = "2026-03-20T12:00:00.000Z";
const LATER_EFFECTIVE_AT = "2026-04-01T00:00:00.000Z";

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
    effectiveAt: "2026-02-01T00:00:00.000Z",
    revisionPolicy: "as_known",
    knownAt: "2026-02-01T00:00:00.000Z",
    sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
    ...overrides,
  } as PointInTimeQueryInput);
}

describe("universo S&P 500 sobre PostgreSQL", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;
  let repository: ReturnType<typeof createPostgresUniverseRepository>;

  async function constitute(
    overrides: {
      effectiveAt?: string;
      availableAt?: string;
      claims?: typeof FIXTURE_CONSTITUENT_CLAIMS;
      assignments?: typeof FIXTURE_TICKER_ASSIGNMENTS;
    } = {},
  ) {
    return constituteUniverse(
      {
        indexId: FIXTURE_INDEX_ID,
        effectiveAt: overrides.effectiveAt ?? EFFECTIVE_AT,
        availableAt: overrides.availableAt ?? AVAILABLE_AT,
        sourceId: FIXTURE_UNIVERSE_SOURCE_ID,
        sourceDocumentId: FIXTURE_UNIVERSE_DOCUMENT,
        claims: [...(overrides.claims ?? FIXTURE_CONSTITUENT_CLAIMS)],
        assignments: [...(overrides.assignments ?? FIXTURE_TICKER_ASSIGNMENTS)],
      },
      { repository, now: () => RECORDED_AT, newId: () => randomUUID() },
    );
  }

  async function countRows(): Promise<Record<string, number>> {
    const [row] = await database.execute<Record<string, string>>(sql`
      select
        (select count(*) from legal_entity_versions) as entities,
        (select count(*) from security_versions) as securities,
        (select count(*) from listing_versions) as listings,
        (select count(*) from listing_symbols) as symbols,
        (select count(*) from identifier_assignments) as assignments,
        (select count(*) from index_memberships) as memberships
    `);

    return Object.fromEntries(
      Object.entries(row!).map(([key, value]) => [key, Number(value)]),
    );
  }

  beforeAll(async () => {
    client = postgres(databaseTestUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    database = drizzle(client, { schema });
    repository = createPostgresUniverseRepository(database);

    // Estado conocido: el archivo constituye su propio universo desde cero.
    await database.delete(schema.indexMemberships);
    await database.delete(schema.identifierAssignments);
    await database.delete(schema.listingSymbols);
    await database.delete(schema.listingVersions);
    await database.delete(schema.listings);
    await database.delete(schema.securityVersions);
    await database.delete(schema.legalEntityVersions);
    await database.delete(schema.securities);
    await database.delete(schema.legalEntities);
  });

  afterAll(async () => {
    await client?.end();
  });

  it("constituye identidad completa y la deja resoluble por ticker y venue", async () => {
    const { summary } = await constitute();

    expect(summary.members).toBe(4);
    expect(summary.applied).toMatchObject({
      legalEntities: 3,
      securities: 4,
      listings: 4,
      listingSymbols: 4,
      identifierAssignments: 3,
      memberships: 4,
      closures: 0,
    });

    const state = await repository.loadState({ indexId: FIXTURE_INDEX_ID });
    const resolution = resolveIdentity(
      state.graph,
      { symbol: "NWNDA", mic: "XNAS" },
      query(),
    );

    expect(resolution.status).toBe("resolved");

    // Los cuatro niveles viajan separados desde la base: el CIK identifica al
    // filer y el ticker apenas alcanza al listing.
    const [entityRow] = await database
      .select()
      .from(schema.legalEntityVersions)
      .where(
        eq(schema.legalEntityVersions.legalEntityId, resolution.legalEntityId!),
      );

    expect(entityRow?.legalName).toBe("Northwind Synthetic Inc");

    const [cikRow] = await database
      .select()
      .from(schema.identifierAssignments)
      .where(
        eq(schema.identifierAssignments.subjectId, resolution.legalEntityId!),
      );

    expect(cikRow).toMatchObject({
      identifierType: "cik",
      subjectType: "legal_entity",
      normalizedValue: "0009900002",
      confidence: "authoritative",
    });

    // Dos clases del mismo emisor: dos securities, un solo CIK.
    const issuerSecurities = await database
      .select()
      .from(schema.securityVersions)
      .where(
        eq(
          schema.securityVersions.issuerLegalEntityId,
          resolution.legalEntityId!,
        ),
      );

    expect(issuerSecurities).toHaveLength(2);
  });

  it("no escribe una fila más al repetir la misma constitución", async () => {
    const before = await countRows();
    const { summary } = await constitute();

    expect(summary.applied).toMatchObject({
      legalEntities: 0,
      securities: 0,
      memberships: 0,
      closures: 0,
    });
    expect(summary.members).toBe(4);
    expect(await countRows()).toEqual(before);
  });

  it("historiza un renombre sin reescribir la versión anterior", async () => {
    await constitute({
      effectiveAt: LATER_EFFECTIVE_AT,
      availableAt: LATER_AVAILABLE_AT,
      assignments: FIXTURE_TICKER_ASSIGNMENTS.map((assignment) =>
        assignment.ticker === "ANDES"
          ? { ...assignment, name: "Andes Synthetic Holdings" }
          : assignment,
      ),
    });

    const versions = await database
      .select()
      .from(schema.legalEntityVersions)
      .where(eq(schema.legalEntityVersions.legalName, "Andes Synthetic Corp"));

    expect(versions).toHaveLength(1);
    // La fila histórica conserva su nombre y recibe un fin de vigencia.
    expect(versions[0]!.validTo?.toISOString()).toBe(LATER_EFFECTIVE_AT);

    const current = await database
      .select()
      .from(schema.legalEntityVersions)
      .where(
        eq(
          schema.legalEntityVersions.legalEntityId,
          versions[0]!.legalEntityId,
        ),
      );

    expect(current).toHaveLength(2);
    expect(current.filter((version) => version.validTo === null)).toHaveLength(
      1,
    );
  });

  it("cierra la membresía de quien sale del índice sin borrar la fila", async () => {
    await constitute({
      effectiveAt: "2026-07-01T00:00:00.000Z",
      availableAt: "2026-06-20T00:00:00.000Z",
      claims: FIXTURE_CONSTITUENT_CLAIMS.filter(
        (claim) => claim.symbol !== "ANDES",
      ),
    });

    const memberships = await database.select().from(schema.indexMemberships);
    const closed = memberships.filter(
      (membership) => membership.validTo !== null,
    );

    expect(memberships).toHaveLength(4);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.validTo?.toISOString()).toBe("2026-07-01T00:00:00.000Z");

    // Salir del índice no deslista el instrumento.
    const listings = await database
      .select()
      .from(schema.listingVersions)
      .where(eq(schema.listingVersions.securityId, closed[0]!.securityId));

    expect(listings[0]?.status).toBe("active");
    expect(listings[0]?.validTo).toBeNull();
  });

  it("PostgreSQL rechaza dos versiones vigentes del mismo emisor", async () => {
    const [existing] = await database
      .select()
      .from(schema.legalEntityVersions)
      // Una versión vigente: copiar una ya cerrada probaría el check de
      // intervalo, no la invariante de "una sola versión abierta".
      .where(isNull(schema.legalEntityVersions.validTo))
      .limit(1);

    await expectConstraintViolation(
      () =>
        database.insert(schema.legalEntityVersions).values({
          ...existing!,
          validFrom: new Date("2027-01-01T00:00:00.000Z"),
        }),
      "legal_entity_versions_open_uidx",
    );
  });

  it("PostgreSQL rechaza el mismo identificador autoritativo para dos sujetos", async () => {
    const [existing] = await database
      .select()
      .from(schema.identifierAssignments)
      .limit(1);

    await expectConstraintViolation(
      () =>
        database.insert(schema.identifierAssignments).values({
          ...existing!,
          identifierAssignmentId: randomUUID(),
          subjectId: randomUUID(),
          validFrom: new Date("2027-01-01T00:00:00.000Z"),
        }),
      "identifier_assignments_authoritative_uidx",
    );
  });

  it("PostgreSQL rechaza una versión sin hash de contenido válido", async () => {
    const [existing] = await database
      .select()
      .from(schema.indexMemberships)
      .limit(1);

    await expectConstraintViolation(
      () =>
        database.insert(schema.indexMemberships).values({
          ...existing!,
          indexMembershipId: randomUUID(),
          securityId: existing!.securityId,
          validFrom: new Date("2027-01-01T00:00:00.000Z"),
          validTo: new Date("2027-02-01T00:00:00.000Z"),
          contentHash: "no-es-un-hash",
        }),
      "index_memberships_content_hash_check",
    );
  });
});
