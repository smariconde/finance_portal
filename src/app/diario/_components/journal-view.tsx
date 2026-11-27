"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { InfoTip } from "@/app/_components/info-tip";
import {
  formatMoney,
  formatSession,
  formatSignedMoney,
} from "@/app/_components/trading-format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import type { CalendarBook } from "@/modules/trading/domain/daily-pnl";
import type {
  JournalEntry,
  JournalSummary,
} from "@/modules/trading/domain/journal";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";
import type { TradingSetup } from "@/modules/trading/domain/trading-setups";

import { Money } from "./pnl-values";
import { SessionCalendar } from "./session-calendar";
import { TodayStrip } from "./today-strip";
import { TradesTable } from "./trades-table";

function Stat({
  label,
  children,
  detail,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly detail?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold leading-none">{children}</dd>
      {detail === undefined ? null : (
        <dd className="text-xs text-muted-foreground">{detail}</dd>
      )}
    </div>
  );
}

/** Ganadores contra perdedores en una barra: la proporción se ve sin leer. */
function WinLossBar({ summary }: { readonly summary: JournalSummary }) {
  const total = summary.winners + summary.losers + summary.breakeven;
  if (total === 0) return null;
  const width = (n: number) => `${(n / total) * 100}%`;
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      aria-hidden="true"
    >
      <span
        className="bg-positive-fill"
        style={{ width: width(summary.winners) }}
      />
      <span
        className="bg-muted-foreground/40"
        style={{ width: width(summary.breakeven) }}
      />
      <span
        className="bg-negative-fill"
        style={{ width: width(summary.losers) }}
      />
    </div>
  );
}

function SummaryStrip({ summary }: { readonly summary: JournalSummary }) {
  return (
    <Card className="py-0">
      <dl className="grid grid-cols-2 divide-border md:grid-cols-4 md:divide-x [&>div]:border-border max-md:[&>div:nth-child(-n+2)]:border-b max-md:[&>div:nth-child(odd)]:border-r">
        <Stat
          label="P&L realizado"
          detail={`Fees US$ ${formatMoney(summary.fees)}`}
        >
          <Money value={summary.realizedPnl} signed />
        </Stat>
        <Stat
          label="Trades cerrados"
          detail={
            summary.open > 0 ? `${summary.open} abiertos` : "Ninguno abierto"
          }
        >
          <span className="numeric">{summary.closed}</span>
        </Stat>
        <Stat
          label="Ganadores · perdedores"
          detail={<WinLossBar summary={summary} />}
        >
          <span className="numeric">
            {summary.winners}
            <span className="px-1 text-muted-foreground">·</span>
            {summary.losers}
          </span>
        </Stat>
        <Stat label="Day · swing">
          <span className="numeric">
            {summary.dayTrades}
            <span className="px-1 text-muted-foreground">·</span>
            {summary.swingTrades}
          </span>
        </Stat>
      </dl>
    </Card>
  );
}

const chartConfig = {
  pnl: { label: "P&L del trade", color: "var(--chart-1)" },
  cumulative: { label: "Acumulado", color: "var(--chart-2)" },
} satisfies ChartConfig;

const axisMoney = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function PnlChart({ summary }: { readonly summary: JournalSummary }) {
  // Number sólo para la geometría: las cifras que se leen son las decimales.
  const data = summary.curve.map((point, index) => ({
    index,
    session: point.closedSession,
    symbol: point.symbol,
    pnlText: point.pnl,
    cumulativeText: point.cumulative,
    pnl: Number(point.pnl),
    cumulative: Number(point.cumulative),
  }));
  const last = summary.curve.at(-1);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle as="h2" className="flex items-center gap-1">
          P&amp;L por trade
          <InfoTip title="Cómo se lee">
            <p>
              Cada barra es un trade cerrado, en orden de cierre: arriba ganó,
              abajo perdió. La línea es el P&amp;L realizado acumulado.
            </p>
            <p>
              Dólares de Schwab (<strong>netAmount</strong>, ya neto de
              comisiones), emparejados por FIFO.
            </p>
          </InfoTip>
        </CardTitle>
        {last === undefined ? null : (
          <span className="text-sm text-muted-foreground">
            Acumulado{" "}
            <Money value={last.cumulative} signed className="font-semibold" />
          </span>
        )}
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Sin trades cerrados.
          </p>
        ) : (
          <div
            role="img"
            aria-label={`P&L de ${data.length} trades cerrados; acumulado US$ ${last === undefined ? "0" : formatSignedMoney(last.cumulative)}. La tabla de abajo tiene cada trade.`}
          >
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-64 w-full"
              initialDimension={{ width: 640, height: 256 }}
            >
              <ComposedChart
                accessibilityLayer={false}
                data={data}
                margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="index"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                  tickFormatter={(index: number) =>
                    data[index]?.session
                      .slice(0, 7)
                      .split("-")
                      .reverse()
                      .join("/") ?? ""
                  }
                />
                <YAxis
                  width={48}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => axisMoney.format(value)}
                />
                <ReferenceLine y={0} className="stroke-border" />
                <Tooltip
                  cursor={{ className: "fill-muted/60" }}
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as
                      (typeof data)[number] | undefined;
                    if (!active || row === undefined) return null;
                    return (
                      <div className="grid gap-0.5 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                        <span className="font-medium">
                          {row.symbol} · {formatSession(row.session)}
                        </span>
                        <span>
                          Trade <Money value={row.pnlText} signed />
                        </span>
                        <span className="text-muted-foreground">
                          Acumulado <Money value={row.cumulativeText} signed />
                        </span>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="pnl" maxBarSize={14} radius={2}>
                  {data.map((row) => (
                    <Cell
                      key={row.index}
                      // `currentColor` y una clase de texto: el `fill` de una
                      // clase no le gana al atributo que pone Recharts.
                      fill="currentColor"
                      className={
                        row.pnl >= 0 ? "text-positive" : "text-negative"
                      }
                    />
                  ))}
                </Bar>
                <Line
                  dataKey="cumulative"
                  type="monotone"
                  dot={false}
                  strokeWidth={2}
                  stroke="var(--color-cumulative)"
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function JournalView({
  trades,
  summary,
  calendar,
  entries,
  setups,
}: {
  readonly trades: readonly RoundTrip[];
  readonly summary: JournalSummary;
  readonly calendar: CalendarBook;
  readonly entries: Readonly<Record<string, JournalEntry>>;
  readonly setups: readonly TradingSetup[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <TodayStrip
        session={calendar.today.session}
        realized={calendar.today.pnl}
      />
      <SessionCalendar book={calendar} />
      <SummaryStrip summary={summary} />
      <PnlChart summary={summary} />
      <TradesTable trades={trades} entries={entries} setups={setups} />
    </div>
  );
}
