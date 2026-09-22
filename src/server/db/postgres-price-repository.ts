import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  priceSeriesQuerySchema,
  type PriceRepository,
  type PriceWriteSummary,
} from "@/modules/prices/application/price-repository";
import {
  dailyCloseSchema,
  type DailyClose,
  type PriceEvent,
} from "@/modules/prices/domain/daily-close";

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
        .where(eq(schema.securityPrices.securityId, parsed.securityId))
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

        let eventsInserted = 0;

        for (const batch of chunk([...events], INSERT_CHUNK)) {
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
          eventsDuplicate: events.length - eventsInserted,
        };
      });
    },
  };
}
