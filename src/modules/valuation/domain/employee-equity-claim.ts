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

/**
 * Sin transcripción aceptada (`F6-16`,
 * [ADR 0055](../../../../docs/architecture/adr/0055-employee-options-fallback.md)):
 * las opciones vivas y su strike que publica el XBRL de la **misma
 * presentación** al cierre del ejercicio base, y las unidades no consolidadas
 * si las publica. El plazo remanente no está en companyfacts —es un período
 * XBRL—, así que se valúan a diez años, el plazo contractual de una opción de
 * empleado y su cota superior: el mismo lado conservador que un strike
 * desconocido valuado en cero. Decisión del owner del 2026-10-22.
 */
export const EMPLOYEE_OPTIONS_XBRL_VERSION = "employee-options-xbrl-1.0.0";

/** Más que esto no vive una opción de empleado: la cota del plazo. */
export const OPTION_CONTRACTUAL_TERM_YEARS = "10";

export const OPTIONS_OUTSTANDING_CONCEPT =
  "us-gaap:ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingNumber";
export const OPTIONS_WEIGHTED_STRIKE_CONCEPT =
  "us-gaap:ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingWeightedAverageExercisePrice";
export const UNVESTED_UNITS_CONCEPT =
  "us-gaap:ShareBasedCompensationArrangementByShareBasedPaymentAwardEquityInstrumentsOtherThanOptionsNonvestedNumber";

/**
 * Ni transcripción ni XBRL: la corrida no resta opciones, lo dice en el puente
 * y en la página, y el rigor baja un nivel. Decisión del owner del 2026-10-22.
 */
export const EMPLOYEE_OPTIONS_NOT_SUBTRACTED_VERSION =
  "employee-options-not-subtracted-1.0.0";

/** Un hecho XBRL del snapshot: cantidad en acciones o precio por acción. */
const xbrlFactSchema = z.object({
  ...factProvenanceShape,
  concept: z.string().min(1).max(256),
  value: engineDecimalSchema,
});

export type EmployeeOptionsXbrlFact = z.infer<typeof xbrlFactSchema>;

const aiDecisionSchema = z.object({
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

export const employeeEquityDecisionSchema = z.discriminatedUnion("basis", [
  aiDecisionSchema,
  z.object({
    basis: z.literal("xbrl_same_10k"),
    version: z.literal(EMPLOYEE_OPTIONS_XBRL_VERSION),
    fiscalYearEnd: z.iso.date(),
    /** La presentación de la que salen todos los hechos. */
    sourceDocumentId: z.string().min(1).max(256),
    optionsOutstanding: xbrlFactSchema,
    /** `null` sólo con cero opciones: sin opciones no hay strike que leer. */
    weightedStrike: xbrlFactSchema.nullable(),
    unvestedUnits: xbrlFactSchema.nullable(),
  }),
  z.object({
    basis: z.literal("not_subtracted"),
    version: z.literal(EMPLOYEE_OPTIONS_NOT_SUBTRACTED_VERSION),
    fiscalYearEnd: z.iso.date(),
    reason: z.literal("no_transcription_or_xbrl"),
  }),
]);

export type EmployeeEquityDecision = z.infer<
  typeof employeeEquityDecisionSchema
>;

export type AiEmployeeEquityDecision = Extract<
  EmployeeEquityDecision,
  { basis: "ai_proposal" }
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

/**
 * La lectura de una decisión que no es una transcripción (`F6-16`). La de una
 * transcripción sigue siendo `employee-equity-reading-1.0.0`, byte por byte.
 */
export const EMPLOYEE_EQUITY_FALLBACK_READING_VERSION =
  "employee-equity-reading-1.1.0";

const readingSchema = z.object({
  version: z.enum([
    EMPLOYEE_EQUITY_READING_VERSION,
    EMPLOYEE_EQUITY_FALLBACK_READING_VERSION,
  ]),
  options: z.discriminatedUnion("status", [
    z.object({ status: z.literal("none_disclosed") }),
    z.object({ status: z.literal("not_subtracted") }),
    z.object({
      status: z.literal("outstanding"),
      count: engineDecimalSchema,
      strike: engineDecimalSchema,
      strikeBasis: z.enum(["printed", "strike_unknown_upper_bound", "xbrl"]),
      maturityYears: engineDecimalSchema,
      maturityBasis: z.enum([
        "remaining_years",
        "expiration_year",
        "range_rows",
        "contractual_term_upper_bound",
      ]),
    }),
  ]),
  unvestedUnits: engineDecimalSchema,
  unitsBasis: z.enum(["outstanding", "none_disclosed", "xbrl", "not_reported"]),
});

type DerivedReading = z.infer<typeof readingSchema>;

/** Lo que se lee de cada base de la decisión. */
export function readingOfDecision(
  decision: EmployeeEquityDecision,
): DerivedReading {
  if (decision.basis === "ai_proposal") {
    const reading: EmployeeEquityReading = readEmployeeEquity(
      decision.transcription,
      decision.fiscalYearEnd,
    );
    return reading;
  }

  if (decision.basis === "not_subtracted") {
    return {
      version: EMPLOYEE_EQUITY_FALLBACK_READING_VERSION,
      options: { status: "not_subtracted" },
      unvestedUnits: "0",
      unitsBasis: "not_reported",
    };
  }

  const count = parseDecimal(
    decision.optionsOutstanding.value,
    "employeeEquity.decision.optionsOutstanding",
  );
  const units = decision.unvestedUnits;

  if (count.greaterThan(0) && decision.weightedStrike === null) {
    throw new TypeError("Outstanding options from XBRL need their strike.");
  }

  return {
    version: EMPLOYEE_EQUITY_FALLBACK_READING_VERSION,
    options: count.greaterThan(0)
      ? {
          status: "outstanding",
          count: formatDecimal(count, "options.count"),
          strike: formatDecimal(
            parseDecimal(decision.weightedStrike!.value, "options.strike"),
            "options.strike",
          ),
          strikeBasis: "xbrl",
          maturityYears: OPTION_CONTRACTUAL_TERM_YEARS,
          maturityBasis: "contractual_term_upper_bound",
        }
      : { status: "none_disclosed" },
    unvestedUnits:
      units === null
        ? "0"
        : formatDecimal(parseDecimal(units.value, "units"), "units"),
    unitsBasis: units === null ? "not_reported" : "xbrl",
  };
}

/**
 * Las opciones del XBRL de una presentación al cierre del ejercicio base
 * (`employee-options-xbrl-1.0.0`): la última presentación conocida al corte
 * que publica la cantidad, con el strike de esa misma presentación. Una
 * cantidad positiva sin strike, o dos valores distintos de un mismo concepto
 * en la presentación, no son un respaldo: `null`, y la corrida no resta
 * opciones.
 */
export function employeeOptionsXbrlAt<
  T extends ShareCountObservation & {
    readonly observationId: string;
    readonly sourceDocumentId: string | null;
  },
>(
  facts: readonly T[],
  context: {
    readonly fiscalYearEnd: string;
    readonly knownAt: string;
    readonly sourceId: string;
  },
): Extract<EmployeeEquityDecision, { basis: "xbrl_same_10k" }> | null {
  const visible = facts.filter(
    (fact) =>
      fact.asOf === context.fiscalYearEnd &&
      fact.sourceDocumentId !== null &&
      Date.parse(fact.availableAt) <= Date.parse(context.knownAt),
  );
  const documents = [
    ...new Set(
      visible
        .filter((fact) => fact.concept === OPTIONS_OUTSTANDING_CONCEPT)
        .sort((left, right) =>
          right.availableAt.localeCompare(left.availableAt),
        )
        .map((fact) => fact.sourceDocumentId!),
    ),
  ];
  const document = documents[0];

  if (document === undefined) {
    return null;
  }

  const one = (concept: string): T | null | "conflict" => {
    const matches = visible.filter(
      (fact) => fact.sourceDocumentId === document && fact.concept === concept,
    );
    if (new Set(matches.map((fact) => fact.value)).size > 1) return "conflict";
    return matches[0] ?? null;
  };
  const count = one(OPTIONS_OUTSTANDING_CONCEPT);
  const strike = one(OPTIONS_WEIGHTED_STRIKE_CONCEPT);
  const units = one(UNVESTED_UNITS_CONCEPT);

  if (
    count === null ||
    count === "conflict" ||
    strike === "conflict" ||
    units === "conflict" ||
    parseDecimal(count.value, "xbrl.options").lessThan(0) ||
    (parseDecimal(count.value, "xbrl.options").greaterThan(0) &&
      strike === null)
  ) {
    return null;
  }

  const frozen = (fact: T): EmployeeOptionsXbrlFact => ({
    concept: fact.concept,
    value: fact.value,
    asOf: fact.asOf,
    availableAt: fact.availableAt,
    sourceId: context.sourceId,
    sourceDocumentId: fact.sourceDocumentId,
    observationId: fact.observationId,
    qualityFlags: [],
  });
  const positive = parseDecimal(count.value, "xbrl.options").greaterThan(0);

  return {
    basis: "xbrl_same_10k",
    version: EMPLOYEE_OPTIONS_XBRL_VERSION,
    fiscalYearEnd: context.fiscalYearEnd,
    sourceDocumentId: document,
    optionsOutstanding: frozen(count),
    weightedStrike: positive && strike !== null ? frozen(strike) : null,
    unvestedUnits: units === null ? null : frozen(units),
  };
}

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
  const reading = readingOfDecision(input.decision);
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
  let outstanding: boolean;

  try {
    outstanding =
      readingOfDecision(claim.decision).options.status === "outstanding";
  } catch {
    return ["employeeEquity.decision"];
  }

  // Los hechos XBRL son del cierre que dice la decisión, de una sola
  // presentación: un conteo de otro balance no es el de este ejercicio.
  if (claim.decision.basis === "xbrl_same_10k") {
    const { decision } = claim;
    const facts = [
      decision.optionsOutstanding,
      decision.weightedStrike,
      decision.unvestedUnits,
    ].filter((fact) => fact !== null);
    const concepts = [
      OPTIONS_OUTSTANDING_CONCEPT,
      OPTIONS_WEIGHTED_STRIKE_CONCEPT,
      UNVESTED_UNITS_CONCEPT,
    ];

    if (
      facts.some(
        (fact) =>
          fact.asOf !== decision.fiscalYearEnd ||
          fact.sourceDocumentId !== decision.sourceDocumentId,
      ) ||
      [
        decision.optionsOutstanding,
        decision.weightedStrike,
        decision.unvestedUnits,
      ].some((fact, index) => fact !== null && fact.concept !== concepts[index])
    ) {
      mismatches.push("employeeEquity.decision");
    }
  }

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

/**
 * La decisión, sabiendo que es una transcripción: para fixtures que la editan.
 * Otra base es un error del llamador, no un caso a manejar.
 */
export function aiDecisionOf(
  decision: EmployeeEquityDecision,
): AiEmployeeEquityDecision {
  if (decision.basis !== "ai_proposal") {
    throw new TypeError(
      `Expected an ai_proposal decision, got ${decision.basis}.`,
    );
  }

  return decision;
}
