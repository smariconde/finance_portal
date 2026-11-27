import type { TradeStats } from "@/modules/trading/domain/trading-stats";

/**
 * Ganadores, en cero y perdedores en una barra, con los dos conteos escritos:
 * la proporción se ve y se lee sin depender del color.
 */
export function WinLossBar({
  stats,
}: {
  readonly stats: Pick<TradeStats, "winners" | "losers" | "breakeven">;
}) {
  const total = stats.winners + stats.losers + stats.breakeven;
  const width = (n: number) => `${total === 0 ? 0 : (n / total) * 100}%`;
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <span
          className="bg-positive-fill"
          style={{ width: width(stats.winners) }}
        />
        <span
          className="bg-muted-foreground/40"
          style={{ width: width(stats.breakeven) }}
        />
        <span
          className="bg-negative-fill"
          style={{ width: width(stats.losers) }}
        />
      </span>
      <span className="numeric shrink-0">
        {stats.winners}
        <span className="sr-only"> ganadores, </span>
        <span aria-hidden="true"> · </span>
        {stats.losers}
        <span className="sr-only"> perdedores</span>
      </span>
    </span>
  );
}
