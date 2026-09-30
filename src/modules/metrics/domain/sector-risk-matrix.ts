import {
  createDecimalOperations,
  sum,
  type Dec,
  type DecimalErrorCode,
} from "@/modules/numeric/domain/decimal-policy";

import { MetricInputError } from "./metric-input-error";
import {
  SORTINO_FORMULA_VERSION,
  SORTINO_PARAMETERS,
  sortino,
  type SortinoResult,
} from "./sortino";
import type { ReturnClose, ReturnEvent } from "./total-return";

/**
 * Matriz de riesgo de un sector al `as_of`
 * ([ADR 0016](../../../../docs/architecture/adr/0016-analysis-scope-sector-matrices.md) §4,
 * [ADR 0029](../../../../docs/architecture/adr/0029-reference-series-sector-risk-matrix.md)).
 *
 * Pregunta: en este sector, ¿qué securities compensaron mejor su riesgo a la
 * baja a 2 y a 5 años, cuáles superaron a la referencia en las dos ventanas y a
 * cuáles se accede por CEDEAR?
 *
 * Pura: recibe las series ya leídas y devuelve los puntos, la referencia en la
 * misma base y ventanas, la recta de ajuste y el motivo de cada `null`. Un punto
 * es una **security**, no un emisor: GOOG y GOOGL son dos puntos.
 */
export const SECTOR_RISK_MATRIX_VERSION = "sector-risk-matrix-1.0.0";

/**
 * Mínimos cuadrados de Y (5 años) sobre X (2 años), sólo con los puntos del
 * sector que tienen los dos valores. Es un **ajuste lineal del sector**, nunca un
 * valor justo, y no incluye a la referencia: la recta describe al sector, y la
 * referencia es contra qué se lo compara. Como la ventana de 5 años contiene a la
 * de 2, parte de la pendiente es mecánica.
 */
export const SECTOR_FIT_VERSION = "sector-fit-ols-1.0.0";
export const MIN_FIT_POINTS = 3;

export type CedearMark =
  | {
      readonly status: "program";
      /** Ratio vigente `CEDEAR : subyacente`, o `null` si no hay uno conocido. */
      readonly ratio: {
        readonly depositaryUnits: string;
        readonly underlyingUnits: string;
      } | null;
      readonly programs: number;
      /** Un programa suspendido sigue siendo un programa, y se dice. */
      readonly programStatus: "active" | "suspended" | "terminated" | "unknown";
    }
  | {
      readonly status: "none_known";
      /**
       * `not_effective_at_cutoff` no es «sin CEDEAR»: el registro no tenía
       * captura a esa fecha, o el programa ya se había retirado.
       */
      readonly reason: "no_program_recorded" | "not_effective_at_cutoff";
    };

export type SectorMemberSeries = {
  readonly securityId: string;
  readonly issuerLegalEntityId: string;
  readonly issuerName: string | null;
  /** Ticker vigente al `as_of`; `null` si la security no tenía listing. */
  readonly ticker: string | null;
  readonly mic: string | null;
  readonly cedear: CedearMark;
  readonly closes: readonly ReturnClose[];
  readonly events: readonly ReturnEvent[];
};

export type SectorRiskMatrixInput = {
  readonly asOf: string;
  readonly sector: {
    readonly code: string;
    readonly label: string;
    readonly taxonomyId: string;
    readonly taxonomyVersion: string | null;
  };
  readonly reference: {
    readonly benchmarkId: string;
    readonly label: string;
    /** Serie total return: ya reinvierte, así que no lleva eventos. */
    readonly closes: readonly ReturnClose[];
  };
  readonly members: readonly SectorMemberSeries[];
};

/**
 * Dónde cae un punto respecto de la referencia. Sólo existe cuando el punto y la
 * referencia tienen las dos ventanas: un `null` no se ubica en un cuadrante.
 */
export type ReferenceQuadrant =
  "beats_both" | "beats_2y_only" | "beats_5y_only" | "beats_neither";

export type SectorRiskPoint = {
  readonly securityId: string;
  readonly issuerLegalEntityId: string;
  readonly issuerName: string | null;
  readonly ticker: string | null;
  readonly mic: string | null;
  readonly cedear: CedearMark;
  readonly sortino2y: SortinoResult;
  readonly sortino5y: SortinoResult;
  readonly quadrant: ReferenceQuadrant | null;
  /** Sortino de la security menos el de la referencia, en cada ventana. */
  readonly distanceToReference: {
    readonly window2y: string | null;
    readonly window5y: string | null;
  };
};

export type SectorFit =
  | {
      readonly status: "computed";
      readonly formulaVersion: typeof SECTOR_FIT_VERSION;
      readonly n: number;
      readonly slope: string;
      readonly intercept: string;
    }
  | {
      readonly status: "null";
      readonly formulaVersion: typeof SECTOR_FIT_VERSION;
      readonly n: number;
      readonly reason: "too_few_points" | "no_x_variance";
    };

export type SectorRiskMatrix = {
  readonly ruleVersion: typeof SECTOR_RISK_MATRIX_VERSION;
  readonly formulaVersion: typeof SORTINO_FORMULA_VERSION;
  readonly parameters: typeof SORTINO_PARAMETERS;
  readonly asOf: string;
  readonly sector: SectorRiskMatrixInput["sector"];
  readonly reference: {
    readonly benchmarkId: string;
    readonly label: string;
    readonly sortino2y: SortinoResult;
    readonly sortino5y: SortinoResult;
  };
  /** Ordenados por ticker; los que no tienen ticker, al final por ID. */
  readonly points: readonly SectorRiskPoint[];
  readonly fit: SectorFit;
};

const decimal = createDecimalOperations(
  (code: DecimalErrorCode, message, subjects) =>
    new MetricInputError(code, message, subjects),
);

function valueOf(result: SortinoResult): Dec | null {
  return result.status === "computed"
    ? decimal.parseDecimal(result.value, `sortino.${result.windowYears}y`)
    : null;
}

function quadrantOf(
  x: Dec | null,
  y: Dec | null,
  referenceX: Dec | null,
  referenceY: Dec | null,
): ReferenceQuadrant | null {
  if (x === null || y === null || referenceX === null || referenceY === null) {
    return null;
  }

  const beats2y = x.gt(referenceX);
  const beats5y = y.gt(referenceY);

  if (beats2y && beats5y) {
    return "beats_both";
  }

  if (beats2y) {
    return "beats_2y_only";
  }

  return beats5y ? "beats_5y_only" : "beats_neither";
}

function difference(value: Dec | null, reference: Dec | null, path: string) {
  return value === null || reference === null
    ? null
    : decimal.formatDecimal(value.minus(reference), path);
}

export function fitSector(
  points: readonly { readonly x: string; readonly y: string }[],
): SectorFit {
  const n = points.length;
  const pairs = points.map((point, index) => ({
    x: decimal.parseDecimal(point.x, `fit.points.${index}.x`),
    y: decimal.parseDecimal(point.y, `fit.points.${index}.y`),
  }));

  if (n < MIN_FIT_POINTS) {
    return {
      status: "null",
      formulaVersion: SECTOR_FIT_VERSION,
      n,
      reason: "too_few_points",
    };
  }

  const count = decimal.parseDecimal(String(n), "fit.n");
  const meanX = decimal.divide(
    sum(pairs.map((pair) => pair.x)),
    count,
    "fit.meanX",
  );
  const meanY = decimal.divide(
    sum(pairs.map((pair) => pair.y)),
    count,
    "fit.meanY",
  );
  const sxx = sum(pairs.map((pair) => pair.x.minus(meanX).pow(2)));
  const sxy = sum(
    pairs.map((pair) => pair.x.minus(meanX).times(pair.y.minus(meanY))),
  );

  if (sxx.isZero()) {
    return {
      status: "null",
      formulaVersion: SECTOR_FIT_VERSION,
      n,
      reason: "no_x_variance",
    };
  }

  const slope = decimal.divide(sxy, sxx, "fit.slope");

  return {
    status: "computed",
    formulaVersion: SECTOR_FIT_VERSION,
    n,
    slope: decimal.formatDecimal(slope, "fit.slope"),
    intercept: decimal.formatDecimal(
      meanY.minus(slope.times(meanX)),
      "fit.intercept",
    ),
  };
}

export function buildSectorRiskMatrix(
  input: SectorRiskMatrixInput,
): SectorRiskMatrix {
  const window = (
    subjectId: string,
    closes: readonly ReturnClose[],
    events: readonly ReturnEvent[],
    windowYears: 2 | 5,
  ) => sortino({ subjectId, asOf: input.asOf, windowYears, closes, events });

  const reference2y = window(
    input.reference.benchmarkId,
    input.reference.closes,
    [],
    2,
  );
  const reference5y = window(
    input.reference.benchmarkId,
    input.reference.closes,
    [],
    5,
  );
  const referenceX = valueOf(reference2y);
  const referenceY = valueOf(reference5y);

  const pairs: { x: string; y: string }[] = [];
  const points = input.members.map((member): SectorRiskPoint => {
    const sortino2y = window(
      member.securityId,
      member.closes,
      member.events,
      2,
    );
    const sortino5y = window(
      member.securityId,
      member.closes,
      member.events,
      5,
    );
    const x = valueOf(sortino2y);
    const y = valueOf(sortino5y);

    if (sortino2y.status === "computed" && sortino5y.status === "computed") {
      pairs.push({ x: sortino2y.value, y: sortino5y.value });
    }

    return {
      securityId: member.securityId,
      issuerLegalEntityId: member.issuerLegalEntityId,
      issuerName: member.issuerName,
      ticker: member.ticker,
      mic: member.mic,
      cedear: member.cedear,
      sortino2y,
      sortino5y,
      quadrant: quadrantOf(x, y, referenceX, referenceY),
      distanceToReference: {
        window2y: difference(x, referenceX, `distance.${member.securityId}.2y`),
        window5y: difference(y, referenceY, `distance.${member.securityId}.5y`),
      },
    };
  });

  points.sort((left, right) => {
    if (left.ticker === right.ticker) {
      return left.securityId.localeCompare(right.securityId);
    }

    if (left.ticker === null) {
      return 1;
    }

    return right.ticker === null ? -1 : left.ticker.localeCompare(right.ticker);
  });

  return {
    ruleVersion: SECTOR_RISK_MATRIX_VERSION,
    formulaVersion: SORTINO_FORMULA_VERSION,
    parameters: SORTINO_PARAMETERS,
    asOf: input.asOf,
    sector: input.sector,
    reference: {
      benchmarkId: input.reference.benchmarkId,
      label: input.reference.label,
      sortino2y: reference2y,
      sortino5y: reference5y,
    },
    points,
    fit: fitSector(pairs),
  };
}
