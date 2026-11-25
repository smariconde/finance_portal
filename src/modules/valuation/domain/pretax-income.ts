import { z } from "zod";

import { formatDecimal, parseDecimal, ZERO } from "./decimal-policy";
import type { LineItemValue } from "./annual-fundamentals";
import { conceptFactSchema, type ConceptFact } from "./valuation-facts";

/**
 * La utilidad antes de impuestos de un filer que no publica el total
 * (`pretax-income-1.0.0`, `F6-52`, decisión del owner del 2026-11-25).
 *
 * Phillips 66 publica la parte doméstica y la extranjera y nunca el total: sin
 * él no hay EBIT derivado, tasa del año base ni márgenes de ciclo. Medido sobre
 * el índice con los frames CY2024 de la SEC: 28 de 502 entidades no publican el
 * total y 11 de ellas sí las dos partes. Donde hay total y partes (345), la
 * suma da el total exacto en 335, pero no en Quest, Iron Mountain, Tesla ni Air
 * Products: el total incluye algo que las partes no. En los tres primeros el
 * impuesto a la tasa federal legal de la conciliación (÷ 0,21) da el total y no
 * la suma, así que ese es el control: la suma vale sólo si la conciliación la
 * corrobora a 0,5 % o menos. Sin conciliación, la partida sigue ausente.
 *
 * La tasa es la de la reforma de 2017 (21 %): un ejercicio que cerró antes de
 * que rigiera un año entero no se compone (`pre_federal_rate_21`).
 */
export const PRETAX_INCOME_VERSION = "pretax-income-1.0.0";

/** El concepto con que la serie nombra la suma: no es de la taxonomía. */
export const COMPOSED_PRETAX_CONCEPT =
  "derived:PretaxIncomeDomesticPlusForeign";

/** La marca de calidad del hecho congelado. */
export const COMPOSED_PRETAX_FLAG = "pretax_domestic_plus_foreign";

export const FEDERAL_STATUTORY_RATE = "0.21";

/**
 * El primer cierre de ejercicio entero al 21 %: un año de 52/53 semanas que
 * termina a fin de diciembre de 2018 puede haber empezado el 2017-12-24.
 */
export const FIRST_FISCAL_YEAR_END_AT_FEDERAL_RATE = "2018-12-21";

export const STATUTORY_CONTROL_TOLERANCE = "0.005";

export const PRETAX_COMPOSITION_REASONS = [
  "legs_missing",
  "control_missing",
  "currency_mismatch",
  "pre_federal_rate_21",
  "zero_total",
  "control_mismatch",
] as const;

export type PretaxCompositionReason =
  (typeof PRETAX_COMPOSITION_REASONS)[number];

type Leg = Pick<LineItemValue, "value" | "currency" | "asOf">;

export type PretaxComposition<Fact extends Leg = LineItemValue> = {
  readonly version: typeof PRETAX_INCOME_VERSION;
  readonly domestic: Fact;
  readonly foreign: Fact;
  readonly statutoryTax: Fact;
};

export type PretaxCompositionReading<Fact extends Leg = LineItemValue> =
  | {
      readonly status: "composed";
      readonly value: string;
      readonly composition: PretaxComposition<Fact>;
    }
  | {
      readonly status: "not_composed";
      readonly reason: PretaxCompositionReason;
    };

/**
 * Compone el total con las dos partes y su control. Pura: no mira si el filer
 * publicó el total; eso lo decide quien la llama, que sólo la usa sin él.
 */
export function composePretaxIncome<Fact extends Leg>(input: {
  readonly fiscalYearEnd: string;
  readonly domestic: Fact | null | undefined;
  readonly foreign: Fact | null | undefined;
  readonly statutoryTax: Fact | null | undefined;
}): PretaxCompositionReading<Fact> {
  const { domestic, foreign, statutoryTax } = input;

  if (domestic == null || foreign == null) {
    return { status: "not_composed", reason: "legs_missing" };
  }
  if (statutoryTax == null) {
    return { status: "not_composed", reason: "control_missing" };
  }
  if (
    domestic.currency === null ||
    domestic.currency !== foreign.currency ||
    domestic.currency !== statutoryTax.currency
  ) {
    return { status: "not_composed", reason: "currency_mismatch" };
  }
  if (input.fiscalYearEnd < FIRST_FISCAL_YEAR_END_AT_FEDERAL_RATE) {
    return { status: "not_composed", reason: "pre_federal_rate_21" };
  }

  const sum = parseDecimal(domestic.value, "pretax.domestic").plus(
    parseDecimal(foreign.value, "pretax.foreign"),
  );

  if (sum.equals(ZERO)) {
    return { status: "not_composed", reason: "zero_total" };
  }

  const implied = parseDecimal(statutoryTax.value, "pretax.statutoryTax").div(
    parseDecimal(FEDERAL_STATUTORY_RATE, "federalRate"),
  );
  const gap = implied.minus(sum).abs().div(sum.abs());

  if (gap.greaterThan(parseDecimal(STATUTORY_CONTROL_TOLERANCE, "tolerance"))) {
    return { status: "not_composed", reason: "control_mismatch" };
  }

  return {
    status: "composed",
    value: formatDecimal(sum, "pretax.composed"),
    composition: {
      version: PRETAX_INCOME_VERSION,
      domestic,
      foreign,
      statutoryTax,
    },
  };
}

/** La composición congelada en el snapshot: tres hechos con su concepto. */
export const frozenPretaxCompositionSchema = z.object({
  version: z.literal(PRETAX_INCOME_VERSION),
  domestic: conceptFactSchema,
  foreign: conceptFactSchema,
  statutoryTax: conceptFactSchema,
});

export type FrozenPretaxComposition = z.infer<
  typeof frozenPretaxCompositionSchema
>;

/**
 * Lo que el snapshot afirma que vale la utilidad antes de impuestos compuesta,
 * recalculado de sus tres hechos; `null` si no la compondría.
 */
export function frozenPretaxValue(
  fiscalYearEnd: string,
  composition: FrozenPretaxComposition,
): string | null {
  const reading = composePretaxIncome<ConceptFact>({
    fiscalYearEnd,
    domestic: composition.domestic,
    foreign: composition.foreign,
    statutoryTax: composition.statutoryTax,
  });

  return reading.status === "composed" ? reading.value : null;
}
