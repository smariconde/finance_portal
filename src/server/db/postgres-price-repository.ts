import "server-only";

import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  benchmarkSeriesQuerySchema,
  priceEventsQuerySchema,
  priceSeriesQuerySchema,
  recentCoverageQuerySchema,
  type PriceRepository,
  type PriceWriteSummary,
} from "@/modules/prices/application/price-repository";
import {
  dailyCloseSchema,
  priceEventSchema,
  type DailyClose,
  type PriceEvent,
} from "@/modules/prices/domain/daily-close";
import {
  benchmarkCloseSchema,
  type BenchmarkClose,
} from "@/modules/prices/domain/declared-benchmarks";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

/** Lotes para no armar un `INSERT` de 1.260 filas en una sola sentencia. */
const INSERT_CHUNK = 500;

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

/**
 * Repositorio personal de series de precios (ADR 0026).
 *
 * Escribe con `onConflictDoNothing`, que es la forma de que la ingesta sea
 * idempotente: una re-descarga de la misma serie no publica nada. Y como una
 * fila cruda es **inmutable**, lo que ya está no se pisa: una rueda que existe
 * con otro cierre se devuelve como conflicto para que alguien la mire, porque
 * significa que la fuente cambió de opinión sobre el pasado.
 */
export function createPostgresPriceRepository(
  database: Database,
): PriceRepository {
  return {
    storage: "personal-postgres",
    async loadSeries(query) {
      const parsed = priceSeriesQuerySchema.parse(query);

      const rows = await database
        .select()
        .from(schema.securityPrices)
        .where(
          and(
            eq(schema.securityPrices.securityId, parsed.securityId),
            parsed.from === null
              ? undefined
              : gte(schema.securityPrices.marketDate, parsed.from),
            parsed.to === null
              ? undefined
              : lte(schema.securityPrices.marketDate, parsed.to),
          ),
        )
        .orderBy(asc(schema.securityPrices.marketDate))
        .limit(parsed.limit + 1);

      if (rows.length > parsed.limit) {
        throw new Error(
          `price series read exceeded its limit of ${parsed.limit} rows for ${parsed.securityId}`,
        );
      }

      return rows.map((row) =>
        dailyCloseSchema.parse({
          securityId: row.securityId,
          marketDate: row.marketDate,
          close: row.close,
          currency: row.currency,
        }),
      );
    },
    async loadEvents(query) {
      const parsed = priceEventsQuerySchema.parse(query);
      const rows = await database
        .select()
        .from(schema.priceEvents)
        .where(eq(schema.priceEvents.securityId, parsed.securityId))
        .orderBy(asc(schema.priceEvents.effectiveOn))
        .limit(parsed.limit + 1);

      if (rows.length > parsed.limit) {
        throw new Error(
          `price events read exceeded its limit of ${parsed.limit} rows for ${parsed.securityId}`,
        );
      }

      return rows.map((row) =>
        priceEventSchema.parse({
          securityId: row.securityId,
          eventType: row.eventType,
          effectiveOn: row.effectiveOn,
          value: row.value,
          currency: row.currency,
        }),
      );
    },
    async listSecuritiesWithClosesSince(query) {
      const parsed = recentCoverageQuerySchema.parse(query);
      const rows = await database
        .selectDistinct({ securityId: schema.securityPrices.securityId })
        .from(schema.securityPrices)
        .where(gte(schema.securityPrices.marketDate, parsed.from))
        .limit(parsed.limit + 1);

      if (rows.length > parsed.limit) {
        throw new Error(
          `coverage read exceeded its limit of ${parsed.limit} securities`,
        );
      }

      return rows.map((row) => row.securityId).sort();
    },
    async loadBenchmarkSeries(query) {
      const parsed = benchmarkSeriesQuerySchema.parse(query);
      const rows = await database
        .select()
        .from(schema.benchmarkPrices)
        .where(
          and(
            eq(schema.benchmarkPrices.benchmarkId, parsed.benchmarkId),
            parsed.from === null
              ? undefined
              : gte(schema.benchmarkPrices.marketDate, parsed.from),
            parsed.to === null
              ? undefined
              : lte(schema.benchmarkPrices.marketDate, parsed.to),
          ),
        )
        .orderBy(asc(schema.benchmarkPrices.marketDate))
        .limit(parsed.limit + 1);

      if (rows.length > parsed.limit) {
        throw new Error(
          `benchmark series read exceeded its limit of ${parsed.limit} rows for ${parsed.benchmarkId}`,
        );
      }

      return rows.map((row) =>
        benchmarkCloseSchema.parse({
          benchmarkId: row.benchmarkId,
          marketDate: row.marketDate,
          close: row.close,
          currency: row.currency,
        }),
      );
    },
    async writeBenchmarkSeries(closes, ingestionRunId) {
      const benchmarkId = closes[0]?.benchmarkId ?? "";

      return database.transaction(async (tx) => {
        const stored = new Map(
          (
            await tx
              .select({
                marketDate: schema.benchmarkPrices.marketDate,
                close: schema.benchmarkPrices.close,
              })
              .from(schema.benchmarkPrices)
              .where(eq(schema.benchmarkPrices.benchmarkId, benchmarkId))
          ).map((row) => [row.marketDate, row.close]),
        );

        const fresh: BenchmarkClose[] = [];
        const closesConflicting: string[] = [];
        let closesDuplicate = 0;

        for (const close of closes) {
          const existing = stored.get(close.marketDate);

          if (existing === undefined) {
            fresh.push(close);
          } else if (Number(existing) === Number(close.close)) {
            closesDuplicate += 1;
          } else {
            closesConflicting.push(close.marketDate);
          }
        }

        for (const batch of chunk(fresh, INSERT_CHUNK)) {
          await tx
            .insert(schema.benchmarkPrices)
            .values(
              batch.map((close) => ({
                benchmarkId: close.benchmarkId,
                marketDate: close.marketDate,
                close: close.close,
                currency: close.currency,
                ingestionRunId,
              })),
            )
            .onConflictDoNothing();
        }

        return {
          benchmarkId,
          closesInserted: fresh.length,
          closesDuplicate,
          closesConflicting,
        };
      });
    },
    async writeSeries(
      closes: readonly DailyClose[],
      events: readonly PriceEvent[],
      ingestionRunId: string,
    ): Promise<PriceWriteSummary> {
      const securityId = closes[0]?.securityId ?? events[0]?.securityId ?? "";

      return database.transaction(async (tx) => {
        // Lo que ya está guardado para esas ruedas, antes de insertar: es lo que
        // permite distinguir "ya estaba igual" de "ya estaba distinto" sin
        // pisar nada.
        const existing =
          closes.length === 0
            ? []
            : (
                await Promise.all(
                  chunk(closes, INSERT_CHUNK).map((batch) =>
                    tx
                      .select({
                        marketDate: schema.securityPrices.marketDate,
                        close: schema.securityPrices.close,
                      })
                      .from(schema.securityPrices)
                      .where(
                        and(
                          eq(schema.securityPrices.securityId, securityId),
                          inArray(
                            schema.securityPrices.marketDate,
                            batch.map((close) => close.marketDate),
                          ),
                        ),
                      ),
                  ),
                )
              ).flat();

        const storedByDate = new Map(
          existing.map((row) => [row.marketDate, row.close]),
        );

        const fresh: DailyClose[] = [];
        const closesConflicting: string[] = [];
        let closesDuplicate = 0;

        for (const close of closes) {
          const stored = storedByDate.get(close.marketDate);

          if (stored === undefined) {
            fresh.push(close);
            continue;
          }

          // `numeric` vuelve como string pero puede diferir en ceros a la
          // derecha, así que se comparan como números y no como texto.
          if (Number(stored) === Number(close.close)) {
            closesDuplicate += 1;
            continue;
          }

          closesConflicting.push(close.marketDate);
        }

        for (const batch of chunk(fresh, INSERT_CHUNK)) {
          await tx
            .insert(schema.securityPrices)
            .values(
              batch.map((close) => ({
                securityId: close.securityId,
                marketDate: close.marketDate,
                close: close.close,
                currency: close.currency,
                ingestionRunId,
              })),
            )
            .onConflictDoNothing();
        }

        // Los eventos de una security son decenas, no miles: se leen todos. Un
        // evento que ya está con otro valor se reporta y no se pisa, igual que
        // un cierre.
        const storedEvents =
          events.length === 0
            ? []
            : await tx
                .select({
                  eventType: schema.priceEvents.eventType,
                  effectiveOn: schema.priceEvents.effectiveOn,
                  value: schema.priceEvents.value,
                })
                .from(schema.priceEvents)
                .where(eq(schema.priceEvents.securityId, securityId));

        const storedEventValue = new Map(
          storedEvents.map((row) => [
            `${row.eventType}:${row.effectiveOn}`,
            row.value,
          ]),
        );

        const freshEvents: PriceEvent[] = [];
        const eventsConflicting: string[] = [];
        let eventsDuplicate = 0;

        for (const event of events) {
          const key = `${event.eventType}:${event.effectiveOn}`;
          const stored = storedEventValue.get(key);

          if (stored === undefined) {
            freshEvents.push(event);
            continue;
          }

          if (Number(stored) === Number(event.value)) {
            eventsDuplicate += 1;
            continue;
          }

          eventsConflicting.push(key);
        }

        let eventsInserted = 0;

        for (const batch of chunk(freshEvents, INSERT_CHUNK)) {
          const inserted = await tx
            .insert(schema.priceEvents)
            .values(
              batch.map((event) => ({
                securityId: event.securityId,
                eventType: event.eventType,
                effectiveOn: event.effectiveOn,
                value: event.value,
                currency: event.currency,
                ingestionRunId,
              })),
            )
            .onConflictDoNothing()
            .returning({ securityId: schema.priceEvents.securityId });

          eventsInserted += inserted.length;
        }

        return {
          securityId,
          closesInserted: fresh.length,
          closesDuplicate,
          closesConflicting,
          eventsInserted,
          eventsDuplicate,
          eventsConflicting,
        };
      });
    },
  };
}
