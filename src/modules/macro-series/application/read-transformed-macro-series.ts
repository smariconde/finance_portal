import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import {
  bcraSeriesKey,
  type BcraVariableId,
} from "../domain/bcra-monetary-source";
import { basisOf, type SeriesDefinition } from "../domain/series-definition";
import {
  TRANSFORMATION_REFERENCES,
  transformSeries,
  type TransformationKind,
  type TransformationResult,
} from "../domain/series-transformation";

import type { MacroSeriesRepository } from "./macro-series-repository";
import { readMacroSeries } from "./read-macro-series";

export type TransformedMacroSeriesReading =
  | {
      readonly status: "read";
      readonly definition: SeriesDefinition;
      readonly referenceDefinition: SeriesDefinition;
      readonly transformation: TransformationResult;
    }
  | {
      /** La serie o su referencia no tenían definición visible al corte. */
      readonly status: "no_definition_at_cutoff";
      readonly seriesKey: string;
    };

/**
 * Una serie del BCRA transformada (`F9-02`, ADR 0066). La serie y su
 * referencia se leen con **el mismo** corte, así que una inflación publicada
 * después del `knownAt` nunca deflacta un punto que se conocía antes.
 */
export async function readTransformedMacroSeries(
  input: {
    readonly variableId: BcraVariableId;
    readonly kind: TransformationKind;
    readonly baseOn?: string;
  },
  query: PointInTimeQuery,
  repository: MacroSeriesRepository,
): Promise<TransformedMacroSeriesReading> {
  const seriesKey = bcraSeriesKey(input.variableId);
  const referenceKey = bcraSeriesKey(TRANSFORMATION_REFERENCES[input.kind]);
  const nominal = await readMacroSeries(seriesKey, query, repository);

  if (nominal.status !== "read") {
    return { status: "no_definition_at_cutoff", seriesKey };
  }

  const reference = await readMacroSeries(referenceKey, query, repository);

  if (reference.status !== "read") {
    return { status: "no_definition_at_cutoff", seriesKey: referenceKey };
  }

  return {
    status: "read",
    definition: nominal.definition,
    referenceDefinition: reference.definition,
    transformation: transformSeries({
      kind: input.kind,
      basis: basisOf(nominal.definition),
      referenceBasis: basisOf(reference.definition),
      nominal: nominal.points,
      reference: reference.points,
      ...(input.baseOn === undefined ? {} : { baseOn: input.baseOn }),
    }),
  };
}
