import { z } from "zod";

import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

import type {
  AnnualFundamentals,
  FiscalYear,
  LineItemId,
  LineItemValue,
} from "./annual-fundamentals";
import { parseDecimal, ZERO, type Dec } from "./decimal-policy";
import {
  ebitWithInterest,
  freezeInterest,
  frozenInterestSchema,
  frozenInterestValue,
  interestExpenseOf,
} from "./interest-expense";
import {
  DEBT_COMPONENT_KEYS,
  DEBT_ITEMS,
  debtComponentKeySchema,
  resolveReportedDebt,
  type ReportedDebtInput,
} from "./reported-debt";
import { conceptFactSchema, type ConceptFact } from "./valuation-facts";
import {
  coverageFloorSchema,
  frozenEbitSchema,
  frozenEbitValue,
  type CoverageFloor,
  type FrozenEbit,
} from "./zero-debt-evidence";

/**
 * Cobertura de una empresa con pérdida operativa y caja neta (`F6-41`, decisión
 * delegada por el owner el 2026-11-19 con CRWD y DDOG medidos).
 *
 * Con EBIT negativo la cobertura `EBIT / intereses` es negativa con cualquier
 * interés, y la tabla de rating sintético la lleva a `D2/D`: un costo de deuda
 * del 23 % y una probabilidad de fracaso que la tabla de Damodaran no tiene. Para
 * quien puede pagar hoy toda su deuda con su caja, eso no mide nada: CRWD tenía
 * 745 M de deuda contra varios miles de millones de caja y flujo operativo
 * positivo. Es la misma lectura que `fundamental-profile-signals-1.2.0` ya hace
 * para el distress (`operating_loss_with_net_cash`), llevada al rating.
 *
 * En el ejercicio de la cobertura, con:
 *
 * - EBIT no positivo con intereses positivos (la cobertura no mide);
 * - patrimonio positivo;
 * - flujo de caja operativo positivo: la caja no se está consumiendo. Una
 *   empresa que quema caja no entra, aunque hoy cubra su deuda;
 * - caja e inversiones líquidas, corrientes y no corrientes, que cubren la
 *   deuda que `reported-debt` resuelve en ese cierre. Una deuda sin receta no
 *   prueba nada y la regla no se aplica;
 *
 * la cobertura es el piso de la banda más alta de la tabla de la corrida, la
 * misma convención que la deuda cero (ADR 0054): la deuda neta es nula. Los
 * hechos se congelan con su concepto y el motor recalcula la regla.
 */
export const NET_CASH_COVERAGE_VERSION = "net-cash-coverage-1.0.0";

const LIQUID_ITEMS: readonly LineItemId[] = [
  "cash",
  "liquid_investments",
  "marketable_securities_noncurrent",
];

export const netCashCoverageSchema = z.object({
  version: z.literal(NET_CASH_COVERAGE_VERSION),
  fiscalYearEnd: calendarDateSchema,
  coverageFloor: coverageFloorSchema,
  ebit: frozenEbitSchema,
  interest: frozenInterestSchema,
  equity: conceptFactSchema,
  operatingCashFlow: conceptFactSchema,
  /** Caja primero, después las inversiones líquidas. */
  liquid: z.array(conceptFactSchema).min(1).max(LIQUID_ITEMS.length),
  /** Los componentes de deuda publicados en el cierre, por receta. */
  debt: z
    .array(
      z.object({ component: debtComponentKeySchema, fact: conceptFactSchema }),
    )
    .max(DEBT_COMPONENT_KEYS.length),
});

export type NetCashCoverage = z.infer<typeof netCashCoverageSchema>;

export type NetCashShortfall =
  | "operating_income_positive"
  | "interest_not_positive"
  | "equity_not_positive"
  | "operating_cash_flow_not_positive"
  | "debt_unresolved"
  | "debt_exceeds_liquid_assets"
  | "currency_mismatch";

function value(fact: ConceptFact, path: string): Dec {
  return parseDecimal(fact.value, path);
}

function debtInput(evidence: NetCashCoverage): ReportedDebtInput {
  return Object.fromEntries(
    DEBT_COMPONENT_KEYS.map((key) => {
      const entry = evidence.debt.find((item) => item.component === key);
      return [
        key,
        entry === undefined
          ? null
          : { value: entry.fact.value, concept: entry.fact.concept },
      ];
    }),
  ) as ReportedDebtInput;
}

function ebitFacts(ebit: FrozenEbit): ConceptFact[] {
  return ebit.basis === "operating_income"
    ? [ebit.fact]
    : [ebit.pretaxIncome, ...ebit.interest.facts];
}

/** Todos los hechos congelados, con su ruta. */
export function listNetCashCoverageFacts(
  evidence: NetCashCoverage,
  prefix: string,
): readonly { path: string; fact: ConceptFact }[] {
  return [
    ...ebitFacts(evidence.ebit).map((fact, index) => ({
      path: `${prefix}.ebit.${index}`,
      fact,
    })),
    ...evidence.interest.facts.map((fact, index) => ({
      path: `${prefix}.interest.facts.${index}`,
      fact,
    })),
    { path: `${prefix}.equity`, fact: evidence.equity },
    { path: `${prefix}.operatingCashFlow`, fact: evidence.operatingCashFlow },
    ...evidence.liquid.map((fact, index) => ({
      path: `${prefix}.liquid.${index}`,
      fact,
    })),
    ...evidence.debt.map((entry, index) => ({
      path: `${prefix}.debt.${index}`,
      fact: entry.fact,
    })),
  ];
}

/** Qué falla de una evidencia congelada, o `null` si la sostiene. Pura. */
export function netCashCoverageShortfall(
  evidence: NetCashCoverage,
): NetCashShortfall | null {
  const facts = listNetCashCoverageFacts(evidence, "netCash");
  if (new Set(facts.map(({ fact }) => fact.currency)).size > 1)
    return "currency_mismatch";
  if (frozenEbitValue(evidence.ebit).greaterThan(ZERO))
    return "operating_income_positive";
  if (!frozenInterestValue(evidence.interest).greaterThan(ZERO))
    return "interest_not_positive";
  if (!value(evidence.equity, "equity").greaterThan(ZERO))
    return "equity_not_positive";
  if (!value(evidence.operatingCashFlow, "operatingCashFlow").greaterThan(ZERO))
    return "operating_cash_flow_not_positive";
  const debt = resolveReportedDebt(debtInput(evidence));
  if (debt.status !== "resolved") return "debt_unresolved";
  const liquid = evidence.liquid.reduce(
    (sum, fact) => sum.plus(value(fact, "liquid")),
    ZERO,
  );
  return liquid.greaterThanOrEqualTo(parseDecimal(debt.total, "debt"))
    ? null
    : "debt_exceeds_liquid_assets";
}

/** Lo que no cierra de una evidencia guardada, como rutas. */
export function netCashCoverageMismatches(
  evidence: NetCashCoverage,
  prefix: string,
): string[] {
  const mismatches = listNetCashCoverageFacts(evidence, prefix)
    .filter(({ fact }) => fact.asOf !== evidence.fiscalYearEnd)
    .map(({ path }) => path);
  if (netCashCoverageShortfall(evidence) !== null) mismatches.push(prefix);
  return mismatches;
}

export type NetCashCoverageAssessment =
  | { readonly status: "not_applicable" }
  | { readonly status: "met"; readonly evidence: NetCashCoverage }
  | {
      readonly status: "not_met";
      readonly reason:
        NetCashShortfall | "facts_missing" | "coverage_floor_unavailable";
    };

/**
 * Evalúa la regla sobre el ejercicio de la cobertura. `not_applicable` cuando
 * ese ejercicio tiene EBIT positivo: la cobertura mide y la regla no corre.
 */
export function assessNetCashCoverage(
  series: AnnualFundamentals,
  fiscalYearEnd: string,
  coverageFloor: CoverageFloor | null,
  toFact: (item: LineItemValue) => ConceptFact,
): NetCashCoverageAssessment {
  const year: FiscalYear | undefined = series.fiscalYears.find(
    (candidate) => candidate.fiscalYearEnd === fiscalYearEnd,
  );
  const reading = ebitWithInterest(year);
  const interest = interestExpenseOf(year);
  if (reading !== null && reading.ebit.value.greaterThan(ZERO))
    return { status: "not_applicable" };
  const equity = year?.items.equity;
  const operatingCashFlow = year?.items.operating_cash_flow;
  const liquid = LIQUID_ITEMS.flatMap((id) => {
    const line = year?.items[id];
    return line === undefined ? [] : [line];
  });
  if (
    year === undefined ||
    reading === null ||
    interest === null ||
    equity === undefined ||
    operatingCashFlow === undefined ||
    year.items.cash === undefined
  )
    return { status: "not_met", reason: "facts_missing" };
  if (coverageFloor === null)
    return { status: "not_met", reason: "coverage_floor_unavailable" };

  const ebit: FrozenEbit =
    reading.ebit.basis === "operating_income"
      ? { basis: "operating_income", fact: toFact(reading.ebit.inputs[0]!) }
      : {
          basis: "pretax_plus_interest",
          pretaxIncome: toFact(reading.ebit.inputs[0]!),
          interest: freezeInterest(reading.interest!, toFact),
        };
  const evidence = netCashCoverageSchema.parse({
    version: NET_CASH_COVERAGE_VERSION,
    fiscalYearEnd,
    coverageFloor,
    ebit,
    interest: freezeInterest(interest, toFact),
    equity: toFact(equity),
    operatingCashFlow: toFact(operatingCashFlow),
    liquid: liquid.map(toFact),
    debt: DEBT_COMPONENT_KEYS.flatMap((component) => {
      const line = year.items[DEBT_ITEMS[component]];
      return line === undefined ? [] : [{ component, fact: toFact(line) }];
    }),
  });
  const reason = netCashCoverageShortfall(evidence);
  return reason === null
    ? { status: "met", evidence }
    : { status: "not_met", reason };
}
