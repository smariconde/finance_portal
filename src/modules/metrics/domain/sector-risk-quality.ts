import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";
import { calendarDaysBetween } from "@/modules/temporal/domain/calendar-date";

import type { SectorRiskMatrix } from "./sector-risk-matrix";

/** Calidad operativa de la matriz, no verificación independiente de la fuente. */
export const SECTOR_RISK_QUALITY_VERSION = "sector-risk-quality-1.0.0";

export class SectorRiskReconciliationError extends Error {
  constructor() {
    super(
      "The sector risk matrix did not reconcile with its population or derived values.",
    );
    this.name = "SectorRiskReconciliationError";
  }
}

export type SectorRiskQuality = {
  readonly ruleVersion: typeof SECTOR_RISK_QUALITY_VERSION;
  readonly status: "ready" | "degraded";
  /** Null si no hay población: no se fabrica una nota sobre un sector vacío. */
  readonly score: number | null;
  readonly population: number;
  readonly computed2y: number;
  readonly computed5y: number;
  readonly comparable: number;
  readonly seriesWithoutRows: number;
  readonly daysSinceClose: number;
  readonly components: {
    /** Celdas Sortino calculadas / (2 × población). */
    readonly completeness: number | null;
    /** 100 hasta 4 días, 50 entre 5 y 7, 0 después. Sin calendario de feriados. */
    readonly freshness: number;
    /** Securities con ambas ventanas / población; exige referencia calculada. */
    readonly comparability: number | null;
    /** Reconciliación interna de identidad y valores derivados. */
    readonly validation: 100;
    /** Una única fuente de precios no permite medir acuerdo entre proveedores. */
    readonly agreement: null;
  };
};

const decimal = createDecimalOperations(
  () => new SectorRiskReconciliationError(),
);

function sameDifference(
  actual: string | null,
  pointValue: string | null,
  referenceValue: string | null,
): boolean {
  if (pointValue === null || referenceValue === null) {
    return actual === null;
  }

  return (
    actual !== null &&
    decimal
      .parseDecimal(actual, "distance")
      .eq(
        decimal
          .parseDecimal(pointValue, "point")
          .minus(decimal.parseDecimal(referenceValue, "reference")),
      )
  );
}

function value(
  result: SectorRiskMatrix["reference"]["sortino2y"],
): string | null {
  return result.status === "computed" ? result.value : null;
}

/**
 * Reconciliación independiente del armado de la matriz: IDs, ventanas, ajuste,
 * cuadrantes y distancias. Un desacuerdo falla cerrado antes de mostrar la nota.
 */
export function assessSectorRiskQuality(input: {
  readonly matrix: SectorRiskMatrix;
  readonly populationSecurityIds: readonly string[];
  readonly requestedAsOf: string;
  readonly seriesWithoutRows: number;
}): SectorRiskQuality {
  const { matrix, populationSecurityIds, requestedAsOf, seriesWithoutRows } =
    input;
  const population = populationSecurityIds.length;
  const expected = new Set(populationSecurityIds);
  const ids = matrix.points.map((point) => point.securityId);
  const reference2y = value(matrix.reference.sortino2y);
  const reference5y = value(matrix.reference.sortino5y);
  const comparable = matrix.points.filter(
    (point) =>
      point.sortino2y.status === "computed" &&
      point.sortino5y.status === "computed",
  ).length;

  if (
    expected.size !== population ||
    ids.length !== population ||
    new Set(ids).size !== population ||
    ids.some((id) => !expected.has(id)) ||
    matrix.fit.n !== comparable ||
    seriesWithoutRows < 0 ||
    seriesWithoutRows > population ||
    requestedAsOf < matrix.asOf ||
    matrix.reference.sortino2y.asOf !== matrix.asOf ||
    matrix.reference.sortino5y.asOf !== matrix.asOf
  ) {
    throw new SectorRiskReconciliationError();
  }

  for (const point of matrix.points) {
    const point2y = value(point.sortino2y);
    const point5y = value(point.sortino5y);
    const hasQuadrant =
      point2y !== null &&
      point5y !== null &&
      reference2y !== null &&
      reference5y !== null;

    if (
      point.sortino2y.asOf !== matrix.asOf ||
      point.sortino5y.asOf !== matrix.asOf ||
      (point.quadrant !== null) !== hasQuadrant ||
      !sameDifference(
        point.distanceToReference.window2y,
        point2y,
        reference2y,
      ) ||
      !sameDifference(point.distanceToReference.window5y, point5y, reference5y)
    ) {
      throw new SectorRiskReconciliationError();
    }

    if (hasQuadrant) {
      const beats2y = decimal
        .parseDecimal(point2y!, "point2y")
        .gt(decimal.parseDecimal(reference2y!, "reference2y"));
      const beats5y = decimal
        .parseDecimal(point5y!, "point5y")
        .gt(decimal.parseDecimal(reference5y!, "reference5y"));
      const quadrant = beats2y
        ? beats5y
          ? "beats_both"
          : "beats_2y_only"
        : beats5y
          ? "beats_5y_only"
          : "beats_neither";

      if (point.quadrant !== quadrant) {
        throw new SectorRiskReconciliationError();
      }
    }
  }

  const computed2y = matrix.points.filter(
    (point) => point.sortino2y.status === "computed",
  ).length;
  const computed5y = matrix.points.filter(
    (point) => point.sortino5y.status === "computed",
  ).length;
  const daysSinceClose = calendarDaysBetween(matrix.asOf, requestedAsOf);
  const completeness =
    population === 0
      ? null
      : Math.round(((computed2y + computed5y) / (population * 2)) * 100);
  const freshness = daysSinceClose <= 4 ? 100 : daysSinceClose <= 7 ? 50 : 0;
  const comparability =
    population === 0
      ? null
      : reference2y === null || reference5y === null
        ? 0
        : Math.round((comparable / population) * 100);
  const score =
    completeness === null || comparability === null
      ? null
      : Math.round(
          completeness * 0.4 + freshness * 0.2 + comparability * 0.2 + 20,
        );
  const status =
    score === 100 && seriesWithoutRows === 0 ? "ready" : "degraded";

  return {
    ruleVersion: SECTOR_RISK_QUALITY_VERSION,
    status,
    score,
    population,
    computed2y,
    computed5y,
    comparable,
    seriesWithoutRows,
    daysSinceClose,
    components: {
      completeness,
      freshness,
      comparability,
      validation: 100,
      agreement: null,
    },
  };
}
