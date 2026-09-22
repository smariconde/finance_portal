import { createHash, randomUUID } from "node:crypto";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { classifyUniverseSectors } from "@/modules/classification/application/classify-universe-sectors";
import { SP500_SECTOR_TAXONOMY_ID } from "@/modules/classification/domain/sector-taxonomy";
import { subjectClassificationSchema } from "@/modules/classification/domain/subject-classification";
import { createPostgresClassificationRepository } from "@/server/db/postgres-classification-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

const ALPHABET = "11111111-1111-4111-8111-111111111111";
const EXXON = "44444444-4444-4444-8444-444444444444";

const PIN_A = {
  commit: "a".repeat(40),
  committedAt: "2026-06-01T00:00:00.000Z",
};

const PIN_B = {
  commit: "b".repeat(40),
  committedAt: "2026-09-05T01:39:10.000Z",
};

type PostgresErrorShape = { code?: string; constraint_name?: string };

let sql: Sql;
let database: PostgresJsDatabase<typeof schema>;

function dependencies() {
  return {
    repository: createPostgresClassificationRepository(database),
    now: () => "2026-09-21T12:00:00.000Z",
    newId: () => randomUUID(),
    hashContent: (input: string) =>
      createHash("sha256").update(input).digest("hex"),
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    claims: [
      { symbol: "GOOGL", sector: "Communication Services" },
      { symbol: "GOOG", sector: "Communication Services" },
      { symbol: "XOM", sector: "Energy" },
    ],
    resolved: [
      { claimSymbol: "GOOGL", normalizedCik: "0001652044" },
      { claimSymbol: "GOOG", normalizedCik: "0001652044" },
      { claimSymbol: "XOM", normalizedCik: "0000034088" },
    ],
    entityIdByCik: new Map([
      ["0001652044", ALPHABET],
      ["0000034088", EXXON],
    ]),
    pin: PIN_A,
    sourceId: "datahub-sp500-pddl" as const,
    sourceDocumentId: null,
    ...overrides,
  };
}

beforeAll(() => {
  sql = postgres(databaseTestUrl, { max: 2 });
  database = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await database.delete(schema.classificationAssignments);
});

describe("subject classifications on PostgreSQL", () => {
  it("persists one assertion per issuer, dated by the pin", async () => {
    const outcome = await classifyUniverseSectors(command(), dependencies());

    expect(outcome.summary?.applied.opened).toBe(2);

    const rows = await database.select().from(schema.classificationAssignments);

    expect(rows).toHaveLength(2);

    for (const row of rows) {
      // El `available_at` es el commit y no el instante de la corrida.
      expect(row.availableAt.toISOString()).toBe(PIN_A.committedAt);
      expect(row.taxonomyVersion).toBe(PIN_A.commit);
      expect(row.taxonomyId).toBe(SP500_SECTOR_TAXONOMY_ID);
    }
  });

  it("is idempotent: the same pin twice writes nothing the second time", async () => {
    await classifyUniverseSectors(command(), dependencies());
    const second = await classifyUniverseSectors(command(), dependencies());

    expect(second.summary).toBeNull();
    expect(second.plan.counts.unchanged).toBe(2);

    const rows = await database.select().from(schema.classificationAssignments);

    expect(rows).toHaveLength(2);
  });

  it("supersedes in one transaction instead of closing in an undated past", async () => {
    await classifyUniverseSectors(command(), dependencies());

    const moved = await classifyUniverseSectors(
      command({
        pin: PIN_B,
        claims: [
          { symbol: "GOOGL", sector: "Communication Services" },
          { symbol: "GOOG", sector: "Communication Services" },
          { symbol: "XOM", sector: "Utilities" },
        ],
      }),
      dependencies(),
    );

    expect(moved.summary?.applied).toEqual({ opened: 1, superseded: 1 });

    const rows = await database.select().from(schema.classificationAssignments);
    const exxon = rows.filter((row) => row.subjectId === EXXON);

    expect(exxon).toHaveLength(2);

    const old = exxon.find((row) => row.supersededAt !== null)!;
    const current = exxon.find((row) => row.supersededAt === null)!;

    expect(old.code).toBe("energy");
    // Superseded, no cerrada: la fuente nunca publicó desde cuándo cambió.
    expect(old.validTo).toBeNull();
    expect(old.supersededAt!.toISOString()).toBe(PIN_B.committedAt);
    expect(current.code).toBe("utilities");
    expect(current.taxonomyVersion).toBe(PIN_B.commit);
  });

  it("refuses two open assertions for the same subject and taxonomy", async () => {
    await classifyUniverseSectors(command(), dependencies());

    const duplicate = subjectClassificationSchema.parse({
      classificationAssignmentId: randomUUID(),
      subjectType: "legal_entity",
      subjectId: EXXON,
      taxonomyId: SP500_SECTOR_TAXONOMY_ID,
      taxonomyVersion: PIN_B.commit,
      code: "utilities",
      label: "Utilities",
      validFrom: PIN_B.committedAt,
      validTo: null,
      availableAt: PIN_B.committedAt,
      supersededAt: null,
      sourceId: "datahub-sp500-pddl",
      sourceDocumentId: null,
      contentHash: "c".repeat(64),
      recordedAt: PIN_B.committedAt,
    });

    try {
      await database.insert(schema.classificationAssignments).values({
        ...duplicate,
        validFrom: new Date(duplicate.validFrom),
        validTo: null,
        availableAt: new Date(duplicate.availableAt),
        supersededAt: null,
        recordedAt: new Date(duplicate.recordedAt),
      });
    } catch (error) {
      const cause = ((error as { cause?: unknown }).cause ??
        error) as PostgresErrorShape;

      expect(cause.constraint_name).toBe(
        "classification_assignments_open_uidx",
      );
      return;
    }

    throw new Error(
      "Expected classification_assignments_open_uidx to reject the second open assertion.",
    );
  });

  it("keeps assertions of another taxonomy for the same subject", async () => {
    // La tabla es compartida: el arquetipo de `F3-01` y la industria de `F3-05`
    // conviven con el sector. El índice único es por taxonomía, no por sujeto.
    await classifyUniverseSectors(command(), dependencies());

    await database.insert(schema.classificationAssignments).values({
      classificationAssignmentId: randomUUID(),
      subjectType: "legal_entity",
      subjectId: EXXON,
      taxonomyId: "valuation-archetype",
      taxonomyVersion: "archetype-1.0.0",
      code: "commodity",
      label: "Commodity",
      validFrom: new Date(PIN_A.committedAt),
      validTo: null,
      availableAt: new Date(PIN_A.committedAt),
      supersededAt: null,
      sourceId: "datahub-sp500-pddl",
      sourceDocumentId: null,
      contentHash: "d".repeat(64),
      recordedAt: new Date(PIN_A.committedAt),
    });

    const rows = await database.select().from(schema.classificationAssignments);

    expect(rows.filter((row) => row.subjectId === EXXON)).toHaveLength(2);

    // La lectura del sector no ve la otra taxonomía.
    const sectorRows = await createPostgresClassificationRepository(
      database,
    ).loadClassifications({ taxonomyId: SP500_SECTOR_TAXONOMY_ID });

    expect(sectorRows).toHaveLength(2);
  });

  it("refuses a read that exceeds its ceiling instead of truncating", async () => {
    // Una población truncada en silencio es una matriz con empresas de menos y
    // nadie se entera (`TM-07`).
    await classifyUniverseSectors(command(), dependencies());

    await expect(
      createPostgresClassificationRepository(database).loadClassifications({
        taxonomyId: SP500_SECTOR_TAXONOMY_ID,
        limit: 1,
      }),
    ).rejects.toThrow(/exceeded its limit/u);
  });
});
