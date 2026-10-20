import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  EQUITY_VOLATILITY_FORMULA_VERSION,
  equityVolatility,
} from "@/modules/metrics/domain/equity-volatility";
import type {
  ReturnClose,
  ReturnEvent,
} from "@/modules/metrics/domain/total-return";
import { subtractCalendarYears } from "@/modules/temporal/domain/calendar-date";

import {
  divide,
  engineDecimalSchema,
  formatDecimal,
  ONE,
  parseDecimal,
  sum,
  type Dec,
} from "./decimal-policy";
import {
  EMPLOYEE_EQUITY_READING_VERSION,
  readEmployeeEquity,
  type EmployeeEquityReading,
} from "./employee-equity";
import { employeeEquityOutputSchema } from "./employee-equity-task";
import { OPTION_VALUE_VERSION, valueEmployeeOptions } from "./option-value";
import { currencySchema, factProvenanceShape } from "./valuation-facts";
import { ValuationPolicyError } from "./valuation-error";

/**
 * Opciones y unidades de empleados en la corrida (`F4-05`,
 * [ADR 0040](../../../../docs/architecture/adr/0040-failure-probability-employee-options.md),
 * `employee-equity-claim-1.0.0`).
 *
 * El snapshot congela **la decisión** —la transcripción aceptada con sus
 * versiones y el hash de la nota, como las decisiones cualitativas de
 * `F5-06`—, las acciones en circulación con su provenance y los insumos de
 * mercado al `as_of`. Todo lo demás se deriva y un policy check lo recalcula:
 * el valor de las opciones, que el puente resta como claim `employeeOptions`,
 * y el denominador del valor por acción, que es acciones en circulación más
 * unidades no consolidadas. Las opciones no se suman al denominador: ya
 * restaron su valor del equity.
 */
export const EMPLOYEE_EQUITY_CLAIM_VERSION = "employee-equity-claim-1.0.0";

/**
 * Rendimiento de dividendos de Black-Scholes: dividendos con ex-date en el
 * último año calendario hasta el `as_of`, llevados a la base del `as_of` por
 * los splits posteriores a cada uno, sobre el cierre crudo del `as_of`.
 */
export const DIVIDEND_YIELD_VERSION = "dividend-yield-trailing-1.0.0";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const versionSchema = z.string().min(1).max(64);

export const employeeEquityDecisionSchema = z.object({
  basis: z.literal("ai_proposal"),
  proposalId: z.uuid(),
  accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
  fiscalYearEnd: z.iso.date(),
  taskVersion: versionSchema,
  promptVersion: versionSchema,
  policyVersion: versionSchema,
  extractVersion: versionSchema,
  respondedModel: z.string().min(1).max(128),
  /** La nota no viaja: la representa su hash, y el texto queda en la tabla. */
  evidenceSha256: sha256Schema,
  transcription: employeeEquityOutputSchema.refine(
    (output) => output.decision === "proposed",
    { message: "Only an accepted transcription is frozen in a run." },
  ),
});

export type EmployeeEquityDecision = z.infer<
  typeof employeeEquityDecisionSchema
>;

const sharesFactSchema = z.object({
  ...factProvenanceShape,
  value: engineDecimalSchema,
  unit: z.literal("shares"),
});

export const employeeOptionMarketSchema = z.object({
  price: z.object({
    value: engineDecimalSchema,
    marketDate: z.iso.date(),
    currency: currencySchema,
    sourceId: z.string().min(3).max(64),
  }),
  volatility: z.object({
    formulaVersion: z.literal(EQUITY_VOLATILITY_FORMULA_VERSION),
    value: engineDecimalSchema,
    windowStart: z.iso.date(),
    baseDate: z.iso.date(),
    returns: z.number().int().min(2),
  }),
  dividendYield: z.object({
    version: z.literal(DIVIDEND_YIELD_VERSION),
    value: engineDecimalSchema,
    /** Dividendos por acción del año, en la base del `as_of`. */
    dividends: engineDecimalSchema,
    from: z.iso.date(),
    to: z.iso.date(),
  }),
});

export type EmployeeOptionMarket = z.infer<typeof employeeOptionMarketSchema>;

const readingSchema = z.object({
  version: z.literal(EMPLOYEE_EQUITY_READING_VERSION),
  options: z.discriminatedUnion("status", [
    z.object({ status: z.literal("none_disclosed") }),
    z.object({
      status: z.literal("outstanding"),
      count: engineDecimalSchema,
      strike: engineDecimalSchema,
      strikeBasis: z.enum(["printed", "strike_unknown_upper_bound"]),
      maturityYears: engineDecimalSchema,
      maturityBasis: z.enum([
        "remaining_years",
        "expiration_year",
        "range_rows",
      ]),
    }),
  ]),
  unvestedUnits: engineDecimalSchema,
  unitsBasis: z.enum(["outstanding", "none_disclosed"]),
});

const optionValueSchema = z.object({
  version: z.literal(OPTION_VALUE_VERSION),
  adjustedPrice: engineDecimalSchema,
  valuePerOption: engineDecimalSchema,
  totalValue: engineDecimalSchema,
  iterations: z.number().int().min(1),
});

export const employeeEquityDerivedSchema = z.object({
  reading: readingSchema,
  options: optionValueSchema.nullable(),
  /** Acciones en circulación más unidades no consolidadas. */
  shareCount: engineDecimalSchema,
});

export type EmployeeEquityDerived = z.infer<typeof employeeEquityDerivedSchema>;

export const employeeEquityClaimSchema = z.object({
  version: z.literal(EMPLOYEE_EQUITY_CLAIM_VERSION),
  decision: employeeEquityDecisionSchema,
  sharesOutstanding: sharesFactSchema,
  /** Sólo con opciones vivas: sin ellas no hay nada que valuar. */
  market: employeeOptionMarketSchema.nullable(),
  derived: employeeEquityDerivedSchema,
});

export type EmployeeEquityClaim = z.infer<typeof employeeEquityClaimSchema>;

/**
 * Lo que el código deriva de la decisión, las acciones y el mercado. Las
 * opciones vivas sin insumos de mercado no se valúan como cero: se rechazan.
 */
export function deriveEmployeeEquity(input: {
  decision: EmployeeEquityDecision;
  sharesOutstanding: { value: string };
  market: EmployeeOptionMarket | null;
  riskFree: string;
}): EmployeeEquityDerived {
  const reading: EmployeeEquityReading = readEmployeeEquity(
    input.decision.transcription,
    input.decision.fiscalYearEnd,
  );
  const shares = parseDecimal(
    input.sharesOutstanding.value,
    "employeeEquity.sharesOutstanding.value",
  );
  let options = null;

  if (reading.options.status === "outstanding") {
    if (input.market === null) {
      throw new ValuationPolicyError(
        "policy_check_failed",
        "Outstanding employee options need a price, a volatility and a dividend yield.",
        ["employeeEquity.market"],
      );
    }

    options = valueEmployeeOptions({
      price: input.market.price.value,
      strike: reading.options.strike,
      maturityYears: reading.options.maturityYears,
      volatility: input.market.volatility.value,
      riskFree: input.riskFree,
      dividendYield: input.market.dividendYield.value,
      optionsOutstanding: reading.options.count,
      sharesOutstanding: input.sharesOutstanding.value,
    });
  }

  return {
    reading,
    options,
    shareCount: formatDecimal(
      shares.plus(
        parseDecimal(reading.unvestedUnits, "employeeEquity.unvestedUnits"),
      ),
      "employeeEquity.shareCount",
    ),
  };
}

/**
 * Rutas que no coinciden con lo que el claim deriva al recalcularlo: el
 * policy check las rechaza. Recalcular puede fallar por sí mismo —opciones sin
 * mercado, un insumo inválido—, y eso también es una diferencia.
 */
export function employeeEquityMismatches(
  claim: EmployeeEquityClaim,
  context: { riskFree: string; currency: string; asOf: string },
): string[] {
  const mismatches: string[] = [];
  const outstanding =
    claim.decision.transcription.optionsStatus === "outstanding";

  if (outstanding !== (claim.market !== null)) {
    mismatches.push("employeeEquity.market");
  }

  if (claim.market !== null) {
    if (claim.market.price.currency !== context.currency) {
      mismatches.push("employeeEquity.market.price.currency");
    }
    if (claim.market.price.marketDate > context.asOf) {
      mismatches.push("employeeEquity.market.price.marketDate");
    }
  }

  if (claim.decision.fiscalYearEnd > context.asOf) {
    mismatches.push("employeeEquity.decision.fiscalYearEnd");
  }
  if (claim.sharesOutstanding.asOf > context.asOf) {
    mismatches.push("employeeEquity.sharesOutstanding.asOf");
  }

  try {
    const rebuilt = deriveEmployeeEquity({
      decision: claim.decision,
      sharesOutstanding: claim.sharesOutstanding,
      market: claim.market,
      riskFree: context.riskFree,
    });

    if (computeContentHash(rebuilt) !== computeContentHash(claim.derived)) {
      mismatches.push("employeeEquity.derived");
    }
  } catch {
    mismatches.push("employeeEquity.derived");
  }

  return [...new Set(mismatches)];
}

export type EmployeeOptionMarketUnavailable =
  | { reason: "no_close_at_as_of" }
  | { reason: "volatility_unavailable"; detail: string };

/**
 * Los insumos de mercado al `as_of` desde la serie cruda guardada (`F7-01`):
 * el cierre del `as_of`, la volatilidad de cinco años y el rendimiento de
 * dividendos del último año. Pura: lo que la serie no tiene se nombra.
 */
export function employeeOptionMarketAt(input: {
  subjectId: string;
  asOf: string;
  sourceId: string;
  closes: readonly ReturnClose[];
  events: readonly ReturnEvent[];
}): EmployeeOptionMarket | EmployeeOptionMarketUnavailable {
  const close = input.closes.find(
    (candidate) => candidate.marketDate === input.asOf,
  );

  if (close === undefined) {
    return { reason: "no_close_at_as_of" };
  }

  const volatility = equityVolatility({
    subjectId: input.subjectId,
    asOf: input.asOf,
    closes: input.closes,
    events: input.events,
  });

  if (volatility.status === "null") {
    return { reason: "volatility_unavailable", detail: volatility.reason };
  }

  const from = subtractCalendarYears(input.asOf, 1);
  const splitsAfter = (date: string): Dec =>
    input.events
      .filter(
        (event) =>
          event.eventType === "split" &&
          event.effectiveOn > date &&
          event.effectiveOn <= input.asOf,
      )
      .reduce(
        (factor, event) =>
          factor.times(
            parseDecimal(event.value, `splits.${event.effectiveOn}`),
          ),
        ONE,
      );
  const dividends = sum(
    input.events
      .filter(
        (event) =>
          event.eventType === "dividend" &&
          event.effectiveOn > from &&
          event.effectiveOn <= input.asOf,
      )
      .map((event) =>
        divide(
          parseDecimal(event.value, `dividends.${event.effectiveOn}`),
          splitsAfter(event.effectiveOn),
          `dividends.${event.effectiveOn}`,
        ),
      ),
  );
  const price = parseDecimal(close.close, "price");

  return {
    price: {
      value: close.close,
      marketDate: close.marketDate,
      currency: close.currency,
      sourceId: input.sourceId,
    },
    volatility: {
      formulaVersion: volatility.formulaVersion,
      value: volatility.value,
      windowStart: volatility.windowStart,
      baseDate: volatility.baseDate,
      returns: volatility.returns,
    },
    dividendYield: {
      version: DIVIDEND_YIELD_VERSION,
      value: formatDecimal(
        divide(dividends, price, "dividendYield"),
        "dividendYield",
      ),
      dividends: formatDecimal(dividends, "dividends"),
      from,
      to: input.asOf,
    },
  };
}

/**
 * Acciones en circulación del denominador (`shares-outstanding-cover-1.0.0`):
 * el conteo de la carátula del 10-K o 10-Q —`dei:EntityCommonStockSharesOutstanding`,
 * sin dimensiones— más reciente que la fecha de valuación y el corte de
 * conocimiento admiten, que es el conteo actual que Damodaran usa.
 *
 * No `us-gaap:CommonStockSharesOutstanding`: medido el 2026-10-20, Salesforce
 * publica ahí 929 millones contra 823 de su carátula, y Johnson & Johnson no
 * lo publica. Un filer con varias clases (Ford) sólo publica la carátula con
 * dimensiones, que `companyfacts` no trae: queda `null` y la corrida nombra el
 * faltante; nunca se suma una clase sola ni se asume cero (`TM-05`).
 */
export const SHARES_OUTSTANDING_RECIPE_VERSION =
  "shares-outstanding-cover-1.0.0";

export const SHARES_OUTSTANDING_CONCEPT =
  "dei:EntityCommonStockSharesOutstanding";

export type ShareCountObservation = {
  readonly concept: string;
  readonly asOf: string;
  readonly availableAt: string;
  readonly value: string;
};

export function sharesOutstandingAt<T extends ShareCountObservation>(
  observations: readonly T[],
  context: { readonly asOf: string; readonly knownAt: string },
): T | null {
  const known = observations
    .filter(
      (observation) =>
        observation.concept === SHARES_OUTSTANDING_CONCEPT &&
        observation.asOf <= context.asOf &&
        Date.parse(observation.availableAt) <= Date.parse(context.knownAt) &&
        parseDecimal(observation.value, "sharesOutstanding").greaterThan(0),
    )
    .sort((left, right) =>
      left.asOf === right.asOf
        ? Date.parse(right.availableAt) - Date.parse(left.availableAt)
        : right.asOf.localeCompare(left.asOf),
    );

  return known[0] ?? null;
}
