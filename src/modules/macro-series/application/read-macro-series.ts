import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import {
  resolveDefinitionAt,
  type SeriesDefinition,
} from "../domain/series-definition";
import {
  resolveSeriesAt,
  type SeriesReading,
} from "../domain/series-observation";

import type { MacroSeriesRepository } from "./macro-series-repository";

export type MacroSeriesReading =
  | ({
      readonly status: "read";
      /** La definición visible al corte: con ella se lee la unidad de cada punto. */
      readonly definition: SeriesDefinition;
    } & SeriesReading)
  | {
      /**
       * Ninguna definición era visible al corte: antes de la primera captura, o
       * la variable ya se había retirado. Se nombra en vez de usar la de hoy
       * (`TM-06`).
       */
      readonly status: "no_definition_at_cutoff";
    };

/**
 * Una serie macro como se la conocía al corte (`F9-01`, ADR 0065). La base de
 * la serie es una sola —el registro rechaza descargarla con otra—, así que la
 * definición visible describe todos los puntos.
 */
export async function readMacroSeries(
  seriesKey: string,
  query: PointInTimeQuery,
  repository: MacroSeriesRepository,
): Promise<MacroSeriesReading> {
  const definition = resolveDefinitionAt(
    await repository.listSeriesDefinitions(seriesKey),
    query,
  );

  if (definition === null) {
    return { status: "no_definition_at_cutoff" };
  }

  return {
    status: "read",
    definition,
    ...resolveSeriesAt(await repository.listObservations(seriesKey), query),
  };
}
