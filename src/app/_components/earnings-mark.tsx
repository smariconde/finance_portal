import { Badge } from "@/components/ui/badge";
import type { EarningsReport } from "@/modules/market-calendar/domain/earnings-calendar";
import {
  earningsExposureAt,
  reportsToday,
} from "@/modules/market-calendar/domain/earnings-exposure";
import type { TradingBook } from "@/modules/trading/domain/trading-book";

import { shortMarketDate } from "./market-format";

export function earningsTimeLabel(time: EarningsReport["time"]): string {
  if (time === "pre-market") return "pre-apertura";
  if (time === "post-market") return "post-cierre";
  return "hora s/i";
}

export function EarningsMark({
  report,
  at,
  book,
}: {
  readonly report: EarningsReport | undefined;
  readonly at: string;
  readonly book: TradingBook;
}) {
  if (!report) return null;
  if (book === "day") {
    return reportsToday(report, at) ? (
      <Badge variant="secondary">Reporta hoy</Badge>
    ) : null;
  }
  const exposure = earningsExposureAt(report, at);
  if (exposure === null) return null;
  return (
    <Badge
      variant="outline"
      className="h-auto max-w-full multiline whitespace-normal border-amber-600/50 text-amber-800 dark:text-amber-300"
    >
      Resultados · {shortMarketDate(report.date)} ·{" "}
      {earningsTimeLabel(report.time)} ·{" "}
      {exposure.session === 1 ? "1 sesión" : `en ${exposure.session} sesiones`}
    </Badge>
  );
}
