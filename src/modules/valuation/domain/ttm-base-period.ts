import { z } from "zod";

import {
  calendarDaysBetween,
  subtractCalendarYears,
  subtractDays,
} from "@/modules/temporal/domain/calendar-date";
import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

import {
  LINE_ITEMS,
  type AnnualFundamentals,
  type FiscalYear,
  type FundamentalRow,
  type LineItemId,
  type LineItemValue,
} from "./annual-fundamentals";
import type { CapitalizationFacts } from "./capitalization-bridge";
import { formatDecimal, parseDecimal } from "./decimal-policy";
import { netInterestForEbit } from "./interest-expense";
import {
  DEBT_ITEMS,
  debtControlsAt,
  withDebtControls,
  type NormalizationFacts,
} from "./normalization";
import {
  DEBT_COMPONENT_KEYS,
  DEBT_CONTROL_ITEMS,
  DEBT_CONTROL_KEYS,
  resolveReportedDebt,
} from "./reported-debt";
import {
  conceptFactSchema,
  type ConceptFact,
  type MonetaryFact,
} from "./valuation-facts";

/**
 * Año base TTM (`F6-24`,
 * [ADR 0081](../../../../docs/architecture/adr/0081-ttm-base-period.md)).
 *
 * La corrida descontaba desde el último 10-K, así que con un `as_of` cerca de
 * un año después el valor quedaba un año atrás. Los flujos del año base pasan
 * a ser los doce meses móviles al cierre del último 10-Q:
 *
 *     TTM = ejercicio + acumulado del año en curso − acumulado comparable
 *
 * con el **mismo concepto** en las tres patas. El acumulado comparable empieza
 * un año antes que el actual y termina un año antes, a `TTM_PERIOD_TOLERANCE_DAYS`
 * —los ejercicios de 52/53 semanas mueven los dos bordes—, y su duración no se
 * aparta más de `TTM_DURATION_TOLERANCE_DAYS` de la del actual.
 *
 * El balance va por bloques (decisión del owner del 2026-11-17, con la tabla
 * medida): deuda, caja, patrimonio y minoritarios al cierre del trimestre si
 * la receta de deuda cierra ahí y cada partida que el 10-K tenía está; si no,
 * al cierre del 10-K. Los arrendamientos, del trimestre si publica el total o
 * sus dos partes; si no, del 10-K. Cada bloque nombra su fecha.
 *
 * Lo que sigue anual, nombrado: la historia de ventas de la tendencia, la
 * capitalización de I+D (un TTM en su calendario contaría meses dos veces),
 * la historia de cargos no recurrentes, la evidencia de deuda cero, la
 * cobertura de intereses del rating sintético y las opciones de empleados.
 *
 * Sin el acumulado comparable de una partida que el año base usa, la corrida
 * entera queda anual y nombra la partida: un margen con ventas TTM y EBIT
 * anual no es el margen de ningún período.
 */
export const TTM_BASE_PERIOD_VERSION = "ttm-base-period-1.0.0";

/** Bordes del período comparable contra el actual corrido un año. */
export const TTM_PERIOD_TOLERANCE_DAYS = 10;

/** Diferencia máxima de duración entre el acumulado actual y el comparable. */
export const TTM_DURATION_TOLERANCE_DAYS = 7;

/** La marca de un hecho derivado de tres patas. */
export const TTM_QUALITY_FLAG = "ttm";

export const ttmFlowItemSchema = z.enum([
  "revenue",
  "operating_income",
  "pretax_income",
  "income_tax",
  "share_based_compensation",
  "interest_expense",
  "interest_expense_debt",
  "finance_lease_interest_expense",
  "interest_net_nonoperating",
  "interest_paid",
]);

export type TtmFlowItem = z.infer<typeof ttmFlowItemSchema>;

/** Un acumulado: el hecho con el inicio de su duración. */
export const periodFactSchema = conceptFactSchema.extend({
  periodStart: calendarDateSchema,
});

export type PeriodFact = z.infer<typeof periodFactSchema>;

/**
 * Las tres patas de un flujo. El monto TTM no se guarda: se recalcula con
 * `ttmFlowValue`, así que uno escrito a mano no existe.
 */
export const ttmFlowSchema = z.object({
  item: ttmFlowItemSchema,
  annual: conceptFactSchema,
  currentYtd: periodFactSchema,
  priorYtd: periodFactSchema,
});

export type TtmFlow = z.infer<typeof ttmFlowSchema>;

export const coreBalanceBlockSchema = z.discriminatedUnion("basis", [
  z.object({ basis: z.literal("quarter") }),
  z.object({
    basis: z.literal("fiscal_year"),
    reason: z.enum([
      "debt_recipe_not_at_quarter",
      "balance_item_not_at_quarter",
    ]),
    item: z.string().trim().min(1).max(64).nullable(),
  }),
]);

export const leaseBalanceBlockSchema = z.discriminatedUnion("basis", [
  z.object({ basis: z.literal("quarter") }),
  z.object({
    basis: z.literal("fiscal_year"),
    reason: z.literal("lease_liability_not_at_quarter"),
  }),
]);

export const annualBasePeriodReasonSchema = z.enum([
  /** No hay un 10-Q del ejercicio en curso visible al corte. */
  "no_interim_after_fiscal_year",
  /** Una partida que el año base usa no tiene sus tres patas. */
  "ttm_leg_missing",
  /** El año anual revierte un cargo: su TTM no se puede armar igual. */
  "non_recurring_charge_applied",
  /**
   * La deuda industrial de una financiera cautiva se leyó del 10-K
   * (`F6-23`, ADR 0082): el balance del 10-Q no tiene su apertura.
   */
  "captive_finance_split",
]);

export type AnnualBasePeriodReason = z.infer<
  typeof annualBasePeriodReasonSchema
>;

export const basePeriodSchema = z.discriminatedUnion("basis", [
  z.object({
    version: z.literal(TTM_BASE_PERIOD_VERSION),
    basis: z.literal("ttm"),
    /** El cierre del 10-K desde el que rueda. */
    fiscalYearEnd: calendarDateSchema,
    /** El cierre del último 10-Q: la fecha de los flujos. */
    periodEnd: calendarDateSchema,
    flows: z.array(ttmFlowSchema).min(3).max(10),
    balance: z.object({
      core: coreBalanceBlockSchema,
      leases: leaseBalanceBlockSchema,
    }),
  }),
  z.object({
    version: z.literal(TTM_BASE_PERIOD_VERSION),
    basis: z.literal("annual"),
    fiscalYearEnd: calendarDateSchema,
    reason: annualBasePeriodReasonSchema,
    item: ttmFlowItemSchema.nullable(),
  }),
]);

export type BasePeriod = z.infer<typeof basePeriodSchema>;
export type TtmBasePeriod = Extract<BasePeriod, { basis: "ttm" }>;

/** La fecha de un bloque de balance. */
export function blockAsOf(
  basePeriod: TtmBasePeriod,
  block: "core" | "leases",
): string {
  return basePeriod.balance[block].basis === "quarter"
    ? basePeriod.periodEnd
    : basePeriod.fiscalYearEnd;
}

/** `annual + currentYtd − priorYtd`, en la política decimal del motor. */
export function ttmFlowValue(flow: TtmFlow, path = "ttm"): string {
  return formatDecimal(
    parseDecimal(flow.annual.value, `${path}.annual`)
      .plus(parseDecimal(flow.currentYtd.value, `${path}.currentYtd`))
      .minus(parseDecimal(flow.priorYtd.value, `${path}.priorYtd`)),
    path,
  );
}

/**
 * El hecho TTM que el resto del snapshot congela: el monto derivado, la fecha
 * del 10-Q, la disponibilidad de la última pata y el documento del acumulado
 * actual. No tiene observación propia: la provenance está en sus patas.
 */
export function ttmFlowFact(flow: TtmFlow, periodEnd: string): ConceptFact {
  const availableAt = [
    flow.annual.availableAt,
    flow.currentYtd.availableAt,
    flow.priorYtd.availableAt,
  ].sort((left, right) => right.localeCompare(left))[0]!;

  return {
    value: ttmFlowValue(flow, `ttm.${flow.item}`),
    currency: flow.currentYtd.currency,
    unit: "monetary",
    concept: flow.currentYtd.concept,
    asOf: periodEnd,
    availableAt,
    sourceId: flow.currentYtd.sourceId,
    sourceDocumentId: flow.currentYtd.sourceDocumentId,
    observationId: null,
    qualityFlags: [TTM_QUALITY_FLAG],
  };
}

export function flowOf(
  basePeriod: TtmBasePeriod,
  item: TtmFlowItem,
): TtmFlow | null {
  return basePeriod.flows.find((flow) => flow.item === item) ?? null;
}

const dayAfter = (date: string) => subtractDays(date, -1);

function durationDays(fact: { periodStart: string; asOf: string }): number {
  return calendarDaysBetween(fact.periodStart, fact.asOf);
}

/** ¿Empieza el acumulado actual el día siguiente al cierre del ejercicio? */
export function startsAfterFiscalYear(
  periodStart: string,
  fiscalYearEnd: string,
): boolean {
  return (
    Math.abs(calendarDaysBetween(dayAfter(fiscalYearEnd), periodStart)) <=
    TTM_PERIOD_TOLERANCE_DAYS
  );
}

/** ¿Es `prior` el mismo acumulado que `current`, un año antes? */
export function isComparablePrior(
  current: { periodStart: string; asOf: string },
  prior: { periodStart: string; asOf: string },
): boolean {
  return (
    Math.abs(
      calendarDaysBetween(
        subtractCalendarYears(current.periodStart, 1),
        prior.periodStart,
      ),
    ) <= TTM_PERIOD_TOLERANCE_DAYS &&
    Math.abs(
      calendarDaysBetween(subtractCalendarYears(current.asOf, 1), prior.asOf),
    ) <= TTM_PERIOD_TOLERANCE_DAYS &&
    Math.abs(durationDays(current) - durationDays(prior)) <=
      TTM_DURATION_TOLERANCE_DAYS
  );
}

const isInterim = (row: FundamentalRow) =>
  row.periodType === "quarter" || row.periodType === "year_to_date";

/** Las partidas de flujo que el año base anual usa, en orden fijo. */
export function requiredTtmItems(base: FiscalYear): readonly TtmFlowItem[] {
  const items: TtmFlowItem[] = ["revenue"];

  if (base.items.operating_income !== undefined) {
    items.push("operating_income");
  }

  items.push("pretax_income", "income_tax");

  if (base.items.operating_income === undefined) {
    for (const input of netInterestForEbit(base)?.inputs ?? []) {
      items.push(ttmFlowItemSchema.parse(input.item));
    }
  }

  if (base.items.share_based_compensation !== undefined) {
    items.push("share_based_compensation");
  }

  return items;
}

/** Partidas de balance del bloque principal, sin la deuda. */
const CORE_BALANCE_ITEMS: readonly LineItemId[] = [
  "equity",
  "minority_interest",
  "cash",
  "liquid_investments",
  "marketable_securities_noncurrent",
];

const LEASE_ITEMS: readonly LineItemId[] = [
  "operating_lease_liability",
  "operating_lease_liability_current",
  "operating_lease_liability_noncurrent",
];

/**
 * Los saldos de un cierre con la misma regla que la serie anual: la primera
 * alternativa declarada que el filer publicó en esa fecha.
 */
export function instantItemsAt(
  rows: readonly FundamentalRow[],
  date: string,
  items: readonly LineItemId[],
): Partial<Record<LineItemId, LineItemValue>> {
  const usable = rows
    .filter(
      (row) =>
        row.value !== null && row.periodType === "instant" && row.asOf === date,
    )
    .sort(
      (left, right) =>
        right.availableAt.localeCompare(left.availableAt) ||
        left.observationId.localeCompare(right.observationId),
    );
  const result: Partial<Record<LineItemId, LineItemValue>> = {};

  for (const item of items) {
    const definition = LINE_ITEMS.find((entry) => entry.item === item)!;

    for (const concept of definition.concepts) {
      const match = usable.find((row) => row.concept === concept);

      if (match !== undefined) {
        result[item] = {
          item,
          concept,
          value: match.value!,
          unit: match.unit,
          currency: match.currency,
          asOf: match.asOf,
          observationId: match.observationId,
          availableAt: match.availableAt,
          recordedAt: match.recordedAt,
          sourceDocumentId: match.sourceDocumentId,
        };
        break;
      }
    }
  }

  return result;
}

export type TtmBasePeriodCandidate =
  | {
      readonly status: "ttm";
      readonly basePeriod: TtmBasePeriod;
      /** Saldos del trimestre de cada bloque que va al trimestre. */
      readonly quarter: Partial<Record<LineItemId, LineItemValue>>;
    }
  | {
      readonly status: "annual";
      readonly basePeriod: Extract<BasePeriod, { basis: "annual" }>;
    };

/**
 * Decide la base del año base con las filas que la consulta eligió al corte.
 * `toFact` le pone la provenance de la fuente a una partida; los acumulados
 * se congelan con su inicio. `null` sin ejercicio base o sin ventas.
 */
export function buildTtmBasePeriod(input: {
  readonly rows: readonly FundamentalRow[];
  readonly series: AnnualFundamentals;
  readonly cutoffDate: string;
  readonly toFact: (item: LineItemValue) => ConceptFact;
}): TtmBasePeriodCandidate | null {
  const base = input.series.fiscalYears[0];
  const revenue = base?.items.revenue;

  if (base === undefined || revenue === undefined) {
    return null;
  }

  const fiscalYearEnd = base.fiscalYearEnd;
  const annual = (
    reason: AnnualBasePeriodReason,
    item: TtmFlowItem | null,
  ): TtmBasePeriodCandidate => ({
    status: "annual",
    basePeriod: {
      version: TTM_BASE_PERIOD_VERSION,
      basis: "annual",
      fiscalYearEnd,
      reason,
      item,
    },
  });
  const interim = input.rows.filter(
    (row) =>
      row.value !== null &&
      row.periodStart !== null &&
      isInterim(row) &&
      row.asOf > fiscalYearEnd &&
      row.asOf <= input.cutoffDate &&
      startsAfterFiscalYear(row.periodStart, fiscalYearEnd),
  );
  const periodEnd = interim
    .filter((row) => row.concept === revenue.concept)
    .map((row) => row.asOf)
    .sort()
    .at(-1);

  if (periodEnd === undefined) {
    return annual("no_interim_after_fiscal_year", null);
  }

  // Gana la vista publicada última; a igual publicación, el ID ordena.
  const latestFirst = (left: FundamentalRow, right: FundamentalRow) =>
    right.availableAt.localeCompare(left.availableAt) ||
    left.observationId.localeCompare(right.observationId);
  const periodFact = (row: FundamentalRow): PeriodFact => ({
    ...input.toFact({
      item: "revenue",
      concept: row.concept,
      value: row.value!,
      unit: row.unit,
      currency: row.currency,
      asOf: row.asOf,
      observationId: row.observationId,
      availableAt: row.availableAt,
      recordedAt: row.recordedAt,
      sourceDocumentId: row.sourceDocumentId,
    }),
    periodStart: row.periodStart!,
  });
  const flows: TtmFlow[] = [];

  for (const item of requiredTtmItems(base)) {
    const annualItem = base.items[item];

    // El ejercicio mismo puede no traer la partida (MCD, 2026-11-18): sin la
    // pata anual no hay TTM, y se dice cuál falta en vez de leer `undefined`.
    if (annualItem === undefined) {
      return annual("ttm_leg_missing", item);
    }

    const current = interim
      .filter(
        (row) => row.concept === annualItem.concept && row.asOf === periodEnd,
      )
      .sort(latestFirst)[0];
    const prior =
      current === undefined
        ? undefined
        : input.rows
            .filter(
              (row) =>
                row.value !== null &&
                row.periodStart !== null &&
                isInterim(row) &&
                row.concept === annualItem.concept &&
                isComparablePrior(
                  { periodStart: current.periodStart!, asOf: current.asOf },
                  { periodStart: row.periodStart, asOf: row.asOf },
                ),
            )
            .sort(latestFirst)[0];

    if (
      current === undefined ||
      prior === undefined ||
      current.currency !== annualItem.currency ||
      prior.currency !== annualItem.currency ||
      current.unit !== annualItem.unit ||
      prior.unit !== annualItem.unit
    ) {
      return annual("ttm_leg_missing", item);
    }

    flows.push({
      item,
      annual: input.toFact(annualItem),
      currentYtd: periodFact(current),
      priorYtd: periodFact(prior),
    });
  }

  const debtItems = [
    ...DEBT_COMPONENT_KEYS.map((key) => DEBT_ITEMS[key]),
    // Los totales publicados corroboran `reported-debt-1.3.0` (`F6-46`).
    ...DEBT_CONTROL_KEYS.map((key) => DEBT_CONTROL_ITEMS[key]),
  ];
  const quarter = instantItemsAt(input.rows, periodEnd, [
    ...CORE_BALANCE_ITEMS,
    ...debtItems,
    ...LEASE_ITEMS,
  ]);
  const missingCore = CORE_BALANCE_ITEMS.find(
    (item) => base.items[item] !== undefined && quarter[item] === undefined,
  );
  const debtAt = (items: typeof quarter) =>
    resolveReportedDebt(
      Object.fromEntries(
        DEBT_COMPONENT_KEYS.map((key) => {
          const value = items[DEBT_ITEMS[key]];
          return [
            key,
            value === undefined
              ? null
              : { value: value.value, concept: value.concept },
          ];
        }),
      ) as Parameters<typeof resolveReportedDebt>[0],
      null,
      Object.fromEntries(
        DEBT_CONTROL_KEYS.map((key) => {
          const value = items[DEBT_CONTROL_ITEMS[key]];
          return [
            key,
            value === undefined
              ? null
              : { value: value.value, concept: value.concept },
          ];
        }),
      ) as Parameters<typeof resolveReportedDebt>[2],
    );
  const quarterDebt = debtAt(quarter);
  // `noncurrent_only` (`reported-debt-1.2.0`) confía en que el filer nunca
  // publica porción corriente: si el 10-K sí la tenía, un 10-Q que no la
  // etiqueta no la hace desaparecer.
  const quarterDebtCloses =
    quarterDebt.status === "resolved" &&
    (quarterDebt.recipe !== "noncurrent_only" ||
      (() => {
        const annual = debtAt(base.items);
        return (
          annual.status === "resolved" && annual.recipe === "noncurrent_only"
        );
      })());
  const core =
    missingCore !== undefined
      ? {
          basis: "fiscal_year" as const,
          reason: "balance_item_not_at_quarter" as const,
          item: missingCore,
        }
      : !quarterDebtCloses
        ? {
            basis: "fiscal_year" as const,
            reason: "debt_recipe_not_at_quarter" as const,
            item: null,
          }
        : { basis: "quarter" as const };
  const leasesAtQuarter =
    quarter.operating_lease_liability !== undefined ||
    (quarter.operating_lease_liability_current !== undefined &&
      quarter.operating_lease_liability_noncurrent !== undefined);
  const leases = leasesAtQuarter
    ? { basis: "quarter" as const }
    : {
        basis: "fiscal_year" as const,
        reason: "lease_liability_not_at_quarter" as const,
      };
  const kept: Partial<Record<LineItemId, LineItemValue>> = {};

  for (const [item, value] of Object.entries(quarter) as [
    LineItemId,
    LineItemValue,
  ][]) {
    const inLeases = LEASE_ITEMS.includes(item);

    if (
      (inLeases && leases.basis === "quarter") ||
      (!inLeases && core.basis === "quarter")
    ) {
      kept[item] = value;
    }
  }

  return {
    status: "ttm",
    basePeriod: basePeriodSchema.parse({
      version: TTM_BASE_PERIOD_VERSION,
      basis: "ttm",
      fiscalYearEnd,
      periodEnd,
      flows,
      balance: { core, leases },
    }) as TtmBasePeriod,
    quarter: kept,
  };
}

/**
 * Lo que no cierra en un año base TTM congelado, como rutas de campo: cada
 * flujo con sus tres patas del mismo concepto, moneda y período. Que el resto
 * del snapshot use exactamente estos hechos lo verifica `policy-checks`.
 */
export function ttmBasePeriodMismatches(basePeriod: TtmBasePeriod): string[] {
  const mismatches: string[] = [];
  const seen = new Set<TtmFlowItem>();

  if (basePeriod.periodEnd <= basePeriod.fiscalYearEnd) {
    mismatches.push("basePeriod.periodEnd");
  }

  basePeriod.flows.forEach((flow, index) => {
    const path = `basePeriod.flows.${index}`;
    const { annual, currentYtd, priorYtd } = flow;

    if (seen.has(flow.item)) {
      mismatches.push(`${path}.item`);
    }

    seen.add(flow.item);

    if (
      annual.concept !== currentYtd.concept ||
      annual.concept !== priorYtd.concept ||
      annual.currency !== currentYtd.currency ||
      annual.currency !== priorYtd.currency
    ) {
      mismatches.push(path);
    }

    if (annual.asOf !== basePeriod.fiscalYearEnd) {
      mismatches.push(`${path}.annual`);
    }

    if (
      currentYtd.asOf !== basePeriod.periodEnd ||
      !startsAfterFiscalYear(currentYtd.periodStart, basePeriod.fiscalYearEnd)
    ) {
      mismatches.push(`${path}.currentYtd`);
    }

    if (!isComparablePrior(currentYtd, priorYtd)) {
      mismatches.push(`${path}.priorYtd`);
    }
  });

  for (const item of ["revenue", "pretax_income", "income_tax"] as const) {
    if (!seen.has(item)) {
      mismatches.push(`basePeriod.flows.${item}`);
    }
  }

  return mismatches;
}

/**
 * Los hechos de la capitalización en un año base TTM, sobre los anuales: el
 * EBIT (publicado o derivado) del TTM, los arrendamientos del cierre de su
 * bloque y la I+D en ejercicios desde el 10-K.
 */
export function ttmCapitalizationFacts(
  annual: CapitalizationFacts,
  candidate: Extract<TtmBasePeriodCandidate, { status: "ttm" }>,
  toFact: (item: LineItemValue) => ConceptFact,
): CapitalizationFacts {
  const { basePeriod, quarter } = candidate;
  const { periodEnd } = basePeriod;
  const flowFact = (item: TtmFlowItem) => {
    const flow = flowOf(basePeriod, item);
    return flow === null ? null : ttmFlowFact(flow, periodEnd);
  };
  const monetary = (fact: ConceptFact | null): MonetaryFact | null => {
    if (fact === null) {
      return null;
    }

    const { concept: _concept, ...rest } = fact;
    void _concept;
    return rest;
  };
  const leaseFact = (item: LineItemId) => {
    const value = quarter[item];
    return value === undefined ? null : monetary(toFact(value));
  };
  const derivation = annual.ebitDerivation;

  return {
    baseFiscalYearEnd: periodEnd,
    basePeriod: {
      fiscalYearEnd: basePeriod.fiscalYearEnd,
      leasesAsOf: blockAsOf(basePeriod, "leases"),
    },
    reportedEbit:
      annual.reportedEbit === null
        ? null
        : monetary(flowFact("operating_income")),
    ...(derivation === undefined
      ? {}
      : {
          ebitDerivation: {
            version: derivation.version,
            pretaxIncome: flowFact("pretax_income")!,
            interest: {
              basis: derivation.interest.basis,
              facts: derivation.interest.facts.map((fact) => {
                const flow = basePeriod.flows.find(
                  (candidateFlow) =>
                    candidateFlow.annual.concept === fact.concept &&
                    candidateFlow.item !== "pretax_income",
                )!;
                return ttmFlowFact(flow, periodEnd);
              }),
            },
          },
        }),
    leases:
      basePeriod.balance.leases.basis === "quarter"
        ? {
            totalLiability: leaseFact("operating_lease_liability"),
            currentLiability: leaseFact("operating_lease_liability_current"),
            noncurrentLiability: leaseFact(
              "operating_lease_liability_noncurrent",
            ),
          }
        : annual.leases,
    researchAndDevelopment: annual.researchAndDevelopment,
  };
}

/**
 * Los hechos de la normalización en un año base TTM, sobre los anuales: los
 * resultados del TTM, el balance del cierre de su bloque y la historia de
 * cargos en ejercicios. La evidencia de deuda cero sólo con el balance del
 * 10-K: se prueba en ejercicios.
 */
export function ttmNormalizationFacts(
  annual: NormalizationFacts,
  candidate: Extract<TtmBasePeriodCandidate, { status: "ttm" }>,
  toFact: (item: LineItemValue) => ConceptFact,
): NormalizationFacts {
  const { basePeriod, quarter } = candidate;
  const { periodEnd } = basePeriod;
  const flowFact = (item: TtmFlowItem) => {
    const flow = flowOf(basePeriod, item);
    return flow === null ? null : ttmFlowFact(flow, periodEnd);
  };
  const quarterFact = (item: LineItemId) => {
    const value = quarter[item];
    return value === undefined ? null : toFact(value);
  };
  const atQuarter = basePeriod.balance.core.basis === "quarter";
  const { zeroDebtEvidence, debtControls, ...rest } = annual;

  const facts: NormalizationFacts = {
    ...rest,
    baseFiscalYearEnd: periodEnd,
    income: {
      pretaxIncome: flowFact("pretax_income"),
      incomeTax: flowFact("income_tax"),
      shareBasedCompensation: flowFact("share_based_compensation"),
    },
    balance: atQuarter
      ? {
          equity: quarterFact("equity"),
          minorityInterest: quarterFact("minority_interest"),
          cash: quarterFact("cash"),
          liquidInvestments: quarterFact("liquid_investments"),
          marketableSecuritiesNoncurrent: quarterFact(
            "marketable_securities_noncurrent",
          ),
          debt: Object.fromEntries(
            DEBT_COMPONENT_KEYS.map((key) => [
              key,
              quarterFact(DEBT_ITEMS[key]),
            ]),
          ) as NormalizationFacts["balance"]["debt"],
        }
      : annual.balance,
    ...(zeroDebtEvidence === undefined || atQuarter
      ? {}
      : { zeroDebtEvidence }),
    // Con el balance del 10-K, los totales del 10-K; con el del 10-Q, los
    // suyos, y sólo si su deuda los necesita (`F6-46`).
    ...(debtControls === undefined || atQuarter ? {} : { debtControls }),
    basePeriod: {
      fiscalYearEnd: basePeriod.fiscalYearEnd,
      balanceAsOf: blockAsOf(basePeriod, "core"),
    },
  };

  return atQuarter
    ? withDebtControls(
        facts,
        debtControlsAt(quarter, (items, key) => {
          const value = items[key];
          return value === undefined ? null : toFact(value);
        }),
      )
    : facts;
}
