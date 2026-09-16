import {
  createDecimalOperations,
  ONE,
  type Dec,
  type DecimalErrorCode,
} from "@/modules/numeric/domain/decimal-policy";
import type { Observation } from "@/modules/observations/domain/observation";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { CorporateAction } from "./reporting-succession";

/**
 * Base accionaria de un valor reportado: la regla que comparten la verificación
 * de un split y la lectura ajustada.
 *
 * La idea central, medida contra el cable el 2026-09-15: **la base de un valor la
 * decide la presentación que lo reportó, no el período**. Por ASC 260 la primera
 * presentación posterior a un split ya re-expresa el EPS y las acciones de todos
 * los períodos que muestra, así que no hace falta conocer la fecha de
 * distribución —que XBRL no publica de forma confiable—: alcanza con saber cuál
 * fue la primera presentación en base nueva. Un valor cuya vintage es conocible
 * antes de esa presentación está en la base anterior; uno conocible desde ella, en
 * la nueva.
 *
 * Tres piezas:
 *
 * 1. **qué es sensible**: una lista cerrada de conceptos con su dirección. La
 *    unidad no alcanza: un día la selección puede sumar acciones preferidas, que
 *    un split de las comunes no toca;
 * 2. **coherencia**: cuándo dos revisiones del mismo hecho difieren exactamente
 *    por un factor, dentro del redondeo con el que se reportan;
 * 3. **factor posterior**: el producto de los ratios de los splits conocibles
 *    después de la presentación que reportó el valor.
 */
export const SPLIT_BASIS_RULE_VERSION = "split-basis-1.0.0";

export const SPLIT_RATIO_CONCEPT = Object.freeze({
  taxonomy: "us-gaap",
  concept: "StockholdersEquityNoteStockSplitConversionRatio1",
});

export const SPLIT_RATIO_QUALIFIED_CONCEPT = `${SPLIT_RATIO_CONCEPT.taxonomy}:${SPLIT_RATIO_CONCEPT.concept}`;

/**
 * `per_share` se divide por el ratio y `share_count` se multiplica. Un ratio
 * menor que uno es un reverse split y las dos fórmulas siguen valiendo.
 */
export type ShareSensitivity = "per_share" | "share_count";

const SENSITIVE_CONCEPTS: ReadonlyMap<
  string,
  { readonly sensitivity: ShareSensitivity; readonly unit: string }
> = new Map([
  [
    "us-gaap:EarningsPerShareBasic",
    { sensitivity: "per_share", unit: "monetary_per_share" },
  ],
  [
    "us-gaap:EarningsPerShareDiluted",
    { sensitivity: "per_share", unit: "monetary_per_share" },
  ],
  [
    "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
    { sensitivity: "share_count", unit: "shares" },
  ],
  [
    "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding",
    { sensitivity: "share_count", unit: "shares" },
  ],
  [
    "us-gaap:CommonStockSharesOutstanding",
    { sensitivity: "share_count", unit: "shares" },
  ],
  [
    "dei:EntityCommonStockSharesOutstanding",
    { sensitivity: "share_count", unit: "shares" },
  ],
]);

/** Unidades que una acción societaria sobre las comunes puede mover. */
const SHARE_UNITS: ReadonlySet<string> = new Set([
  "shares",
  "monetary_per_share",
]);

export function listSplitSensitiveConcepts(): readonly string[] {
  return [...SENSITIVE_CONCEPTS.keys()];
}

export const SHARE_BASIS_ERROR_CODES = [
  "invalid_decimal",
  "non_finite_value",
  "division_by_zero",
  /** Un valor en acciones o por acción cuyo concepto la regla no clasifica. */
  "unclassified_share_unit",
  /** Una fila de otro filer del linaje, sin la conversión de la sucesión. */
  "adjustment_across_succession",
  /** Otra presentación conocible en el mismo instante que el split. */
  "ambiguous_share_basis",
  /** Una revisión cuya anterior no llegó a la lectura. */
  "revision_chain_incomplete",
] as const;

export type ShareBasisErrorCode = (typeof SHARE_BASIS_ERROR_CODES)[number];

export class ShareBasisError extends Error {
  readonly code: ShareBasisErrorCode;
  /** Sólo identificadores internos y rutas de campo: nunca valores (`TM-02`). */
  readonly subjects: readonly string[];

  constructor(
    code: ShareBasisErrorCode,
    message: string,
    subjects: readonly string[] = [],
  ) {
    super(message);
    this.name = "ShareBasisError";
    this.code = code;
    this.subjects = [...subjects];
  }
}

export function isShareBasisError(
  error: unknown,
  code?: ShareBasisErrorCode,
): error is ShareBasisError {
  return (
    error instanceof ShareBasisError &&
    (code === undefined || error.code === code)
  );
}

export const shareBasisDecimal = createDecimalOperations(
  (code: DecimalErrorCode, message, subjects) =>
    new ShareBasisError(code, message, subjects),
);

/**
 * Sensibilidad declarada, sin fallar: `unclassified` es una unidad de acciones
 * cuyo concepto la regla no conoce, o un concepto conocido en otra unidad.
 */
export function declaredShareSensitivity(
  observation: Pick<Observation, "concept" | "unit">,
): ShareSensitivity | "unclassified" | null {
  const declared = SENSITIVE_CONCEPTS.get(observation.concept);

  if (declared === undefined) {
    return SHARE_UNITS.has(observation.unit) ? "unclassified" : null;
  }

  return declared.unit === observation.unit
    ? declared.sensitivity
    : "unclassified";
}

/**
 * Sensibilidad de una observación que se va a ajustar o a usar como evidencia.
 * Un concepto de la lista con otra unidad, o una unidad de acciones con un
 * concepto fuera de la lista, no se adivina: falla.
 */
export function shareSensitivity(
  observation: Pick<Observation, "concept" | "unit" | "observationId">,
): ShareSensitivity | null {
  const declared = declaredShareSensitivity(observation);

  if (declared === "unclassified") {
    throw new ShareBasisError(
      "unclassified_share_unit",
      "A share-denominated value has no declared share sensitivity.",
      [observation.observationId],
    );
  }

  return declared;
}

/**
 * Tolerancias de la coherencia, versionadas con la regla.
 *
 * - **Por acción:** el EPS se reporta en centavos y se recalcula en la base nueva,
 *   así que los dos lados traen su propio redondeo. Si `x` es el EPS exacto, el
 *   reportado viejo está a medio centavo de `x` y el nuevo a medio centavo de
 *   `x/F`; entonces `|viejo − nuevo·F| ≤ 0,005·(1 + F)`. Medido en Apple: el EPS
 *   de 2,18 re-expresado a 0,55 por el 4:1 da un factor aparente de 3,9636 y una
 *   diferencia de 0,02, dentro de 0,025.
 * - **Relativa:** 0,5% para acciones, que se reportan redondeadas a miles o
 *   millones, y para un EPS grande que se redondea a pesos enteros. Los ratios
 *   reales más cercanos entre sí —3:2 contra 4:3— distan 12,5%, así que la banda
 *   no confunde un split con otro.
 */
const HALF_CENT = shareBasisDecimal.parseDecimal("0.005", "tolerance.halfCent");
const RELATIVE = shareBasisDecimal.parseDecimal("0.005", "tolerance.relative");

export type Coherence = "coherent" | "incoherent" | "uninformative";

/**
 * ¿`next` es `previous` expresado en una base `factor` veces más fina?
 *
 * Un cero o un cambio de signo no prueban ningún factor: son `uninformative`, ni
 * evidencia a favor ni en contra.
 */
export function classifyCoherence(input: {
  readonly sensitivity: ShareSensitivity;
  readonly previous: string;
  readonly next: string;
  readonly factor: Dec;
}): Coherence {
  const previous = shareBasisDecimal.parseDecimal(input.previous, "previous");
  const next = shareBasisDecimal.parseDecimal(input.next, "next");

  if (
    previous.isZero() ||
    next.isZero() ||
    previous.isNegative() !== next.isNegative()
  ) {
    return "uninformative";
  }

  if (input.sensitivity === "share_count") {
    const expected = previous.times(input.factor);
    const tolerance = expected.abs().times(RELATIVE);

    return next.minus(expected).abs().lte(tolerance)
      ? "coherent"
      : "incoherent";
  }

  const expectedPrevious = next.times(input.factor);
  const rounding = HALF_CENT.times(ONE.plus(input.factor));
  const relative = previous.abs().times(RELATIVE);
  const tolerance = rounding.gt(relative) ? rounding : relative;

  return previous.minus(expectedPrevious).abs().lte(tolerance)
    ? "coherent"
    : "incoherent";
}

export function isSplitAction(action: Pick<CorporateAction, "actionType">) {
  return action.actionType === "split" || action.actionType === "reverse_split";
}

/** Ratio de un split registrado: acciones nuevas por cada acción anterior. */
export function splitRatio(action: CorporateAction): Dec {
  const ratio = action.terms.ratio;

  if (!isSplitAction(action) || ratio === undefined) {
    throw new ShareBasisError(
      "invalid_decimal",
      "The corporate action does not carry a split ratio.",
      [action.corporateActionId],
    );
  }

  return shareBasisDecimal.parseDecimal(ratio, "terms.ratio");
}

/**
 * Un split participa si es conocible en el corte, con la misma regla que una
 * observación: `available_at <= known_at` y, bajo `system_recorded`, además
 * registrado. `latest_restated` ve todos.
 */
export function isSplitVisibleAt(
  action: CorporateAction,
  query: PointInTimeQuery,
): boolean {
  if (query.revisionPolicy === "latest_restated") {
    return true;
  }

  const at = Date.parse(query.knownAt);

  return (
    Date.parse(action.availableAt) <= at &&
    (query.knowledgeBasis !== "system_recorded" ||
      Date.parse(action.recordedAt) <= at)
  );
}

/**
 * Un cambio de base: lo mínimo que la regla necesita de un split, sea uno ya
 * registrado o uno que la verificación acaba de confirmar.
 */
export type BasisChange = {
  readonly id: string;
  readonly availableAt: string;
  /** Presentación que publicó la base nueva. */
  readonly document: string;
  readonly ratio: Dec;
};

export function toBasisChange(action: CorporateAction): BasisChange {
  return {
    id: action.corporateActionId,
    availableAt: action.availableAt,
    document: action.sourceDocumentId,
    ratio: splitRatio(action),
  };
}

export type LaterSplitFactor = {
  /** Producto de los ratios aplicables, como decimal de cálculo. */
  readonly factor: Dec;
  readonly changeIds: readonly string[];
};

type FilingInstant = {
  readonly availableAt: string;
  readonly document: string | null;
};

/**
 * Factor de los cambios de base posteriores a la presentación que publicó un valor.
 *
 * `after` es el `available_at` de la vintage y su presentación. Un cambio aplica si
 * su presentación es conocible **después**. En el mismo instante, la presentación
 * del split ya está en base nueva; otra presentación del mismo instante no tiene
 * desempate y falla en vez de elegir una base.
 *
 * `until` acota por arriba, inclusive, con la misma regla de empate: la
 * clasificación de una revisión mira sólo los cambios entre sus dos vintages, y el
 * split cuya presentación publicó la revisión nueva cuenta.
 */
export function laterSplitFactor(
  changes: readonly BasisChange[],
  after: FilingInstant,
  until: FilingInstant | null = null,
): LaterSplitFactor {
  const from = Date.parse(after.availableAt);
  const to = until === null ? null : Date.parse(until.availableAt);
  let factor = ONE;
  const ids: string[] = [];

  const ambiguous = (change: BasisChange) =>
    new ShareBasisError(
      "ambiguous_share_basis",
      "Another filing became available at the same instant as a split.",
      [change.id],
    );

  for (const change of [...changes].sort(
    (left, right) =>
      Date.parse(left.availableAt) - Date.parse(right.availableAt),
  )) {
    const at = Date.parse(change.availableAt);

    if (at < from || (to !== null && at > to)) {
      continue;
    }

    if (at === from) {
      if (change.document === after.document) {
        continue;
      }

      throw ambiguous(change);
    }

    if (at === to && change.document !== until!.document) {
      throw ambiguous(change);
    }

    factor = factor.times(change.ratio);
    ids.push(change.id);
  }

  return { factor, changeIds: ids };
}
