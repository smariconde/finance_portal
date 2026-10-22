import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

import type {
  AnnualFundamentals,
  LineItemId,
  LineItemValue,
} from "./annual-fundamentals";
import {
  divide,
  engineDecimalSchema,
  formatDecimal,
  parseDecimal,
  sum,
  ZERO,
  type Dec,
} from "./decimal-policy";
import {
  capitalizeOperatingLeases,
  LEASE_CAPITALIZATION_VERSION,
  type LeaseCapitalization,
} from "./lease-capitalization";
import {
  capitalizeResearchAndDevelopment,
  RD_CAPITALIZATION_VERSION,
  type RdCapitalization,
} from "./rd-capitalization";
import { RD_AMORTIZABLE_LIFE_VERSION } from "./rd-amortizable-life";
import {
  ebitWithInterest,
  freezeInterest,
  frozenInterestSchema,
  frozenInterestValue,
} from "./interest-expense";
import {
  conceptFactSchema,
  monetaryFactSchema,
  type MonetaryFact,
} from "./valuation-facts";

/**
 * El puente de la capitalización en la corrida (`F4-01`,
 * [ADR 0037](../../../../docs/architecture/adr/0037-lease-rd-capitalization.md),
 * decisión 4).
 *
 * Lleva los hechos con su provenance —el EBIT reportado del ejercicio base, el
 * pasivo por arrendamientos y la I+D de cada ejercicio— y lo que las dos reglas
 * derivan de ellos, con el puente de EBIT, capital invertido y deuda. El motor
 * lo **recalcula**: un número escrito a mano no pasa el check, igual que un WACC
 * crudo.
 *
 * El capital invertido se publica como delta: el reportado es normalización de
 * `F4-03`, y un total armado acá sería una definición sin versión. El margen y
 * la reinversión siguen siendo supuestos; el margen EBIT ajustado del ejercicio
 * base viaja al lado para que la base de esos supuestos sea visible.
 */
export const CAPITALIZATION_BRIDGE_VERSION = "capitalization-bridge-1.0.0";

/**
 * El EBIT de quien no publica resultado operativo (`F6-15`,
 * [ADR 0054](../../../../docs/architecture/adr/0054-zero-debt-evidence-derived-ebit.md)):
 * el resultado antes de impuestos más los intereses de `netInterestForEbit`,
 * con los hechos y la base congelados. ADP, Merck, Eaton y Nike no publican
 * `OperatingIncomeLoss`. Sólo viaja cuando se usa: una corrida con resultado
 * operativo queda igual byte por byte.
 */
export const EBIT_FROM_PRETAX_VERSION = "ebit-from-pretax-1.0.0";

export const ebitDerivationSchema = z.object({
  version: z.literal(EBIT_FROM_PRETAX_VERSION),
  pretaxIncome: conceptFactSchema,
  interest: frozenInterestSchema,
});

export type EbitDerivation = z.infer<typeof ebitDerivationSchema>;

const amount = engineDecimalSchema;

const rdLifeSchema = z.object({
  years: z.number().int().min(2).max(10),
  lookupRow: z.string().trim().min(1).max(64),
});

export const leaseCapitalizationSchema = z.discriminatedUnion("status", [
  z.object({
    version: z.literal(LEASE_CAPITALIZATION_VERSION),
    status: z.literal("capitalized"),
    liabilityBasis: z.enum(["reported_total", "sum_of_parts"]),
    leaseDebt: amount,
    preTaxCostOfDebt: amount,
    imputedInterest: amount,
    ebitAdjustment: amount,
    investedCapitalAdjustment: amount,
    debtAdjustment: amount,
  }),
  z.object({
    version: z.literal(LEASE_CAPITALIZATION_VERSION),
    status: z.literal("not_capitalized"),
    reason: z.enum([
      "lease_liability_missing",
      "lease_liability_partial",
      "lease_liability_negative",
      "cost_of_debt_missing",
    ]),
  }),
]);

export const rdCapitalizationSchema = z.discriminatedUnion("status", [
  z.object({
    version: z.literal(RD_CAPITALIZATION_VERSION),
    status: z.literal("capitalized"),
    life: rdLifeSchema,
    materialityThreshold: amount,
    rdToRevenue: amount,
    baseYearRd: amount,
    schedule: z
      .array(
        z.object({
          offset: z.number().int().min(0).max(10),
          fiscalYearEnd: calendarDateSchema,
          amount,
          unamortizedShare: amount,
          unamortized: amount,
          amortizationThisYear: amount,
        }),
      )
      .min(3)
      .max(11),
    researchAsset: amount,
    amortization: amount,
    ebitAdjustment: amount,
    investedCapitalAdjustment: amount,
    netReinvestment: amount,
  }),
  z.object({
    version: z.literal(RD_CAPITALIZATION_VERSION),
    status: z.literal("not_capitalized"),
    reason: z.enum([
      "not_reported",
      "rd_negative",
      "industry_unassigned",
      "life_not_declared",
      "revenue_unavailable",
      "immaterial",
      "insufficient_history",
    ]),
    life: rdLifeSchema.nullable(),
    rdToRevenue: amount.nullable(),
    fiscalYearsAvailable: z.number().int().min(0).max(16),
  }),
]);

const capitalizationLedgerSchema = z.object({
  /** `null` cuando el EBIT del ejercicio base no está publicado ni derivado. */
  ebit: z.object({
    /** Ausente es el resultado operativo publicado. */
    basis: z.literal("pretax_plus_interest").optional(),
    reported: amount.nullable(),
    leaseAdjustment: amount,
    rdAdjustment: amount,
    adjusted: amount.nullable(),
    adjustedMargin: amount.nullable(),
  }),
  investedCapitalDelta: z.object({
    leases: amount,
    researchAndDevelopment: amount,
    total: amount,
  }),
  debtDelta: z.object({ leases: amount }),
});

export const capitalizationSchema = z.object({
  version: z.literal(CAPITALIZATION_BRIDGE_VERSION),
  lifeTableVersion: z.literal(RD_AMORTIZABLE_LIFE_VERSION),
  baseFiscalYearEnd: calendarDateSchema,
  reportedEbit: monetaryFactSchema.nullable(),
  /** Sólo sin `reportedEbit`: de dónde sale el EBIT del puente. */
  ebitDerivation: ebitDerivationSchema.optional(),
  leases: z.object({
    totalLiability: monetaryFactSchema.nullable(),
    currentLiability: monetaryFactSchema.nullable(),
    noncurrentLiability: monetaryFactSchema.nullable(),
    result: leaseCapitalizationSchema,
  }),
  researchAndDevelopment: z.object({
    fiscalYears: z
      .array(
        z.object({
          fiscalYearEnd: calendarDateSchema,
          amount: monetaryFactSchema.nullable(),
        }),
      )
      .max(16),
    result: rdCapitalizationSchema,
  }),
  ledger: capitalizationLedgerSchema,
});

export type Capitalization = z.infer<typeof capitalizationSchema>;

export type CapitalizationFacts = Pick<
  Capitalization,
  "baseFiscalYearEnd" | "reportedEbit" | "ebitDerivation"
> & {
  readonly leases: Pick<
    Capitalization["leases"],
    "totalLiability" | "currentLiability" | "noncurrentLiability"
  >;
  readonly researchAndDevelopment: Pick<
    Capitalization["researchAndDevelopment"],
    "fiscalYears"
  >;
};

export type CapitalizationContext = {
  /** Ventas del ejercicio base: `ValuationInput.baseRevenue`. */
  readonly baseRevenue: string;
  /** `costOfCapital.industryKey`: la industria que fija la vida. */
  readonly industryKey: string | null;
  /** `costOfCapital.derived.preTaxCostOfDebt`. */
  readonly preTaxCostOfDebt: string | null;
};

const valueOf = (fact: MonetaryFact | null) =>
  fact === null ? null : fact.value;

/** El EBIT del ejercicio base: el publicado o el derivado. */
function baseEbit(
  facts: Pick<CapitalizationFacts, "reportedEbit" | "ebitDerivation">,
): Dec | null {
  if (facts.reportedEbit !== null) {
    return parseDecimal(
      facts.reportedEbit.value,
      "capitalization.reportedEbit",
    );
  }

  const derivation = facts.ebitDerivation;

  return derivation === undefined
    ? null
    : parseDecimal(
        derivation.pretaxIncome.value,
        "capitalization.ebitDerivation.pretaxIncome",
      ).plus(frozenInterestValue(derivation.interest));
}

function buildLedger(
  facts: Pick<CapitalizationFacts, "reportedEbit" | "ebitDerivation">,
  baseRevenue: string,
  leases: LeaseCapitalization,
  rd: RdCapitalization,
): Capitalization["ledger"] {
  const decimal = (value: string, path: string): Dec =>
    parseDecimal(value, path);
  const leaseEbit =
    leases.status === "capitalized"
      ? decimal(leases.ebitAdjustment, "lease.ebitAdjustment")
      : ZERO;
  const leaseCapital =
    leases.status === "capitalized"
      ? decimal(leases.investedCapitalAdjustment, "lease.capital")
      : ZERO;
  const leaseDebt =
    leases.status === "capitalized"
      ? decimal(leases.debtAdjustment, "lease.debt")
      : ZERO;
  const rdEbit =
    rd.status === "capitalized"
      ? decimal(rd.ebitAdjustment, "rd.ebitAdjustment")
      : ZERO;
  const rdCapital =
    rd.status === "capitalized"
      ? decimal(rd.investedCapitalAdjustment, "rd.capital")
      : ZERO;

  const reported = baseEbit(facts);
  const adjusted =
    reported === null ? null : sum([reported, leaseEbit, rdEbit]);
  const revenue = decimal(baseRevenue, "baseRevenue.value");

  return {
    ebit: {
      ...(facts.reportedEbit === null && facts.ebitDerivation !== undefined
        ? { basis: "pretax_plus_interest" as const }
        : {}),
      reported:
        reported === null ? null : formatDecimal(reported, "ebit.reported"),
      leaseAdjustment: formatDecimal(leaseEbit, "ebit.leaseAdjustment"),
      rdAdjustment: formatDecimal(rdEbit, "ebit.rdAdjustment"),
      adjusted:
        adjusted === null ? null : formatDecimal(adjusted, "ebit.adjusted"),
      adjustedMargin:
        adjusted === null || !revenue.greaterThan(ZERO)
          ? null
          : formatDecimal(
              divide(adjusted, revenue, "baseRevenue.value"),
              "ebit.adjustedMargin",
            ),
    },
    investedCapitalDelta: {
      leases: formatDecimal(leaseCapital, "capital.leases"),
      researchAndDevelopment: formatDecimal(rdCapital, "capital.rd"),
      total: formatDecimal(leaseCapital.plus(rdCapital), "capital.total"),
    },
    debtDelta: { leases: formatDecimal(leaseDebt, "debt.leases") },
  };
}

/** Aplica las dos reglas a los hechos y arma el puente. Pura. */
export function buildCapitalization(
  facts: CapitalizationFacts,
  context: CapitalizationContext,
): Capitalization {
  const leases = capitalizeOperatingLeases({
    totalLiability: valueOf(facts.leases.totalLiability),
    currentLiability: valueOf(facts.leases.currentLiability),
    noncurrentLiability: valueOf(facts.leases.noncurrentLiability),
    preTaxCostOfDebt: context.preTaxCostOfDebt,
  });
  const rd = capitalizeResearchAndDevelopment({
    fiscalYears: facts.researchAndDevelopment.fiscalYears.map((year) => ({
      fiscalYearEnd: year.fiscalYearEnd,
      amount: valueOf(year.amount),
    })),
    baseRevenue: context.baseRevenue,
    industryKey: context.industryKey,
  });

  return capitalizationSchema.parse({
    version: CAPITALIZATION_BRIDGE_VERSION,
    lifeTableVersion: RD_AMORTIZABLE_LIFE_VERSION,
    baseFiscalYearEnd: facts.baseFiscalYearEnd,
    reportedEbit: facts.reportedEbit,
    ...(facts.ebitDerivation === undefined
      ? {}
      : { ebitDerivation: facts.ebitDerivation }),
    leases: { ...facts.leases, result: leases },
    researchAndDevelopment: {
      fiscalYears: facts.researchAndDevelopment.fiscalYears,
      result: rd,
    },
    ledger: buildLedger(facts, context.baseRevenue, leases, rd),
  });
}

/**
 * Lo que no cierra entre la capitalización guardada y la que sus hechos
 * derivan, como rutas de campo (`TM-02`). Vacío es un puente coherente.
 */
export function capitalizationMismatches(
  capitalization: Capitalization,
  context: CapitalizationContext,
): string[] {
  const mismatches: string[] = [];
  const base = capitalization.baseFiscalYearEnd;

  // Todo hecho del ejercicio base es de ese mismo cierre: un pasivo de otro
  // balance no es la deuda de este EBIT.
  const datedFacts: [string, MonetaryFact | null][] = [
    ["capitalization.reportedEbit", capitalization.reportedEbit],
    [
      "capitalization.leases.totalLiability",
      capitalization.leases.totalLiability,
    ],
    [
      "capitalization.leases.currentLiability",
      capitalization.leases.currentLiability,
    ],
    [
      "capitalization.leases.noncurrentLiability",
      capitalization.leases.noncurrentLiability,
    ],
  ];

  for (const [path, fact] of [
    ...datedFacts,
    ...ebitDerivationFacts(capitalization),
  ]) {
    if (fact !== null && fact.asOf !== base) {
      mismatches.push(path);
    }
  }

  // Un EBIT por puente: el derivado existe sólo donde no hay publicado.
  if (
    capitalization.ebitDerivation !== undefined &&
    capitalization.reportedEbit !== null
  ) {
    mismatches.push("capitalization.ebitDerivation");
  }

  capitalization.researchAndDevelopment.fiscalYears.forEach((year, index) => {
    if (year.amount !== null && year.amount.asOf !== year.fiscalYearEnd) {
      mismatches.push(
        `capitalization.researchAndDevelopment.fiscalYears.${index}`,
      );
    }
  });

  if (
    capitalization.researchAndDevelopment.fiscalYears[0]?.fiscalYearEnd !==
      base &&
    capitalization.researchAndDevelopment.fiscalYears.length > 0
  ) {
    mismatches.push("capitalization.researchAndDevelopment.fiscalYears.0");
  }

  const rebuilt = buildCapitalization(capitalization, context);

  if (
    computeContentHash(rebuilt.leases.result) !==
    computeContentHash(capitalization.leases.result)
  ) {
    mismatches.push("capitalization.leases.result");
  }

  if (
    computeContentHash(rebuilt.researchAndDevelopment.result) !==
    computeContentHash(capitalization.researchAndDevelopment.result)
  ) {
    mismatches.push("capitalization.researchAndDevelopment.result");
  }

  if (
    computeContentHash(rebuilt.ledger) !==
    computeContentHash(capitalization.ledger)
  ) {
    mismatches.push("capitalization.ledger");
  }

  return mismatches;
}

function ebitDerivationFacts(
  capitalization: Pick<Capitalization, "ebitDerivation">,
): [string, MonetaryFact][] {
  const derivation = capitalization.ebitDerivation;

  return derivation === undefined
    ? []
    : [
        ["capitalization.ebitDerivation.pretaxIncome", derivation.pretaxIncome],
        ...derivation.interest.facts.map(
          (fact, index): [string, MonetaryFact] => [
            `capitalization.ebitDerivation.interest.facts.${index}`,
            fact,
          ],
        ),
      ];
}

/** Los hechos monetarios de la capitalización con su ruta, para los checks. */
export function listCapitalizationFacts(
  capitalization: Capitalization,
): readonly { path: string; fact: MonetaryFact }[] {
  const facts: { path: string; fact: MonetaryFact | null }[] = [
    {
      path: "capitalization.reportedEbit",
      fact: capitalization.reportedEbit,
    },
    ...ebitDerivationFacts(capitalization).map(([path, fact]) => ({
      path,
      fact,
    })),
    {
      path: "capitalization.leases.totalLiability",
      fact: capitalization.leases.totalLiability,
    },
    {
      path: "capitalization.leases.currentLiability",
      fact: capitalization.leases.currentLiability,
    },
    {
      path: "capitalization.leases.noncurrentLiability",
      fact: capitalization.leases.noncurrentLiability,
    },
    ...capitalization.researchAndDevelopment.fiscalYears.map((year, index) => ({
      path: `capitalization.researchAndDevelopment.fiscalYears.${index}.amount`,
      fact: year.amount,
    })),
  ];

  return facts.filter(
    (entry): entry is { path: string; fact: MonetaryFact } =>
      entry.fact !== null,
  );
}

/**
 * Los hechos de la capitalización tal como la serie anual los ve al corte: el
 * ejercicio más reciente es el base, y cada ejercicio aporta su I+D o `null`.
 * `toFact` le pone la provenance de la fuente a cada partida.
 */
export function capitalizationFactsFromSeries(
  series: AnnualFundamentals,
  toFact: (item: LineItemValue) => MonetaryFact,
): CapitalizationFacts | null {
  const base = series.fiscalYears[0];

  if (base === undefined) {
    return null;
  }

  const item = (key: LineItemId) => {
    const value = base.items[key];
    return value === undefined ? null : toFact(value);
  };

  const derived =
    base.items.operating_income === undefined ? ebitWithInterest(base) : null;
  const toConceptFact = (value: LineItemValue) => ({
    ...toFact(value),
    concept: value.concept,
  });

  return {
    baseFiscalYearEnd: base.fiscalYearEnd,
    reportedEbit: item("operating_income"),
    ...(derived === null || derived.interest === null
      ? {}
      : {
          ebitDerivation: {
            version: EBIT_FROM_PRETAX_VERSION,
            pretaxIncome: toConceptFact(derived.ebit.inputs[0]!),
            interest: freezeInterest(derived.interest, toConceptFact),
          },
        }),
    leases: {
      totalLiability: item("operating_lease_liability"),
      currentLiability: item("operating_lease_liability_current"),
      noncurrentLiability: item("operating_lease_liability_noncurrent"),
    },
    researchAndDevelopment: {
      fiscalYears: series.fiscalYears.slice(0, 16).map((year) => ({
        fiscalYearEnd: year.fiscalYearEnd,
        amount:
          year.items.research_development === undefined
            ? null
            : toFact(year.items.research_development),
      })),
    },
  };
}
