import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

import type { DailyClose, PriceEvent } from "../domain/daily-close";
import {
  benchmarkIdSchema,
  type BenchmarkClose,
} from "../domain/declared-benchmarks";

/**
 * Lectura acotada de una serie. El techo no es comodidad: una serie truncada en
 * silencio es un Sortino calculado sobre menos ruedas de las que dice, y nadie
 * se entera (`TM-07`). Cinco años son ~1.260 ruedas.
 */
export const priceSeriesQuerySchema = z.object({
  securityId: z.uuid(),
  /** Ruedas desde esta fecha inclusive; `null` desde el principio. */
  from: calendarDateSchema.nullable().default(null),
  /** Ruedas hasta esta fecha inclusive; `null` hasta la última. */
  to: calendarDateSchema.nullable().default(null),
  limit: z.number().int().min(1).max(10_000).default(2_000),
});

export type PriceSeriesQuery = z.input<typeof priceSeriesQuerySchema>;

/** Los eventos de una security son decenas; el techo sólo evita un barrido. */
export const priceEventsQuerySchema = z.object({
  securityId: z.uuid(),
  limit: z.number().int().min(1).max(1_000).default(500),
});

export type PriceEventsQuery = z.input<typeof priceEventsQuerySchema>;

export const benchmarkSeriesQuerySchema = z.object({
  benchmarkId: benchmarkIdSchema,
  from: calendarDateSchema.nullable().default(null),
  to: calendarDateSchema.nullable().default(null),
  limit: z.number().int().min(1).max(10_000).default(2_000),
});

export type BenchmarkSeriesQuery = z.input<typeof benchmarkSeriesQuerySchema>;

export type BenchmarkWriteSummary = {
  readonly benchmarkId: string;
  readonly closesInserted: number;
  readonly closesDuplicate: number;
  /** Ruedas que ya estaban con otro nivel: no se pisan. */
  readonly closesConflicting: readonly string[];
};

export type PriceWriteSummary = {
  readonly securityId: string;
  /** Ruedas nuevas: una re-descarga idempotente deja esto en cero. */
  readonly closesInserted: number;
  /** Ruedas que ya estaban con el mismo cierre. */
  readonly closesDuplicate: number;
  /**
   * Ruedas que ya estaban **con otro cierre**. No se pisan: una fila cruda es
   * inmutable, así que un cambio acá significa que la fuente cambió de opinión
   * sobre el pasado y eso es un hallazgo, no una actualización.
   */
  readonly closesConflicting: readonly string[];
  readonly eventsInserted: number;
  readonly eventsDuplicate: number;
  /**
   * Eventos que ya estaban **con otro valor**, como `tipo:fecha`. Tampoco se
   * pisan. Hasta `F7-04` se contaban como duplicados en silencio, y así fue como
   * diez dividendos guardados en la base de la fuente pasaron por buenos.
   */
  readonly eventsConflicting: readonly string[];
};

export interface PriceRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  loadSeries(query: PriceSeriesQuery): Promise<readonly DailyClose[]>;
  /** Splits y dividendos de una security, ordenados por fecha. */
  loadEvents(query: PriceEventsQuery): Promise<readonly PriceEvent[]>;
  loadBenchmarkSeries(
    query: BenchmarkSeriesQuery,
  ): Promise<readonly BenchmarkClose[]>;
  /** Misma regla que `writeSeries`: lo que ya está distinto se reporta. */
  writeBenchmarkSeries(
    closes: readonly BenchmarkClose[],
    ingestionRunId: string,
  ): Promise<BenchmarkWriteSummary>;
  /**
   * Escribe cierres y eventos de una security en una transacción. Una fila que
   * ya existe con el mismo valor se reconoce como duplicada; una que existe con
   * otro valor se reporta y **no** se pisa.
   */
  writeSeries(
    closes: readonly DailyClose[],
    events: readonly PriceEvent[],
    ingestionRunId: string,
  ): Promise<PriceWriteSummary>;
}

type RepositoryFactories = {
  personal: () => PriceRepository;
};

export function selectPriceRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): PriceRepository {
  return selectPersonalDependency(mode, "price-repository", factories.personal);
}
