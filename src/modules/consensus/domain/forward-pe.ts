import {
  createDecimalOperations,
  HUNDRED,
  ONE,
  ZERO,
  type Dec,
} from "@/modules/numeric/domain/decimal-policy";
import {
  calendarDaysBetween,
  subtractCalendarYears,
} from "@/modules/temporal/domain/calendar-date";

/**
 * Forward P/E on the next twelve months' EPS (ADR 0083, owner's decision):
 * `NTM = w · EPS(FY1) + (1 − w) · EPS(FY2)`, with `w` the share of FY1 still
 * ahead of the close, as FactSet's forward 12-month P/E and Bloomberg's «1BF»
 * read it. FY1 is the first fiscal year ending after the close; a fiscal year
 * already over but not yet reported is not FY1.
 */
export const FORWARD_PE_VERSION = "forward-pe-1.0.0";

/**
 * PEG on the consensus growth from FY1 to FY2, in the same basis as the EPS of
 * the P/E (Damodaran, Lynch). The source publishes no long-term growth, so this
 * is a one-year growth and is labelled so.
 */
export const PEG_VERSION = "peg-1.0.0";

/** A capture older than this, against the close it prices, is not used. */
export const CONSENSUS_STALE_AFTER_DAYS = 7;

/** FY2 must be the fiscal year right after FY1. */
const MIN_FISCAL_YEAR_DAYS = 350;
const MAX_FISCAL_YEAR_DAYS = 380;

export type ConsensusYear = {
  /** Calendar month end of the fiscal year, as the source labels it. */
  readonly periodEnd: string;
  readonly epsAverage: string;
};

export type ForwardPeReason =
  | "no_consensus"
  | "stale_consensus"
  | "insufficient_horizons"
  | "no_close"
  | "currency_mismatch"
  | "non_positive_close"
  | "non_positive_eps";

export type PegReason =
  ForwardPeReason | "non_positive_base" | "non_positive_growth";

export type ForwardPeReading = {
  readonly version: typeof FORWARD_PE_VERSION;
  readonly pegVersion: typeof PEG_VERSION;
  readonly closeDate: string | null;
  readonly close: string | null;
  /** The capture the consensus comes from, as a date. */
  readonly capturedOn: string | null;
  readonly fy1: ConsensusYear | null;
  readonly fy2: ConsensusYear | null;
  /** Weight of FY1 in the NTM EPS, in (0, 1]. */
  readonly weightFy1: string | null;
  readonly ntmEps: string | null;
  readonly forwardPe: string | null;
  readonly forwardPeReason: ForwardPeReason | null;
  readonly fy1Pe: string | null;
  readonly fy2Pe: string | null;
  /** EPS(FY2) / EPS(FY1) − 1, as a fraction. */
  readonly growth: string | null;
  readonly peg: string | null;
  readonly pegReason: PegReason | null;
};

const decimal = createDecimalOperations((code) => new Error(code));

function d(value: string, path: string): Dec {
  return decimal.parseDecimal(value, path);
}

function text(value: Dec, path: string): string {
  return decimal.formatDecimal(value, path);
}

function ratio(numerator: Dec, denominator: Dec, path: string): string | null {
  return denominator.greaterThan(ZERO)
    ? text(decimal.divide(numerator, denominator, path), path)
    : null;
}

function empty(
  reason: ForwardPeReason,
  partial: Partial<ForwardPeReading> = {},
): ForwardPeReading {
  return {
    version: FORWARD_PE_VERSION,
    pegVersion: PEG_VERSION,
    closeDate: null,
    close: null,
    capturedOn: null,
    fy1: null,
    fy2: null,
    weightFy1: null,
    ntmEps: null,
    forwardPe: null,
    forwardPeReason: reason,
    fy1Pe: null,
    fy2Pe: null,
    growth: null,
    peg: null,
    pegReason: reason,
    ...partial,
  };
}

/** FY1 and FY2 for a close, or `null` when the source does not have both. */
export function fiscalYearsAhead(
  years: readonly ConsensusYear[],
  closeDate: string,
): { readonly fy1: ConsensusYear; readonly fy2: ConsensusYear } | null {
  const ahead = [...years]
    .filter((year) => year.periodEnd > closeDate)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const [fy1, fy2] = ahead;
  if (fy1 === undefined || fy2 === undefined) return null;
  const gap = calendarDaysBetween(fy1.periodEnd, fy2.periodEnd);
  return gap >= MIN_FISCAL_YEAR_DAYS && gap <= MAX_FISCAL_YEAR_DAYS
    ? { fy1, fy2 }
    : null;
}

export function forwardPe(input: {
  /** The consensus in force at the cutoff: fiscal years, not withdrawn. */
  readonly years: readonly ConsensusYear[];
  /** Date of the latest capture at the cutoff, or `null` if none. */
  readonly capturedOn: string | null;
  readonly close: {
    readonly marketDate: string;
    readonly close: string;
    readonly currency: string;
  } | null;
  /** Currency the consensus is in: the listing's. */
  readonly consensusCurrency: string;
}): ForwardPeReading {
  const { close } = input;
  if (input.capturedOn === null || input.years.length === 0) {
    return empty("no_consensus");
  }
  if (close === null) {
    return empty("no_close", { capturedOn: input.capturedOn });
  }
  const base = {
    closeDate: close.marketDate,
    close: close.close,
    capturedOn: input.capturedOn,
  };
  if (close.currency !== input.consensusCurrency) {
    return empty("currency_mismatch", base);
  }
  // A capture after the close is not visible to it; one too far before is
  // stale. The caller reads the consensus at the close's cutoff, so the first
  // can only be a caller bug and is refused the same way.
  const age = calendarDaysBetween(input.capturedOn, close.marketDate);
  if (age < 0 || age > CONSENSUS_STALE_AFTER_DAYS) {
    return empty("stale_consensus", base);
  }
  const price = d(close.close, "close");
  if (!price.greaterThan(ZERO)) return empty("non_positive_close", base);

  const ahead = fiscalYearsAhead(input.years, close.marketDate);
  if (ahead === null) return empty("insufficient_horizons", base);
  const { fy1, fy2 } = ahead;

  const fy1Start = subtractCalendarYears(fy1.periodEnd, 1);
  const weight = decimal.divide(
    d(String(calendarDaysBetween(close.marketDate, fy1.periodEnd)), "days"),
    d(String(calendarDaysBetween(fy1Start, fy1.periodEnd)), "year"),
    "weight",
  );
  const boundedWeight = weight.greaterThan(ONE) ? ONE : weight;
  const eps1 = d(fy1.epsAverage, "fy1");
  const eps2 = d(fy2.epsAverage, "fy2");
  const ntm = boundedWeight
    .times(eps1)
    .plus(ONE.minus(boundedWeight).times(eps2));
  const pe = ratio(price, ntm, "forward_pe");

  const growth = eps1.greaterThan(ZERO)
    ? decimal.divide(eps2, eps1, "growth").minus(ONE)
    : null;
  let peg: string | null = null;
  let pegReason: PegReason | null = null;
  if (pe === null) {
    pegReason = "non_positive_eps";
  } else if (growth === null) {
    pegReason = "non_positive_base";
  } else if (!growth.greaterThan(ZERO)) {
    pegReason = "non_positive_growth";
  } else {
    peg = text(
      decimal.divide(d(pe, "pe"), growth.times(HUNDRED), "peg"),
      "peg",
    );
  }

  return {
    version: FORWARD_PE_VERSION,
    pegVersion: PEG_VERSION,
    ...base,
    fy1,
    fy2,
    weightFy1: text(boundedWeight, "weight"),
    ntmEps: text(ntm, "ntm"),
    forwardPe: pe,
    forwardPeReason: pe === null ? "non_positive_eps" : null,
    fy1Pe: ratio(price, eps1, "fy1_pe"),
    fy2Pe: ratio(price, eps2, "fy2_pe"),
    growth: growth === null ? null : text(growth, "growth"),
    peg,
    pegReason,
  };
}
