import type { AdrPairRepository } from "@/modules/implied-fx/application/adr-pair-repository";
import { readImpliedCcl } from "@/modules/implied-fx/application/read-implied-ccl";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import { bcraFxSeriesKey } from "../domain/bcra-fx-source";
import {
  bcraSeriesKey,
  type BcraVariableId,
} from "../domain/bcra-monetary-source";
import {
  basisOf,
  type SeriesBasis,
  type SeriesDefinition,
} from "../domain/series-definition";
import {
  IMPLIED_CCL_BASIS,
  TRANSFORMATION_REFERENCES,
  transformSeries,
  type ReferencePoint,
  type TransformationKind,
  type TransformationResult,
} from "../domain/series-transformation";

import type { MacroSeriesRepository } from "./macro-series-repository";
import { readMacroSeries } from "./read-macro-series";

/** El dólar estadounidense en ISO 4217 numérico. */
const SPLICE_BEFORE_ISO_NUMERIC = 840;

export type TransformedMacroSeriesReading =
  | {
      readonly status: "read";
      readonly definition: SeriesDefinition;
      /** `null` para `usd_ccl`: su referencia es una lectura, no una serie del BCRA. */
      readonly referenceDefinition: SeriesDefinition | null;
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
 * después del `knownAt` nunca deflacta un punto que se conocía antes. El CCL
 * implícito (`usd_ccl`, ADR 0068) también se lee a ese corte.
 */
export async function readTransformedMacroSeries(
  input: {
    readonly variableId: BcraVariableId;
    readonly kind: TransformationKind;
    readonly baseOn?: string;
  },
  query: PointInTimeQuery,
  repository: MacroSeriesRepository,
  adrPairs?: AdrPairRepository,
): Promise<TransformedMacroSeriesReading> {
  const seriesKey = bcraSeriesKey(input.variableId);
  const nominal = await readMacroSeries(seriesKey, query, repository);

  if (nominal.status !== "read") {
    return { status: "no_definition_at_cutoff", seriesKey };
  }

  let reference: {
    definition: SeriesDefinition | null;
    basis: SeriesBasis;
    points: readonly ReferencePoint[];
  };

  if (input.kind === "usd_ccl") {
    if (adrPairs === undefined) {
      throw new Error("usd_ccl needs the ADR pair repository");
    }

    reference = {
      definition: null,
      basis: IMPLIED_CCL_BASIS,
      points: (await readImpliedCcl(query, adrPairs)).flatMap((point) =>
        point.value === null
          ? []
          : [{ periodOn: point.marketDate, value: point.value }],
      ),
    };
  } else {
    const referenceKey = bcraSeriesKey(TRANSFORMATION_REFERENCES[input.kind]);
    const read = await readMacroSeries(referenceKey, query, repository);

    if (read.status !== "read") {
      return { status: "no_definition_at_cutoff", seriesKey: referenceKey };
    }

    reference = {
      definition: read.definition,
      basis: basisOf(read.definition),
      points: read.points,
    };
  }

  let beforeSplice:
    { basis: SeriesBasis; points: readonly ReferencePoint[] } | undefined;

  if (input.kind === "usd_spliced") {
    // El dólar de Estadísticas Cambiarias, leído con el mismo corte (ADR 0067).
    const beforeKey = bcraFxSeriesKey(SPLICE_BEFORE_ISO_NUMERIC);
    const before = await readMacroSeries(beforeKey, query, repository);

    if (before.status !== "read") {
      return { status: "no_definition_at_cutoff", seriesKey: beforeKey };
    }

    beforeSplice = { basis: basisOf(before.definition), points: before.points };
  }

  return {
    status: "read",
    definition: nominal.definition,
    referenceDefinition: reference.definition,
    transformation: transformSeries({
      kind: input.kind,
      basis: basisOf(nominal.definition),
      referenceBasis: reference.basis,
      nominal: nominal.points,
      reference: reference.points,
      ...(input.baseOn === undefined ? {} : { baseOn: input.baseOn }),
      ...(beforeSplice === undefined ? {} : { beforeSplice }),
    }),
  };
}
