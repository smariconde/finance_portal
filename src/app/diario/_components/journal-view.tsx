"use client";

import {
  CircleCheck,
  CircleDashed,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
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
import { TickerMark } from "@/app/_components/ticker-mark";
import { Segmented } from "@/app/_components/segmented";
import {
  formatMoney,
  formatQuantity,
  formatSession,
  formatSignedMoney,
  signOf,
} from "@/app/_components/trading-format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CalendarBook } from "@/modules/trading/domain/daily-pnl";
import type {
  JournalEntry,
  JournalSummary,
} from "@/modules/trading/domain/journal";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";
import type { TradingSetup } from "@/modules/trading/domain/trading-setups";

import { ExecutionsList } from "./executions-list";
import { Money, RValue } from "./pnl-values";
import { SessionCalendar } from "./session-calendar";
import { TodayStrip } from "./today-strip";

type Filter =
  "all" | "day" | "swing" | "winners" | "losers" | "open" | "pending";

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "day", label: "Day" },
  { value: "swing", label: "Swing" },
  { value: "winners", label: "Ganadores" },
  { value: "losers", label: "Perdedores" },
  { value: "open", label: "Abiertos" },
  { value: "pending", label: "Sin revisar" },
];

function matches(
  trade: RoundTrip,
  entry: JournalEntry | undefined,
  filter: Filter,
): boolean {
  const sign = trade.realizedPnl === null ? 0 : signOf(trade.realizedPnl);
  switch (filter) {
    case "all":
      return true;
    case "day":
      return trade.status === "closed" && trade.dayTrade;
    case "swing":
      return trade.status === "closed" && !trade.dayTrade;
    case "winners":
      return trade.status === "closed" && sign > 0;
    case "losers":
      return trade.status === "closed" && sign < 0;
    case "open":
      return trade.status === "open";
    case "pending":
      return entry?.review !== "reviewed";
  }
}

/** Días de calendario entre la sesión de entrada y la de salida. */
function daysHeld(trade: RoundTrip): number | null {
  if (trade.closedSession === null || trade.status !== "closed") return null;
  return Math.round(
    (Date.parse(trade.closedSession) - Date.parse(trade.openedSession)) /
      86_400_000,
  );
}

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
        className="bg-emerald-600 dark:bg-emerald-500"
        style={{ width: width(summary.winners) }}
      />
      <span
        className="bg-muted-foreground/40"
        style={{ width: width(summary.breakeven) }}
      />
      <span
        className="bg-red-600 dark:bg-red-500"
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
                        row.pnl >= 0
                          ? "text-emerald-600 dark:text-emerald-500"
                          : "text-red-600 dark:text-red-500"
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

function TradesTable({
  trades,
  entries,
  setups,
}: {
  readonly trades: readonly RoundTrip[];
  readonly entries: Readonly<Record<string, JournalEntry>>;
  readonly setups: readonly TradingSetup[];
}) {
  const setupLabel = useMemo(
    () => new Map(setups.map((setup) => [setup.code, setup.label])),
    [setups],
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      trades
        .filter((trade) => matches(trade, entries[trade.tradeId], filter))
        .sort(
          (a, b) =>
            Date.parse(b.closedAt ?? "9999-12-31") -
              Date.parse(a.closedAt ?? "9999-12-31") ||
            Date.parse(b.openedAt) - Date.parse(a.openedAt),
        ),
    [trades, entries, filter],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2">
          Trades{" "}
          <span className="numeric text-muted-foreground">{rows.length}</span>
        </CardTitle>
        <div className="max-w-full overflow-x-auto">
          <Segmented
            label="Filtrar trades"
            options={FILTERS}
            value={filter}
            onChange={setFilter}
          />
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Ningún trade.
          </p>
        ) : (
          <Table containerLabel="Trades, tabla desplazable">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <span className="sr-only">Ejecuciones</span>
                </TableHead>
                <TableHead>Símbolo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Setup</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Salida</TableHead>
                <TableHead className="text-right">Días</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio entrada</TableHead>
                <TableHead className="text-right">Precio salida</TableHead>
                <TableHead className="text-right">P&amp;L</TableHead>
                <TableHead className="text-right">R</TableHead>
                <TableHead className="text-right">Fees</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((trade) => {
                const open = expanded === trade.tradeId;
                const days = daysHeld(trade);
                const entry = entries[trade.tradeId];
                const reviewed = entry?.review === "reviewed";
                return (
                  <Fragment key={trade.tradeId}>
                    <TableRow data-state={open ? "selected" : undefined}>
                      <TableCell>
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={`Ejecuciones de ${trade.symbol}`}
                          onClick={() =>
                            setExpanded(open ? null : trade.tradeId)
                          }
                          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {open ? (
                            <ChevronDown
                              className="size-4"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronRight
                              className="size-4"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <TickerMark
                            ticker={trade.symbol}
                            name={null}
                            size="sm"
                          />
                          {entry === undefined ? (
                            trade.symbol
                          ) : (
                            <Link
                              href={`/diario/${entry.ref}`}
                              className="inline-flex items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                              {reviewed ? (
                                <CircleCheck
                                  className="size-3.5 text-primary"
                                  aria-hidden="true"
                                />
                              ) : (
                                <CircleDashed
                                  className="size-3.5 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              )}
                              {trade.symbol}
                              <span className="sr-only">
                                {reviewed ? ", revisado" : ", sin revisar"}
                              </span>
                            </Link>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        {trade.status === "open" ? (
                          <Badge variant="outline">Abierto</Badge>
                        ) : trade.status === "opened_before_history" ? (
                          <Badge variant="outline">Sin entrada</Badge>
                        ) : (
                          <Badge
                            variant={trade.dayTrade ? "secondary" : "outline"}
                          >
                            {trade.dayTrade ? "Day" : "Swing"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-muted-foreground">
                        {entry?.setupCode == null
                          ? "—"
                          : (setupLabel.get(entry.setupCode) ??
                            entry.setupCode)}
                      </TableCell>
                      <TableCell className="numeric whitespace-nowrap">
                        {trade.status === "opened_before_history"
                          ? "—"
                          : formatSession(trade.openedSession)}
                      </TableCell>
                      <TableCell className="numeric whitespace-nowrap">
                        {trade.closedSession === null
                          ? "—"
                          : formatSession(trade.closedSession)}
                      </TableCell>
                      <TableCell className="numeric text-right">
                        {days ?? "—"}
                      </TableCell>
                      <TableCell className="numeric text-right">
                        {formatQuantity(
                          trade.status === "opened_before_history"
                            ? trade.portions[0]!.quantity
                            : trade.entryQuantity,
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={trade.averageEntryPrice} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={trade.averageExitPrice} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {/* Abierto y sin salidas, el realizado no existe
                            todavía: un 0,00 se leía como resultado. */}
                        {trade.status === "open" &&
                        trade.averageExitPrice === null ? (
                          <>
                            <Money value={null} />
                            <span className="sr-only">sin salidas</span>
                          </>
                        ) : (
                          <Money value={trade.realizedPnl} signed />
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <RValue r={entry?.r ?? null} />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        <Money value={trade.fees} />
                      </TableCell>
                    </TableRow>
                    {open ? (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell />
                        <TableCell colSpan={12}>
                          <ExecutionsList portions={trade.portions} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
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
