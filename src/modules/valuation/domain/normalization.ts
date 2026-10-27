import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

import type {
  AnnualFundamentals,
  LineItemId,
  LineItemValue,
} from "./annual-fundamentals";
import type { Capitalization } from "./capitalization-bridge";
import {
  divide,
  engineDecimalSchema,
  formatDecimal,
  ONE,
  parseDecimal,
  sum,
  ZERO,
  type Dec,
} from "./decimal-policy";
import {
  assessNonRecurringCharge,
  NON_RECURRING_CHARGE_VERSION,
  NON_RECURRING_LOOKBACK_YEARS,
  nonRecurringChargeSchema,
  type ChargeCategory,
} from "./non-recurring-charges";
import {
  DEBT_COMPONENT_KEYS,
  REPORTED_DEBT_EVIDENCE_VERSION,
  reportedDebtSchema,
  resolveReportedDebt,
  type DebtComponentKey,
} from "./reported-debt";
import {
  conceptFactSchema,
  type ConceptFact,
  type MonetaryFact,
} from "./valuation-facts";

import {
  listZeroDebtEvidenceFacts,
  zeroDebtEvidenceMismatches,
  zeroDebtEvidenceSchema,
  type ZeroDebtEvidence,
} from "./zero-debt-evidence";

export { conceptFactSchema, type ConceptFact };

/**
 * Normalización reported → ajustes → ajustado del ejercicio base (`F4-03`,
 * [ADR 0038](../../../../docs/architecture/adr/0038-reported-adjusted-normalization.md)).
 *
 * Lleva los hechos con su provenance **y su concepto** —la regla de deuda
 * necesita saber cuál aportó cada partida—, lo que cada regla deriva y un libro
 * donde cada ajuste declara destino, estado, monto, regla y evidencia. Un
 * ajuste que no se hace también se declara, con su motivo. El motor lo
 * **recalcula**: un monto escrito a mano no pasa el check.
 *
 * Los ajustes de arrendamientos e I+D se toman de `capitalization` (`F4-01`),
 * que ya tiene su propio check; acá no se recalculan dos veces.
 */
export const NORMALIZATION_VERSION = "normalization-1.0.0";
export const INVESTED_CAPITAL_VERSION = "invested-capital-1.0.0";
export const EXCESS_CASH_VERSION = "excess-cash-1.0.0";
export const BASE_TAX_RATE_VERSION = "base-tax-rate-1.0.0";

/** El patrimonio que ya incluye a los minoritarios: no se suman otra vez. */
export const EQUITY_INCLUDING_MINORITY =
  "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest";

const fact = conceptFactSchema.nullable();
const amount = engineDecimalSchema;

const debtFactsShape = Object.fromEntries(
  DEBT_COMPONENT_KEYS.map((key) => [key, fact]),
) as Record<DebtComponentKey, typeof fact>;

export const normalizationFactsSchema = z.object({
  baseFiscalYearEnd: calendarDateSchema,
  income: z.object({
    pretaxIncome: fact,
    incomeTax: fact,
    shareBasedCompensation: fact,
  }),
  balance: z.object({
    equity: fact,
    minorityInterest: fact,
    cash: fact,
    liquidInvestments: fact,
    marketableSecuritiesNoncurrent: fact,
    debt: z.object(debtFactsShape),
  }),
  /** Del ejercicio base hacia atrás; las ventas prueban que el año está. */
  chargeHistory: z
    .array(
      z.object({
        fiscalYearEnd: calendarDateSchema,
        revenue: fact,
        restructuring: fact,
        impairment: fact,
      }),
    )
    .min(1)
    .max(NON_RECURRING_LOOKBACK_YEARS + 1),
  /**
   * La evidencia de deuda cero (`F6-15`, ADR 0054). Sólo viaja cuando ninguna
   * receta cierra y la evidencia se cumple: un snapshot anterior no la tiene y
   * conserva su hash.
   */
  zeroDebtEvidence: zeroDebtEvidenceSchema.optional(),
});

export type NormalizationFacts = z.infer<typeof normalizationFactsSchema>;

export const excessCashSchema = z.discriminatedUnion("status", [
  z.object({
    version: z.literal(EXCESS_CASH_VERSION),
    status: z.literal("resolved"),
    components: z
      .array(
        z.object({
          component: z.enum([
            "cash",
            "liquidInvestments",
            "marketableSecuritiesNoncurrent",
          ]),
          amount,
        }),
      )
      .min(1)
      .max(3),
    total: amount,
  }),
  z.object({
    version: z.literal(EXCESS_CASH_VERSION),
    status: z.literal("unresolved"),
    reason: z.enum(["cash_not_reported", "negative_component"]),
  }),
]);

export type ExcessCash = z.infer<typeof excessCashSchema>;

export const investedCapitalSchema = z.discriminatedUnion("status", [
  z.object({
    version: z.literal(INVESTED_CAPITAL_VERSION),
    status: z.literal("resolved"),
    equity: amount,
    /** `null` cuando el patrimonio publicado ya la incluye o no se publicó. */
    minorityInterest: amount.nullable(),
    minorityInterestBasis: z.enum([
      "reported",
      "included_in_equity",
      "not_reported",
    ]),
    debt: amount,
    cash: amount,
    reported: amount,
    capitalizationDelta: amount,
    adjusted: amount,
  }),
  z.object({
    version: z.literal(INVESTED_CAPITAL_VERSION),
    status: z.literal("unresolved"),
    reason: z.enum([
      "equity_not_reported",
      "debt_unresolved",
      "excess_cash_unresolved",
    ]),
  }),
]);

export type InvestedCapital = z.infer<typeof investedCapitalSchema>;

export const baseTaxRateSchema = z.object({
  version: z.literal(BASE_TAX_RATE_VERSION),
  effective: amount.nullable(),
  effectiveUnavailable: z
    .enum([
      "pretax_income_not_reported",
      "income_tax_not_reported",
      "non_positive_pretax_income",
      "effective_rate_out_of_range",
    ])
    .nullable(),
  /** `null` fuera de una corrida, cuando la evaluación no armó el costo de capital. */
  marginal: amount.nullable(),
  basis: z.enum(["effective", "marginal", "unavailable"]),
  applied: amount.nullable(),
});

export type BaseTaxRate = z.infer<typeof baseTaxRateSchema>;

export const adjustmentIdSchema = z.enum([
  "operating_lease_capitalization",
  "rd_capitalization",
  "restructuring_non_recurring",
  "impairment_non_recurring",
  "share_based_compensation",
]);

export const ledgerEntrySchema = z.object({
  id: adjustmentIdSchema,
  target: z.enum(["ebit", "invested_capital", "debt"]),
  status: z.enum(["applied", "not_applied"]),
  /** El motivo de un ajuste que no se hace; `null` si se aplicó. */
  reason: z.string().trim().min(1).max(64).nullable(),
  /** Lo que se suma al destino; con `not_applied`, el monto en juego o `null`. */
  amount: amount.nullable(),
  fiscalYearEnd: calendarDateSchema,
  rule: z.string().trim().min(1).max(64),
  /** Rutas de los hechos que lo sostienen, nunca valores (`TM-02`). */
  evidence: z.array(z.string().trim().min(1).max(160)).max(24),
});

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const normalizedBaseSchema = z.object({
  ebitReported: amount.nullable(),
  ebitAdjusted: amount.nullable(),
  ebitMarginAdjusted: amount.nullable(),
  nopatAdjusted: amount.nullable(),
  returnOnCapitalAdjusted: amount.nullable(),
  salesToCapitalAdjusted: amount.nullable(),
});

export const normalizationSchema = z.object({
  version: z.literal(NORMALIZATION_VERSION),
  facts: normalizationFactsSchema,
  debt: reportedDebtSchema,
  excessCash: excessCashSchema,
  investedCapital: investedCapitalSchema,
  taxRate: baseTaxRateSchema,
  charges: z.object({
    restructuring: nonRecurringChargeSchema,
    impairment: nonRecurringChargeSchema,
  }),
  ledger: z.array(ledgerEntrySchema).max(16),
  base: normalizedBaseSchema,
});

export type Normalization = z.infer<typeof normalizationSchema>;

export type NormalizationContext = {
  /** `ValuationInput.baseRevenue.value`. */
  readonly baseRevenue: string;
  /**
   * La tasa marginal del costo de capital de la corrida. `null` sólo fuera de
   * una corrida —una evaluación sin costo de capital—: la corrida siempre lo
   * tiene.
   */
  readonly marginalTaxRate: string | null;
  /** La capitalización de la corrida, ya recalculada por su check. */
  readonly capitalization: Capitalization;
};

const decimal = (value: string, path: string): Dec => parseDecimal(value, path);
const format = (value: Dec, path: string): string => formatDecimal(value, path);

/** Toda la caja es excedente (`excess-cash-1.0.0`, decisión 3). */
export function resolveExcessCash(
  balance: NormalizationFacts["balance"],
): ExcessCash {
  if (balance.cash === null) {
    return {
      version: EXCESS_CASH_VERSION,
      status: "unresolved",
      reason: "cash_not_reported",
    };
  }

  const components = (
    ["cash", "liquidInvestments", "marketableSecuritiesNoncurrent"] as const
  )
    .filter((component) => balance[component] !== null)
    .map((component) => ({
      component,
      value: decimal(balance[component]!.value, `cash.${component}`),
    }));

  if (components.some(({ value }) => value.lessThan(ZERO))) {
    return {
      version: EXCESS_CASH_VERSION,
      status: "unresolved",
      reason: "negative_component",
    };
  }

  return {
    version: EXCESS_CASH_VERSION,
    status: "resolved",
    components: components.map(({ component, value }) => ({
      component,
      amount: format(value, `cash.${component}`),
    })),
    total: format(sum(components.map(({ value }) => value)), "cash.total"),
  };
}

function resolveInvestedCapital(
  balance: NormalizationFacts["balance"],
  debt: Normalization["debt"],
  excessCash: ExcessCash,
  capitalization: Capitalization,
): InvestedCapital {
  const unresolved = (
    reason:
      "equity_not_reported" | "debt_unresolved" | "excess_cash_unresolved",
  ): InvestedCapital => ({
    version: INVESTED_CAPITAL_VERSION,
    status: "unresolved",
    reason,
  });

  if (balance.equity === null) return unresolved("equity_not_reported");
  if (debt.status === "unresolved") return unresolved("debt_unresolved");
  if (excessCash.status !== "resolved") {
    return unresolved("excess_cash_unresolved");
  }

  const equity = decimal(balance.equity.value, "capital.equity");
  const minorityBasis =
    balance.equity.concept === EQUITY_INCLUDING_MINORITY
      ? "included_in_equity"
      : balance.minorityInterest === null
        ? "not_reported"
        : "reported";
  const minority =
    minorityBasis === "reported"
      ? decimal(balance.minorityInterest!.value, "capital.minorityInterest")
      : null;
  const debtTotal = decimal(debt.total, "capital.debt");
  const cash = decimal(excessCash.total, "capital.cash");
  const reported = sum([equity, minority ?? ZERO, debtTotal]).minus(cash);
  const delta = decimal(
    capitalization.ledger.investedCapitalDelta.total,
    "capital.capitalizationDelta",
  );

  return {
    version: INVESTED_CAPITAL_VERSION,
    status: "resolved",
    equity: format(equity, "capital.equity"),
    minorityInterest:
      minority === null ? null : format(minority, "capital.minorityInterest"),
    minorityInterestBasis: minorityBasis,
    debt: format(debtTotal, "capital.debt"),
    cash: format(cash, "capital.cash"),
    reported: format(reported, "capital.reported"),
    capitalizationDelta: format(delta, "capital.capitalizationDelta"),
    adjusted: format(reported.plus(delta), "capital.adjusted"),
  };
}

/**
 * Tasa efectiva del ejercicio base y, sin ella, la marginal de la corrida
 * (`base-tax-rate-1.0.0`). La marginal sigue siendo la del terminal.
 */
export function resolveBaseTaxRate(
  income: NormalizationFacts["income"],
  marginalTaxRate: string | null,
): BaseTaxRate {
  const marginal =
    marginalTaxRate === null ? null : decimal(marginalTaxRate, "tax.marginal");
  const unavailable = (() => {
    if (income.pretaxIncome === null) return "pretax_income_not_reported";
    if (income.incomeTax === null) return "income_tax_not_reported";
    if (!decimal(income.pretaxIncome.value, "tax.pretax").greaterThan(ZERO)) {
      return "non_positive_pretax_income";
    }
    return null;
  })();

  let effective: Dec | null = null;
  let reason: BaseTaxRate["effectiveUnavailable"] = unavailable;

  if (unavailable === null) {
    const rate = divide(
      decimal(income.incomeTax!.value, "tax.incomeTax"),
      decimal(income.pretaxIncome!.value, "tax.pretax"),
      "tax.pretax",
    );

    if (rate.lessThan(ZERO) || rate.greaterThan(ONE)) {
      reason = "effective_rate_out_of_range";
    } else {
      effective = rate;
    }
  }

  return {
    version: BASE_TAX_RATE_VERSION,
    effective: effective === null ? null : format(effective, "tax.effective"),
    effectiveUnavailable: reason,
    marginal: marginal === null ? null : format(marginal, "tax.marginal"),
    basis:
      effective !== null
        ? "effective"
        : marginal !== null
          ? "marginal"
          : "unavailable",
    applied:
      effective === null && marginal === null
        ? null
        : format((effective ?? marginal)!, "tax.applied"),
  };
}

function chargeYears(facts: NormalizationFacts, category: ChargeCategory) {
  return facts.chargeHistory.map((year) => ({
    fiscalYearEnd: year.fiscalYearEnd,
    covered: year.revenue !== null,
    charge:
      year[category] === null
        ? null
        : { value: year[category]!.value, concept: year[category]!.concept },
  }));
}

function buildLedger(
  facts: NormalizationFacts,
  capitalization: Capitalization,
  charges: Normalization["charges"],
): LedgerEntry[] {
  const base = facts.baseFiscalYearEnd;
  const entries: LedgerEntry[] = [];
  const leases = capitalization.leases.result;
  const rd = capitalization.researchAndDevelopment.result;
  const leaseEvidence = [
    "capitalization.leases.totalLiability",
    "capitalization.leases.currentLiability",
    "capitalization.leases.noncurrentLiability",
  ].filter((path) => {
    const key = path.split(".").at(-1) as
      "totalLiability" | "currentLiability" | "noncurrentLiability";
    return capitalization.leases[key] !== null;
  });
  const rdEvidence = capitalization.researchAndDevelopment.fiscalYears
    .map((year, index) =>
      year.amount === null
        ? null
        : `capitalization.researchAndDevelopment.fiscalYears.${index}.amount`,
    )
    .filter((path): path is string => path !== null);

  const leaseTargets = [
    ["ebit", "ebitAdjustment"],
    ["invested_capital", "investedCapitalAdjustment"],
    ["debt", "debtAdjustment"],
  ] as const;

  for (const [target, field] of leaseTargets) {
    entries.push({
      id: "operating_lease_capitalization",
      target,
      status: leases.status === "capitalized" ? "applied" : "not_applied",
      reason: leases.status === "capitalized" ? null : leases.reason,
      amount: leases.status === "capitalized" ? leases[field] : null,
      fiscalYearEnd: base,
      rule: leases.version,
      evidence: leaseEvidence,
    });
  }

  const rdTargets = [
    ["ebit", "ebitAdjustment"],
    ["invested_capital", "investedCapitalAdjustment"],
  ] as const;

  for (const [target, field] of rdTargets) {
    entries.push({
      id: "rd_capitalization",
      target,
      status: rd.status === "capitalized" ? "applied" : "not_applied",
      reason: rd.status === "capitalized" ? null : rd.reason,
      amount: rd.status === "capitalized" ? rd[field] : null,
      fiscalYearEnd: base,
      rule: rd.version,
      evidence: rdEvidence,
    });
  }

  for (const category of ["restructuring", "impairment"] as const) {
    const result = charges[category];
    const evidence = facts.chargeHistory
      .map((year, index) =>
        year[category] === null
          ? null
          : `normalization.facts.chargeHistory.${index}.${category}`,
      )
      .filter((path): path is string => path !== null);

    entries.push({
      id: `${category}_non_recurring`,
      target: "ebit",
      status: result.status,
      reason: result.status === "applied" ? null : result.reason,
      amount: result.status === "applied" ? result.ebitAdjustment : null,
      fiscalYearEnd: base,
      rule: NON_RECURRING_CHARGE_VERSION,
      evidence,
    });
  }

  // La compensación en acciones es un gasto: no se revierte, y el monto queda
  // a la vista para que la diferencia con un «ajustado» de la empresa se lea.
  const sbc = facts.income.shareBasedCompensation;

  entries.push({
    id: "share_based_compensation",
    target: "ebit",
    status: "not_applied",
    reason: sbc === null ? "not_reported" : "expensed",
    amount: sbc === null ? null : sbc.value,
    fiscalYearEnd: base,
    rule: NORMALIZATION_VERSION,
    evidence:
      sbc === null ? [] : ["normalization.facts.income.shareBasedCompensation"],
  });

  return entries;
}

function buildBase(
  context: NormalizationContext,
  charges: Normalization["charges"],
  investedCapital: InvestedCapital,
  taxRate: BaseTaxRate,
): Normalization["base"] {
  const { ebit } = context.capitalization.ledger;
  const revenue = decimal(context.baseRevenue, "baseRevenue.value");
  const chargeAdjustment = sum(
    (["restructuring", "impairment"] as const).map((category) => {
      const result = charges[category];
      return result.status === "applied"
        ? decimal(result.ebitAdjustment, `charges.${category}`)
        : ZERO;
    }),
  );
  const adjusted =
    ebit.adjusted === null
      ? null
      : decimal(ebit.adjusted, "ebit.capitalized").plus(chargeAdjustment);
  const nopat =
    adjusted === null || taxRate.applied === null
      ? null
      : adjusted.times(ONE.minus(decimal(taxRate.applied, "tax.applied")));
  const capital =
    investedCapital.status === "resolved"
      ? decimal(investedCapital.adjusted, "capital.adjusted")
      : null;
  const positiveCapital =
    capital !== null && capital.greaterThan(ZERO) ? capital : null;

  return {
    ebitReported: ebit.reported,
    ebitAdjusted: adjusted === null ? null : format(adjusted, "base.ebit"),
    ebitMarginAdjusted:
      adjusted === null || !revenue.greaterThan(ZERO)
        ? null
        : format(divide(adjusted, revenue, "baseRevenue.value"), "base.margin"),
    nopatAdjusted: nopat === null ? null : format(nopat, "base.nopat"),
    returnOnCapitalAdjusted:
      nopat === null || positiveCapital === null
        ? null
        : format(
            divide(nopat, positiveCapital, "capital.adjusted"),
            "base.roic",
          ),
    salesToCapitalAdjusted:
      positiveCapital === null
        ? null
        : format(
            divide(revenue, positiveCapital, "capital.adjusted"),
            "base.salesToCapital",
          ),
  };
}

/** Los componentes de deuda de los hechos, como los lee la receta. */
export function debtInputOf(
  debt: NormalizationFacts["balance"]["debt"],
): Record<DebtComponentKey, { value: string; concept: string } | null> {
  return Object.fromEntries(
    DEBT_COMPONENT_KEYS.map((key) => {
      const value = debt[key];
      return [
        key,
        value === null ? null : { value: value.value, concept: value.concept },
      ];
    }),
  ) as Record<DebtComponentKey, { value: string; concept: string } | null>;
}

/** Aplica las reglas a los hechos y arma el libro. Pura. */
export function buildNormalization(
  facts: NormalizationFacts,
  context: NormalizationContext,
): Normalization {
  const debt = resolveReportedDebt(
    debtInputOf(facts.balance.debt),
    facts.zeroDebtEvidence ?? null,
  );
  const excessCash = resolveExcessCash(facts.balance);
  const investedCapital = resolveInvestedCapital(
    facts.balance,
    debt,
    excessCash,
    context.capitalization,
  );
  const taxRate = resolveBaseTaxRate(facts.income, context.marginalTaxRate);
  const charges = {
    restructuring: assessNonRecurringCharge(
      "restructuring",
      chargeYears(facts, "restructuring"),
    ),
    impairment: assessNonRecurringCharge(
      "impairment",
      chargeYears(facts, "impairment"),
    ),
  };

  return normalizationSchema.parse({
    version: NORMALIZATION_VERSION,
    facts,
    debt,
    excessCash,
    investedCapital,
    taxRate,
    charges,
    ledger: buildLedger(facts, context.capitalization, charges),
    base: buildBase(context, charges, investedCapital, taxRate),
  });
}

/** Los hechos de la normalización con su ruta, para los checks. */
export function listNormalizationFacts(
  normalization: Normalization,
): readonly { path: string; fact: ConceptFact; asOf: string }[] {
  const { facts } = normalization;
  const base = facts.baseFiscalYearEnd;
  const entries: { path: string; fact: ConceptFact | null; asOf: string }[] = [
    ...Object.entries(facts.income).map(([key, value]) => ({
      path: `normalization.facts.income.${key}`,
      fact: value,
      asOf: base,
    })),
    ...(
      [
        "equity",
        "minorityInterest",
        "cash",
        "liquidInvestments",
        "marketableSecuritiesNoncurrent",
      ] as const
    ).map((key) => ({
      path: `normalization.facts.balance.${key}`,
      fact: facts.balance[key],
      asOf: base,
    })),
    ...DEBT_COMPONENT_KEYS.map((key) => ({
      path: `normalization.facts.balance.debt.${key}`,
      fact: facts.balance.debt[key],
      asOf: base,
    })),
    ...facts.chargeHistory.flatMap((year, index) =>
      (["revenue", "restructuring", "impairment"] as const).map((key) => ({
        path: `normalization.facts.chargeHistory.${index}.${key}`,
        fact: year[key],
        asOf: year.fiscalYearEnd,
      })),
    ),
  ];

  return [
    ...entries.filter(
      (entry): entry is { path: string; fact: ConceptFact; asOf: string } =>
        entry.fact !== null,
    ),
    ...(facts.zeroDebtEvidence === undefined
      ? []
      : listZeroDebtEvidenceFacts(
          facts.zeroDebtEvidence,
          "normalization.facts.zeroDebtEvidence",
        )),
  ];
}

/**
 * Lo que no cierra entre la normalización guardada y la que sus hechos
 * derivan, como rutas de campo (`TM-02`). Vacío es un libro coherente.
 */
export function normalizationMismatches(
  normalization: Normalization,
  context: NormalizationContext,
): string[] {
  const mismatches: string[] = [];
  const { facts } = normalization;

  if (facts.baseFiscalYearEnd !== context.capitalization.baseFiscalYearEnd) {
    mismatches.push("normalization.facts.baseFiscalYearEnd");
  }

  if (facts.chargeHistory[0]?.fiscalYearEnd !== facts.baseFiscalYearEnd) {
    mismatches.push("normalization.facts.chargeHistory.0");
  }

  // Ejercicios estrictamente decrecientes: un año repetido o desordenado
  // cambiaría qué cuenta como «los cuatro anteriores».
  facts.chargeHistory.forEach((year, index) => {
    const previous = facts.chargeHistory[index - 1];
    if (
      previous !== undefined &&
      year.fiscalYearEnd >= previous.fiscalYearEnd
    ) {
      mismatches.push(`normalization.facts.chargeHistory.${index}`);
    }
  });

  // Cada hecho es del cierre que dice ser: un pasivo de otro balance no es la
  // deuda de este ejercicio.
  for (const entry of listNormalizationFacts(normalization)) {
    if (entry.fact.asOf !== entry.asOf) {
      mismatches.push(entry.path);
    }
  }

  // La evidencia de deuda cero sólo viaja si la deuda la usa, y se recalcula
  // entera: el piso, el orden de los ejercicios y la regla.
  if (facts.zeroDebtEvidence !== undefined) {
    mismatches.push(
      ...zeroDebtEvidenceMismatches(
        facts.zeroDebtEvidence,
        facts.baseFiscalYearEnd,
        "normalization.facts.zeroDebtEvidence",
      ),
    );

    if (normalization.debt.version !== REPORTED_DEBT_EVIDENCE_VERSION) {
      mismatches.push("normalization.facts.zeroDebtEvidence");
    }
  }

  const rebuilt = buildNormalization(facts, context);

  for (const key of [
    "debt",
    "excessCash",
    "investedCapital",
    "taxRate",
    "charges",
    "ledger",
    "base",
  ] as const) {
    if (
      computeContentHash(rebuilt[key]) !==
      computeContentHash(normalization[key])
    ) {
      mismatches.push(`normalization.${key}`);
    }
  }

  return mismatches;
}

const BALANCE_ITEMS: Readonly<
  Record<Exclude<keyof NormalizationFacts["balance"], "debt">, LineItemId>
> = {
  equity: "equity",
  minorityInterest: "minority_interest",
  cash: "cash",
  liquidInvestments: "liquid_investments",
  marketableSecuritiesNoncurrent: "marketable_securities_noncurrent",
};

/** La partida de la serie anual que alimenta cada componente de la deuda. */
export const DEBT_ITEMS: Readonly<Record<DebtComponentKey, LineItemId>> = {
  longTermTotal: "debt_long_term_total",
  longTermNoncurrent: "debt_long_term_noncurrent",
  longTermCurrent: "debt_long_term_current",
  currentTotal: "debt_current_total",
  shortTermBorrowings: "debt_short_term_borrowings",
  commercialPaper: "debt_commercial_paper",
  financeLeases: "finance_lease_liability",
};

/**
 * Los hechos de la normalización tal como la serie anual los ve al corte: el
 * ejercicio más reciente es el base. `toFact` le pone la provenance de la
 * fuente a cada partida; el concepto es el que la serie eligió.
 */
export function normalizationFactsFromSeries(
  series: AnnualFundamentals,
  toFact: (item: LineItemValue) => MonetaryFact,
  zeroDebtEvidence: ZeroDebtEvidence | null = null,
): NormalizationFacts | null {
  const base = series.fiscalYears[0];

  if (base === undefined) {
    return null;
  }

  const read = (
    items: (typeof base)["items"],
    key: LineItemId,
  ): ConceptFact | null => {
    const value = items[key];
    return value === undefined
      ? null
      : { ...toFact(value), concept: value.concept };
  };

  return {
    baseFiscalYearEnd: base.fiscalYearEnd,
    income: {
      pretaxIncome: read(base.items, "pretax_income"),
      incomeTax: read(base.items, "income_tax"),
      shareBasedCompensation: read(base.items, "share_based_compensation"),
    },
    balance: {
      ...(Object.fromEntries(
        Object.entries(BALANCE_ITEMS).map(([key, item]) => [
          key,
          read(base.items, item),
        ]),
      ) as Omit<NormalizationFacts["balance"], "debt">),
      debt: Object.fromEntries(
        DEBT_COMPONENT_KEYS.map((key) => [
          key,
          read(base.items, DEBT_ITEMS[key]),
        ]),
      ) as NormalizationFacts["balance"]["debt"],
    },
    chargeHistory: series.fiscalYears
      .slice(0, NON_RECURRING_LOOKBACK_YEARS + 1)
      .map((year) => ({
        fiscalYearEnd: year.fiscalYearEnd,
        revenue: read(year.items, "revenue"),
        restructuring: read(year.items, "restructuring_charges"),
        impairment: read(year.items, "impairment_charges"),
      })),
    ...(zeroDebtEvidence === null ? {} : { zeroDebtEvidence }),
  };
}
