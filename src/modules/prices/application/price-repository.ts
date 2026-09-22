import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type { DailyClose, PriceEvent } from "../domain/daily-close";

/**
 * Lectura acotada de una serie. El techo no es comodidad: una serie truncada en
 * silencio es un Sortino calculado sobre menos ruedas de las que dice, y nadie
 * se entera (`TM-07`). Cinco años son ~1.260 ruedas.
 */
export const priceSeriesQuerySchema = z.object({
  securityId: z.uuid(),
  limit: z.number().int().min(1).max(10_000).default(2_000),
});

export type PriceSeriesQuery = z.input<typeof priceSeriesQuerySchema>;

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
};

export interface PriceRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  loadSeries(query: PriceSeriesQuery): Promise<readonly DailyClose[]>;
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
