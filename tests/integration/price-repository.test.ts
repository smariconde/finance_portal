import { randomUUID } from "node:crypto";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  dailyCloseSchema,
  priceEventSchema,
} from "@/modules/prices/domain/daily-close";
import { createPostgresPriceRepository } from "@/server/db/postgres-price-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

type PostgresErrorShape = { code?: string; constraint_name?: string };

let sql: Sql;
let database: PostgresJsDatabase<typeof schema>;
let securityId: string;
let runId: string;

function close(marketDate: string, value: string) {
  return dailyCloseSchema.parse({
    securityId,
    marketDate,
    close: value,
    currency: "USD",
  });
}

function split(effectiveOn: string, ratio: string) {
  return priceEventSchema.parse({
    securityId,
    eventType: "split",
    effectiveOn,
    value: ratio,
    currency: null,
  });
}

beforeAll(() => {
  sql = postgres(databaseTestUrl, { max: 2 });
  database = drizzle(sql, { schema });
});

afterAll(async () => {
  // Se limpia al salir: varios archivos vecinos vacían `securities`, y una fila
  // de precios dejada atrás bloquea ese borrado con su foreign key.
  await database.delete(schema.securityPrices);
  await database.delete(schema.priceEvents);
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  // Sólo se limpia lo propio: `securities` e `ingestion_runs` los referencian
  // otras tablas, y vaciarlos rompería a los demás tests del archivo vecino.
  // Cada caso trabaja sobre una security nueva, así que no hay arrastre.
  await database.delete(schema.securityPrices);
  await database.delete(schema.priceEvents);

  securityId = randomUUID();
  runId = randomUUID();

  await database.insert(schema.securities).values({ securityId });
  await database.insert(schema.ingestionRuns).values({
    runId,
    sourceId: "yahoo-finance",
    datasetId: "yahoo.daily-close",
    parserVersion: "yahoo-chart-1.0.0",
    // Única por corrida: el índice parcial de idempotencia no admite dos
    // corridas publicables con la misma clave.
    idempotencyKey: runId.replace(/-/gu, "").padEnd(64, "0"),
    status: "succeeded",
    startedAt: new Date("2026-09-22T12:00:00.000Z"),
    finishedAt: new Date("2026-09-22T12:00:01.000Z"),
    fetchedCount: 2,
    acceptedCount: 2,
    rejectedCount: 0,
    duplicateCount: 0,
    contentHash: runId.replace(/-/gu, "").padEnd(64, "0"),
    recordedAt: new Date("2026-09-22T12:00:01.000Z"),
  });
});

describe("security prices on PostgreSQL", () => {
  it("writes a raw series with its dated events", async () => {
    const repository = createPostgresPriceRepository(database);

    const summary = await repository.writeSeries(
      [close("2024-06-05", "1224.4"), close("2024-06-10", "121.79")],
      [split("2024-06-10", "10")],
      runId,
    );

    expect(summary.closesInserted).toBe(2);
    expect(summary.eventsInserted).toBe(1);

    const stored = await repository.loadSeries({ securityId });

    // Lo que se guardó es lo que se operó: el precio previo al 10:1 no está
    // dividido por diez.
    expect(stored.map((row) => [row.marketDate, row.close])).toEqual([
      ["2024-06-05", "1224.4"],
      ["2024-06-10", "121.79"],
    ]);
  });

  it("is idempotent: the same series twice publishes nothing the second time", async () => {
    const repository = createPostgresPriceRepository(database);
    const closes = [
      close("2024-06-05", "1224.4"),
      close("2024-06-10", "121.79"),
    ];
    const events = [split("2024-06-10", "10")];

    await repository.writeSeries(closes, events, runId);
    const second = await repository.writeSeries(closes, events, runId);

    expect(second.closesInserted).toBe(0);
    expect(second.closesDuplicate).toBe(2);
    expect(second.eventsInserted).toBe(0);
    expect(second.eventsDuplicate).toBe(1);
  });

  it("reports a changed past without overwriting it", async () => {
    // Una fila cruda es inmutable. Que la fuente devuelva otro cierre para una
    // rueda guardada es un hallazgo, no una actualización.
    const repository = createPostgresPriceRepository(database);

    await repository.writeSeries([close("2024-06-05", "1224.4")], [], runId);
    const revised = await repository.writeSeries(
      [close("2024-06-05", "999.99")],
      [],
      runId,
    );

    expect(revised.closesConflicting).toEqual(["2024-06-05"]);
    expect(revised.closesInserted).toBe(0);

    const stored = await repository.loadSeries({ securityId });

    expect(stored[0]!.close).toBe("1224.4");
  });

  it("treats trailing zeros as the same price, not a changed past", async () => {
    // `numeric` vuelve de PostgreSQL con la escala que guardó, así que comparar
    // como texto marcaría 121.79 y 121.790 como un pasado cambiado.
    const repository = createPostgresPriceRepository(database);

    await repository.writeSeries([close("2024-06-10", "121.79")], [], runId);
    const again = await repository.writeSeries(
      [close("2024-06-10", "121.790")],
      [],
      runId,
    );

    expect(again.closesConflicting).toEqual([]);
    expect(again.closesDuplicate).toBe(1);
  });

  it("refuses two closes for the same security and day", async () => {
    try {
      await database.insert(schema.securityPrices).values([
        {
          securityId,
          marketDate: "2024-06-05",
          close: "1",
          currency: "USD",
          ingestionRunId: runId,
        },
        {
          securityId,
          marketDate: "2024-06-05",
          close: "2",
          currency: "USD",
          ingestionRunId: runId,
        },
      ]);
    } catch (error) {
      const cause = ((error as { cause?: unknown }).cause ??
        error) as PostgresErrorShape;

      expect(cause.constraint_name).toBe("security_prices_pkey");
      return;
    }

    throw new Error(
      "Expected security_prices_pkey to reject the second close.",
    );
  });

  it("refuses a dividend without its currency and a split with one", async () => {
    // Un dividendo es un importe y necesita moneda; un split es un ratio y no
    // tiene ninguna. El check espeja el schema de dominio.
    for (const row of [
      {
        securityId,
        eventType: "dividend" as const,
        effectiveOn: "2024-06-05",
        value: "0.25",
        currency: null,
        ingestionRunId: runId,
      },
      {
        securityId,
        eventType: "split" as const,
        effectiveOn: "2024-06-10",
        value: "10",
        currency: "USD",
        ingestionRunId: runId,
      },
    ]) {
      await expect(
        database.insert(schema.priceEvents).values(row),
      ).rejects.toThrow();
    }
  });

  it("refuses a negative close", async () => {
    await expect(
      database.insert(schema.securityPrices).values({
        securityId,
        marketDate: "2024-06-05",
        close: "-1",
        currency: "USD",
        ingestionRunId: runId,
      }),
    ).rejects.toThrow();
  });

  it("refuses a read that exceeds its ceiling instead of truncating", async () => {
    // Una serie truncada en silencio es un Sortino sobre menos ruedas de las
    // que dice, y nadie se entera (`TM-07`).
    const repository = createPostgresPriceRepository(database);

    await repository.writeSeries(
      [close("2024-06-05", "1"), close("2024-06-06", "2")],
      [],
      runId,
    );

    await expect(
      repository.loadSeries({ securityId, limit: 1 }),
    ).rejects.toThrow(/exceeded its limit/u);
  });
});
