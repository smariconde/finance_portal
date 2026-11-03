import { createHash, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ingestAdrLeg } from "@/modules/implied-fx/application/ingest-adr-pair-legs";
import { readImpliedCcl } from "@/modules/implied-fx/application/read-implied-ccl";
import type { PriceSourceProvider } from "@/modules/prices/application/live-price-source";
import { parseChartPayload } from "@/modules/prices/domain/parse-chart-payload";
import { FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS } from "@/modules/prices/infrastructure/fixture-chart-payload";
import { createPostgresAdrPairRepository } from "@/server/db/postgres-adr-pair-repository";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

let sql: Sql;
let database: PostgresJsDatabase<typeof schema>;

async function clean() {
  await database.delete(schema.adrPairCloses);
  await database
    .delete(schema.ingestionRuns)
    .where(eq(schema.ingestionRuns.datasetId, "yahoo.adr-pair-close"));
}

beforeAll(() => {
  sql = postgres(databaseTestUrl, { max: 4 });
  database = drizzle(sql, { schema });
});

afterAll(async () => {
  await clean();
  await sql.end({ timeout: 5 });
});

beforeEach(clean);

const template = parseChartPayload(FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS);

if (!template.ok) {
  throw new Error("the fixture must parse");
}

/** Sintético: un cierre por pata el 2026-10-30, sin sesión abierta. */
function sourceOf(
  closes: Record<string, { currency: string; close: string }>,
): PriceSourceProvider {
  return {
    sourceId: "yahoo-finance",
    async load(symbol) {
      const entry = closes[symbol]!;

      return {
        sourceId: "yahoo-finance",
        symbol,
        parsed: {
          ...(template as Extract<typeof template, { ok: true }>),
          symbol,
          currency: entry.currency,
          bars: [{ marketDate: "2026-10-30", close: entry.close }],
          splits: [],
          dividends: [],
          session: null,
        },
        byteLength: 128,
        fetchedAt: "2026-11-02T18:00:00.000Z",
        historyYears: 5,
        requestedFrom: "2000-01-01",
      };
    },
  };
}

describe("PostgreSQL ADR pair repository", () => {
  it("stores raw leg closes once, reports a conflicting re-download and reads them at the run's cutoff", async () => {
    const repository = createPostgresAdrPairRepository(database);
    let tick = Date.parse("2026-11-02T19:00:00.000Z");
    const now = () => {
      tick += 1000;
      return new Date(tick).toISOString();
    };
    const dependencies = (closes: Parameters<typeof sourceOf>[0]) => ({
      source: sourceOf(closes),
      repository,
      ingestionRuns: createPostgresIngestionRunRepository(database),
      now,
      newId: () => randomUUID(),
      hashContent: (input: string) =>
        createHash("sha256").update(input).digest("hex"),
    });
    const closes = {
      GGAL: { currency: "USD", close: "50" },
      "GGAL.BA": { currency: "ARS", close: "7500" },
      BMA: { currency: "USD", close: "100" },
      "BMA.BA": { currency: "ARS", close: "15000" },
      TEO: { currency: "USD", close: "10" },
      "TECO2.BA": { currency: "ARS", close: "3200" },
    };
    const before = now();

    for (const pairId of ["ggal", "bma", "teo"]) {
      for (const side of ["adr", "local"] as const) {
        await ingestAdrLeg(pairId, side, dependencies(closes));
      }
    }

    const after = now();
    const reread = await ingestAdrLeg(
      "ggal",
      "adr",
      dependencies({ ...closes, GGAL: { currency: "USD", close: "51" } }),
    );

    expect(reread.summary).toMatchObject({
      closesInserted: 0,
      closesConflicting: ["2026-10-30"],
    });

    const query = (at: string) => ({
      effectiveAt: at,
      knownAt: at,
      revisionPolicy: "as_known" as const,
      knowledgeBasis: "public_availability" as const,
      adjustmentPolicy: "as_known" as const,
      sourcePolicyVersion: "source-policy-1.0.0",
    });

    expect(await readImpliedCcl(query(before), repository)).toEqual([]);
    expect(await readImpliedCcl(query(after), repository)).toMatchObject([
      {
        marketDate: "2026-10-30",
        value: "1500",
        pairs: ["bma", "ggal", "teo"],
      },
    ]);
  });
});
