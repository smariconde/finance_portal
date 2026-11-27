import type { EarningsReport } from "./earnings-calendar";
import {
  marketDayOf,
  marketMomentAt,
  nextTradingDayAfter,
} from "./market-sessions";
import { addCalendarDays } from "./zoned-time";

export const EARNINGS_EXPOSURE_VERSION = "earnings-exposure-1.0.0";

export type EarningsExposure = {
  readonly report: EarningsReport;
  readonly session: number;
};

export function earningsExposureAt(
  report: EarningsReport,
  at: string,
): EarningsExposure | null {
  const { today, at: instant } = marketMomentAt(at);
  if (report.date < today.date || today.status === "undeclared") return null;
  if (
    report.date === today.date &&
    report.time === "pre-market" &&
    today.regular !== null &&
    instant >= today.regular.open.instant
  )
    return null;
  const reportDay = marketDayOf(report.date);
  if (reportDay.status === "undeclared") return null;
  const start =
    today.regular === null ? nextTradingDayAfter(today.date) : today;
  for (
    let day = start, session = 1;
    day !== null && session <= 5;
    day = nextTradingDayAfter(day.date), session++
  ) {
    // A weekend or holiday report can move the next session. The report's
    // source date stays intact in the warning.
    if (report.date <= day.date) return { report, session };
  }
  return null;
}

export function reportsToday(report: EarningsReport, at: string): boolean {
  const { today } = marketMomentAt(at);
  return (
    today.regular !== null &&
    ((report.date === today.date && report.time === "pre-market") ||
      (report.date === addCalendarDays(today.date, -1) &&
        report.time === "post-market"))
  );
}

export function nextReportFor(
  reports: readonly EarningsReport[],
  symbol: string,
  at: string,
  book: "day" | "swing",
): EarningsReport | undefined {
  return reports.find(
    (report) =>
      report.symbol === symbol &&
      (book === "day"
        ? reportsToday(report, at)
        : earningsExposureAt(report, at) !== null),
  );
}
