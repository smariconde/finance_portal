import {
  divide,
  formatDecimal,
  parseDecimal,
  sum,
  ZERO,
  type Dec,
} from "./decimal-policy";
import {
  rdAmortizableLifeFor,
  type RdAmortizableLife,
} from "./rd-amortizable-life";

/**
 * Capitalización de la I+D (`F4-01`,
 * [ADR 0037](../../../../docs/architecture/adr/0037-lease-rd-capitalization.md),
 * decisión 2), con las fórmulas de Damodaran (*Valuing Companies with Intangible
 * Assets*, 2009):
 *
 *     research_asset = Σ_{t=0..n-1} rd_{-t} × (n − t) / n
 *     amortization   = Σ_{t=1..n}   rd_{-t} / n
 *     ebit          += rd_0 − amortization
 *     capital       += research_asset
 *
 * La I+D del ejercicio base no se amortiza: se supone gastada al cierre. Sin
 * ajuste fiscal, porque la I+D es deducible entera y el `(1 − t)` se cancela
 * (nota 2 del paper).
 *
 * Las condiciones se evalúan en orden y la primera que falla deja la I+D
 * reportada con su código. Nunca completa un ejercicio con cero.
 */
export const RD_CAPITALIZATION_VERSION = "rd-capitalization-1.0.0";

/** I+D sobre ventas del ejercicio base por debajo de la cual no se capitaliza. */
export const RD_MATERIALITY_THRESHOLD = "0.01";

/** Un ejercicio dura entre 52 semanas y un año bisiesto más una semana. */
const MIN_FISCAL_YEAR_GAP_DAYS = 357;
const MAX_FISCAL_YEAR_GAP_DAYS = 373;
const DAY_MS = 86_400_000;

export type RdFiscalYear = {
  readonly fiscalYearEnd: string;
  /** `null` si el ejercicio existe pero no publicó I+D. */
  readonly amount: string | null;
};

export type RdCapitalizationInput = {
  /** Ejercicios de la serie anual, el más reciente primero. */
  readonly fiscalYears: readonly RdFiscalYear[];
  /** Ventas del ejercicio base, para la materialidad. */
  readonly baseRevenue: string | null;
  /** Industria de Damodaran visible al corte. */
  readonly industryKey: string | null;
};

export type RdNotCapitalizedReason =
  | "not_reported"
  | "rd_negative"
  | "industry_unassigned"
  | "life_not_declared"
  | "revenue_unavailable"
  | "immaterial"
  | "insufficient_history";

export type RdScheduleRow = {
  /** 0 es el ejercicio base; 1, el anterior. */
  readonly offset: number;
  readonly fiscalYearEnd: string;
  readonly amount: string;
  readonly unamortizedShare: string;
  readonly unamortized: string;
  readonly amortizationThisYear: string;
};

export type RdCapitalization =
  | {
      readonly version: typeof RD_CAPITALIZATION_VERSION;
      readonly status: "capitalized";
      readonly life: RdAmortizableLife;
      readonly materialityThreshold: string;
      readonly rdToRevenue: string;
      readonly baseYearRd: string;
      readonly schedule: readonly RdScheduleRow[];
      readonly researchAsset: string;
      readonly amortization: string;
      readonly ebitAdjustment: string;
      readonly investedCapitalAdjustment: string;
      /** I+D neta de amortización: la reinversión que el EBIT reportado escondía. */
      readonly netReinvestment: string;
    }
  | {
      readonly version: typeof RD_CAPITALIZATION_VERSION;
      readonly status: "not_capitalized";
      readonly reason: RdNotCapitalizedReason;
      /** La vida que hubiera usado, cuando la industria la tiene. */
      readonly life: RdAmortizableLife | null;
      /** Lo que se midió antes de fallar, para que el motivo se pueda leer. */
      readonly rdToRevenue: string | null;
      readonly fiscalYearsAvailable: number;
    };

function gapDays(later: string, earlier: string): number {
  return (
    (Date.parse(`${later}T00:00:00.000Z`) -
      Date.parse(`${earlier}T00:00:00.000Z`)) /
    DAY_MS
  );
}

/** Ejercicios consecutivos con I+D publicada, desde el base hacia atrás. */
function consecutiveFromBase(
  fiscalYears: readonly RdFiscalYear[],
): readonly { fiscalYearEnd: string; amount: Dec }[] {
  const run: { fiscalYearEnd: string; amount: Dec }[] = [];

  for (const [index, year] of fiscalYears.entries()) {
    if (year.amount === null) {
      break;
    }

    const previous = fiscalYears[index - 1];

    if (previous !== undefined) {
      const gap = gapDays(previous.fiscalYearEnd, year.fiscalYearEnd);

      // Un ejercicio que falta en la serie corta la historia: el siguiente
      // no es «el anterior», y amortizarlo como tal correría todo un año.
      if (gap < MIN_FISCAL_YEAR_GAP_DAYS || gap > MAX_FISCAL_YEAR_GAP_DAYS) {
        break;
      }
    }

    run.push({
      fiscalYearEnd: year.fiscalYearEnd,
      amount: parseDecimal(year.amount, `rd.${year.fiscalYearEnd}`),
    });
  }

  return run;
}

export function capitalizeResearchAndDevelopment(
  input: RdCapitalizationInput,
): RdCapitalization {
  const history = consecutiveFromBase(input.fiscalYears);
  const life =
    input.industryKey === null ? null : rdAmortizableLifeFor(input.industryKey);
  let rdToRevenue: Dec | null = null;

  const notCapitalized = (
    reason: RdNotCapitalizedReason,
  ): RdCapitalization => ({
    version: RD_CAPITALIZATION_VERSION,
    status: "not_capitalized",
    reason,
    life,
    rdToRevenue:
      rdToRevenue === null
        ? null
        : formatDecimal(rdToRevenue, "rd.rdToRevenue"),
    fiscalYearsAvailable: history.length,
  });

  const base = history[0];

  if (base === undefined) {
    return notCapitalized("not_reported");
  }

  if (history.some((year) => year.amount.lessThan(ZERO))) {
    return notCapitalized("rd_negative");
  }

  if (input.industryKey === null) {
    return notCapitalized("industry_unassigned");
  }

  if (life === null) {
    return notCapitalized("life_not_declared");
  }

  const revenue =
    input.baseRevenue === null
      ? null
      : parseDecimal(input.baseRevenue, "rd.baseRevenue");

  if (revenue === null || !revenue.greaterThan(ZERO)) {
    return notCapitalized("revenue_unavailable");
  }

  rdToRevenue = divide(base.amount, revenue, "rd.baseRevenue");

  if (
    rdToRevenue.lessThan(parseDecimal(RD_MATERIALITY_THRESHOLD, "rd.threshold"))
  ) {
    return notCapitalized("immaterial");
  }

  const n = life.years;

  // El base y los `n` anteriores: la amortización de este año alcanza al
  // ejercicio `-n`, que ya no tiene saldo pero todavía amortiza su último año.
  if (history.length < n + 1) {
    return notCapitalized("insufficient_history");
  }

  const years = parseDecimal(String(n), "rd.life");
  const schedule: RdScheduleRow[] = [];
  const unamortized: Dec[] = [];
  const amortization: Dec[] = [];

  for (let offset = 0; offset <= n; offset += 1) {
    const year = history[offset]!;
    const share = divide(
      parseDecimal(String(n - offset), "rd.share"),
      years,
      "rd.life",
    );
    const left = year.amount.times(share);
    const amortized =
      offset === 0 ? ZERO : divide(year.amount, years, "rd.life");

    unamortized.push(left);
    amortization.push(amortized);
    schedule.push({
      offset,
      fiscalYearEnd: year.fiscalYearEnd,
      amount: formatDecimal(year.amount, `rd.schedule.${offset}.amount`),
      unamortizedShare: formatDecimal(share, `rd.schedule.${offset}.share`),
      unamortized: formatDecimal(left, `rd.schedule.${offset}.unamortized`),
      amortizationThisYear: formatDecimal(
        amortized,
        `rd.schedule.${offset}.amortization`,
      ),
    });
  }

  const researchAsset = sum(unamortized);
  const totalAmortization = sum(amortization);
  const net = base.amount.minus(totalAmortization);

  return {
    version: RD_CAPITALIZATION_VERSION,
    status: "capitalized",
    life,
    materialityThreshold: RD_MATERIALITY_THRESHOLD,
    rdToRevenue: formatDecimal(rdToRevenue, "rd.rdToRevenue"),
    baseYearRd: formatDecimal(base.amount, "rd.baseYearRd"),
    schedule,
    researchAsset: formatDecimal(researchAsset, "rd.researchAsset"),
    amortization: formatDecimal(totalAmortization, "rd.amortization"),
    ebitAdjustment: formatDecimal(net, "rd.ebitAdjustment"),
    investedCapitalAdjustment: formatDecimal(
      researchAsset,
      "rd.investedCapitalAdjustment",
    ),
    netReinvestment: formatDecimal(net, "rd.netReinvestment"),
  };
}
