import type {
  AnnualFundamentals,
  FiscalYear,
  LineItemId,
  LineItemValue,
} from "./annual-fundamentals";
import {
  divide,
  formatDecimal,
  ONE,
  parseDecimal,
  sum,
  ZERO,
  type Dec,
} from "./decimal-policy";
import { ebitOf } from "./interest-expense";
import { DEBT_ITEMS } from "./normalization";
import {
  DEBT_COMPONENT_KEYS,
  resolveReportedDebt,
  type ReportedDebtInput,
} from "./reported-debt";

/**
 * Cómo viene la empresa (`F6-17`): seis lecturas por ejercicio, tal como la
 * SEC las publicó y como la serie anual las ve al corte de la corrida.
 *
 * Es una lectura **reportada**, no la base ajustada de la corrida: no
 * capitaliza arrendamientos ni I+D, no revierte cargos no recurrentes y no
 * resta opciones. Las acciones y el EPS están en la base de splits vigente al
 * corte, porque así los entrega el lector del linaje.
 *
 * Ningún faltante es cero: una partida que no se publicó deja la lectura nula
 * con su motivo, y una tasa compuesta sólo existe entre extremos positivos.
 */
export const COMPANY_TRAJECTORY_VERSION = "company-trajectory-1.0.0";

export type TrajectoryNullReason =
  /** Falta alguna partida que la fórmula necesita. */
  | "not_reported"
  /** Las partidas no comparten moneda. */
  | "currency_mismatch"
  /** Ventas cero o negativas: un margen sobre ellas no significa nada. */
  | "non_positive_revenue"
  /** Acciones cero o negativas: no hay ganancia por acción. */
  | "non_positive_shares"
  /** Ninguna receta de `reported-debt` cierra la deuda del ejercicio. */
  | "debt_unresolved";

export type TrajectoryValue =
  | { readonly status: "value"; readonly value: string }
  | { readonly status: "null"; readonly reason: TrajectoryNullReason };

export type TrajectoryYear = {
  readonly fiscalYearEnd: string;
  readonly revenue: TrajectoryValue;
  /** Contra el ejercicio anterior de la serie; nulo en el primero. */
  readonly revenueGrowth: TrajectoryValue | null;
  readonly operatingMargin: TrajectoryValue;
  /** Ganancia neta ÷ acciones diluidas promedio del ejercicio. */
  readonly dilutedEps: TrajectoryValue;
  /** Flujo operativo − compras de propiedad, planta y equipo. */
  readonly freeCashFlow: TrajectoryValue;
  /** Caja e inversiones líquidas − deuda financiera; negativo es deuda neta. */
  readonly netCash: TrajectoryValue;
  readonly dilutedShares: TrajectoryValue;
};

export type TrajectoryChange =
  | {
      readonly status: "value";
      readonly value: string;
      readonly fromFiscalYearEnd: string;
      readonly toFiscalYearEnd: string;
      /** Ejercicios entre los extremos. */
      readonly years: number;
    }
  | {
      readonly status: "null";
      readonly reason:
        | "insufficient_years"
        /** Una tasa compuesta exige extremos estrictamente positivos. */
        | "non_positive_endpoint";
    };

export type CompanyTrajectory = {
  readonly version: typeof COMPANY_TRAJECTORY_VERSION;
  /** La moneda de las ventas del último ejercicio; `null` sin ventas. */
  readonly currency: string | null;
  /** Del más viejo al más reciente: el orden en que se lee una historia. */
  readonly years: readonly TrajectoryYear[];
  readonly summary: {
    /** Crecimiento anual compuesto de las ventas entre extremos. */
    readonly revenueCagr: TrajectoryChange;
    /** Puntos de margen operativo ganados o perdidos entre extremos. */
    readonly operatingMarginChange: TrajectoryChange;
    /** Variación de las acciones diluidas: negativa son recompras netas. */
    readonly dilutedSharesChange: TrajectoryChange;
    /** Ejercicios con flujo libre positivo sobre los que tienen dato. */
    readonly positiveFreeCashFlowYears: {
      readonly positive: number;
      readonly measured: number;
    };
  };
};

const valueOf = (item: LineItemValue, path: string): Dec =>
  parseDecimal(item.value, path);

const asValue = (value: Dec, path: string): TrajectoryValue => ({
  status: "value",
  value: formatDecimal(value, path),
});

const nullOf = (reason: TrajectoryNullReason): TrajectoryValue => ({
  status: "null",
  reason,
});

function items(
  year: FiscalYear,
  keys: readonly LineItemId[],
): readonly LineItemValue[] | null {
  const found = keys.map((key) => year.items[key]);
  return found.every((item) => item !== undefined)
    ? (found as LineItemValue[])
    : null;
}

function sameCurrency(values: readonly LineItemValue[]): boolean {
  return new Set(values.map((item) => item.currency)).size <= 1;
}

function revenueOf(year: FiscalYear): TrajectoryValue {
  const revenue = year.items.revenue;
  return revenue === undefined
    ? nullOf("not_reported")
    : asValue(valueOf(revenue, "revenue"), "revenue");
}

function operatingMarginOf(year: FiscalYear): TrajectoryValue {
  const revenue = year.items.revenue;
  const ebit = ebitOf(year);

  if (revenue === undefined || ebit === null) return nullOf("not_reported");
  if (!sameCurrency([revenue, ...ebit.inputs]))
    return nullOf("currency_mismatch");

  const sales = valueOf(revenue, "revenue");
  if (!sales.greaterThan(ZERO)) return nullOf("non_positive_revenue");

  return asValue(divide(ebit.value, sales, "operatingMargin"), "margin");
}

function dilutedEpsOf(year: FiscalYear): TrajectoryValue {
  const found = items(year, ["net_income", "diluted_shares"]);
  if (found === null) return nullOf("not_reported");

  const [netIncome, shares] = found as [LineItemValue, LineItemValue];
  const count = valueOf(shares, "diluted_shares");
  if (!count.greaterThan(ZERO)) return nullOf("non_positive_shares");

  return asValue(
    divide(valueOf(netIncome, "net_income"), count, "dilutedEps"),
    "dilutedEps",
  );
}

function freeCashFlowOf(year: FiscalYear): TrajectoryValue {
  // Sin capex publicado no hay flujo libre: suponer cero lo inflaría.
  const found = items(year, ["operating_cash_flow", "capital_expenditure"]);
  if (found === null) return nullOf("not_reported");
  if (!sameCurrency(found)) return nullOf("currency_mismatch");

  const [operating, capex] = found as [LineItemValue, LineItemValue];
  return asValue(
    valueOf(operating, "operating_cash_flow").minus(
      valueOf(capex, "capital_expenditure"),
    ),
    "freeCashFlow",
  );
}

const CASH_ITEMS: readonly LineItemId[] = [
  "cash",
  "liquid_investments",
  "marketable_securities_noncurrent",
];

function netCashOf(year: FiscalYear): TrajectoryValue {
  const cash = year.items.cash;
  if (cash === undefined) return nullOf("not_reported");

  const debt = resolveReportedDebt(
    Object.fromEntries(
      DEBT_COMPONENT_KEYS.map((key) => {
        const item = year.items[DEBT_ITEMS[key]];
        return [
          key,
          item === undefined
            ? null
            : { value: item.value, concept: item.concept },
        ];
      }),
    ) as ReportedDebtInput,
  );
  if (debt.status !== "resolved") return nullOf("debt_unresolved");

  const cashLike = CASH_ITEMS.flatMap((key) => {
    const item = year.items[key];
    return item === undefined ? [] : [item];
  });
  const debtItems = DEBT_COMPONENT_KEYS.flatMap((key) => {
    const item = year.items[DEBT_ITEMS[key]];
    return item === undefined ? [] : [item];
  });
  if (!sameCurrency([...cashLike, ...debtItems]))
    return nullOf("currency_mismatch");

  return asValue(
    sum(cashLike.map((item) => valueOf(item, item.item))).minus(
      parseDecimal(debt.total, "debt.total"),
    ),
    "netCash",
  );
}

function dilutedSharesOf(year: FiscalYear): TrajectoryValue {
  const shares = year.items.diluted_shares;
  return shares === undefined
    ? nullOf("not_reported")
    : asValue(valueOf(shares, "diluted_shares"), "dilutedShares");
}

type Point = { readonly fiscalYearEnd: string; readonly value: Dec };

/** Los extremos con dato: el ejercicio más viejo y el más reciente. */
function endpoints(
  years: readonly TrajectoryYear[],
  pick: (year: TrajectoryYear) => TrajectoryValue,
): readonly [Point, Point] | null {
  const points = years.flatMap((year) => {
    const reading = pick(year);
    return reading.status === "value"
      ? [
          {
            fiscalYearEnd: year.fiscalYearEnd,
            value: parseDecimal(reading.value, "trajectory"),
          },
        ]
      : [];
  });
  const first = points[0];
  const last = points.at(-1);

  return first === undefined || last === undefined || points.length < 2
    ? null
    : [first, last];
}

function yearsBetween(from: string, to: string): number {
  // Los ejercicios de 52/53 semanas no caen el mismo día: se redondea.
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000;
  return Math.round(days / 365.25);
}

function change(
  pair: readonly [Point, Point] | null,
  compute: (from: Dec, to: Dec, years: number) => Dec | null,
): TrajectoryChange {
  if (pair === null) return { status: "null", reason: "insufficient_years" };

  const [from, to] = pair;
  const years = yearsBetween(from.fiscalYearEnd, to.fiscalYearEnd);
  if (years < 1) return { status: "null", reason: "insufficient_years" };

  const value = compute(from.value, to.value, years);
  return value === null
    ? { status: "null", reason: "non_positive_endpoint" }
    : {
        status: "value",
        value: formatDecimal(value, "trajectory.change"),
        fromFiscalYearEnd: from.fiscalYearEnd,
        toFiscalYearEnd: to.fiscalYearEnd,
        years,
      };
}

const compound = (from: Dec, to: Dec, years: number): Dec | null =>
  from.greaterThan(ZERO) && to.greaterThan(ZERO)
    ? to.dividedBy(from).pow(ONE.dividedBy(years)).minus(ONE)
    : null;

/** La historia de la serie anual, del ejercicio más viejo al más reciente. */
export function companyTrajectory(
  series: AnnualFundamentals,
): CompanyTrajectory {
  const ordered = [...series.fiscalYears].reverse();

  const read = ordered.map((year, index): TrajectoryYear => {
    const revenue = revenueOf(year);
    const previous = index === 0 ? null : revenueOf(ordered[index - 1]!);

    return {
      fiscalYearEnd: year.fiscalYearEnd,
      revenue,
      revenueGrowth:
        previous === null
          ? null
          : previous.status !== "value" || revenue.status !== "value"
            ? nullOf("not_reported")
            : (() => {
                const from = parseDecimal(previous.value, "revenue");
                return from.greaterThan(ZERO)
                  ? asValue(
                      parseDecimal(revenue.value, "revenue")
                        .dividedBy(from)
                        .minus(ONE),
                      "revenueGrowth",
                    )
                  : nullOf("non_positive_revenue");
              })(),
      operatingMargin: operatingMarginOf(year),
      dilutedEps: dilutedEpsOf(year),
      freeCashFlow: freeCashFlowOf(year),
      netCash: netCashOf(year),
      dilutedShares: dilutedSharesOf(year),
    };
  });
  // La serie trae ejercicios viejos sólo por la I+D (ADR 0037): un año sin
  // ninguna de las seis lecturas no es parte de la historia que se muestra.
  const years = read.filter((year) =>
    [
      year.revenue,
      year.operatingMargin,
      year.dilutedEps,
      year.freeCashFlow,
      year.netCash,
      year.dilutedShares,
    ].some((reading) => reading.status === "value"),
  );

  const freeCashFlows = years.flatMap((year) =>
    year.freeCashFlow.status === "value"
      ? [parseDecimal(year.freeCashFlow.value, "freeCashFlow")]
      : [],
  );

  return {
    version: COMPANY_TRAJECTORY_VERSION,
    currency: series.fiscalYears[0]?.items.revenue?.currency ?? null,
    years,
    summary: {
      revenueCagr: change(
        endpoints(years, (year) => year.revenue),
        compound,
      ),
      operatingMarginChange: change(
        endpoints(years, (year) => year.operatingMargin),
        (from, to) => to.minus(from),
      ),
      dilutedSharesChange: change(
        endpoints(years, (year) => year.dilutedShares),
        (from, to) =>
          from.greaterThan(ZERO) && to.greaterThan(ZERO)
            ? to.dividedBy(from).minus(ONE)
            : null,
      ),
      positiveFreeCashFlowYears: {
        positive: freeCashFlows.filter((value) => value.greaterThan(ZERO))
          .length,
        measured: freeCashFlows.length,
      },
    },
  };
}
