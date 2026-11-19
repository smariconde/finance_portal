"use client";

import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";

import {
  SortableTableHead,
  useTableSort,
} from "@/app/_components/data-table/sortable-table-head";
import { TablePagination } from "@/app/_components/data-table/table-pagination";
import { pageWindow } from "@/app/_components/data-table/table-pagination-window";
import { InfoTip } from "@/app/_components/info-tip";
import { Segmented } from "@/app/_components/segmented";
import { TickerMark } from "@/app/_components/ticker-mark";
import {
  formatQuantity,
  formatSession,
  signOf,
} from "@/app/_components/trading-format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { JournalEntry } from "@/modules/trading/domain/journal";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";
import type { TradingSetup } from "@/modules/trading/domain/trading-setups";

import { ExecutionsList } from "./executions-list";
import { Money, PercentValue, RValue } from "./pnl-values";
import {
  DEFAULT_TRADE_SORT,
  daysHeld,
  displayedPnl,
  firstTradeSortDirection,
  sortTrades,
  type ResultUnit,
  type TradeSortKey,
} from "./trades-table-sort";

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

const UNITS: readonly { value: ResultUnit; label: string }[] = [
  { value: "money", label: "US$" },
  { value: "percent", label: "%" },
];

const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

/** Columnas de la tabla: la fila de ejecuciones se extiende sobre todas menos la del botón. */
const COLUMN_COUNT = 13;

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

function TradeKind({ trade }: { readonly trade: RoundTrip }) {
  if (trade.status === "open") return <Badge variant="outline">Abierto</Badge>;
  if (trade.status === "opened_before_history") {
    return <Badge variant="outline">Sin entrada</Badge>;
  }
  return (
    <Badge variant={trade.dayTrade ? "secondary" : "outline"}>
      {trade.dayTrade ? "Day" : "Swing"}
    </Badge>
  );
}

/** El resultado en la unidad elegida; un retorno parcial lo dice. */
function TradeResult({
  trade,
  entry,
  unit,
}: {
  readonly trade: RoundTrip;
  readonly entry: JournalEntry | undefined;
  readonly unit: ResultUnit;
}) {
  if (unit === "money") {
    const pnl = displayedPnl(trade);
    return pnl === null ? (
      <>
        <Money value={null} />
        <span className="sr-only">sin salidas</span>
      </>
    ) : (
      <Money value={pnl} signed />
    );
  }
  const result = entry?.return;
  if (result === undefined || result.percent === null) {
    return <PercentValue value={null} />;
  }
  return (
    <span className="inline-flex items-baseline gap-1">
      <PercentValue value={result.percent} />
      {result.scope === "exited_portion" ? (
        <span className="text-xs font-normal text-muted-foreground">
          parcial
        </span>
      ) : null}
    </span>
  );
}

function SymbolCell({
  trade,
  entry,
}: {
  readonly trade: RoundTrip;
  readonly entry: JournalEntry | undefined;
}) {
  const reviewed = entry?.review === "reviewed";
  return (
    <span className="inline-flex items-center gap-2">
      <TickerMark ticker={trade.symbol} name={null} size="sm" />
      {entry === undefined ? (
        trade.symbol
      ) : (
        <Link
          href={`/diario/${entry.ref}`}
          className="inline-flex items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {reviewed ? (
            <CircleCheck className="size-3.5 text-primary" aria-hidden="true" />
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
  );
}

/**
 * Los trades del diario: filtro, unidad del resultado (dólares o retorno),
 * orden por columna y páginas. El resultado va al lado del símbolo porque es
 * lo que se lee primero; en un teléfono, lo demás se desplaza de costado.
 * Filtrar, ordenar o cambiar la unidad vuelve a la primera página.
 */
export function TradesTable({
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
  const [unit, setUnit] = useState<ResultUnit>("money");
  const [sort, toggleSort] = useTableSort<TradeSortKey>(
    DEFAULT_TRADE_SORT,
    firstTradeSortDirection,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      sortTrades(
        trades.filter((trade) =>
          matches(trade, entries[trade.tradeId], filter),
        ),
        entries,
        sort,
        unit,
      ),
    [trades, entries, filter, sort, unit],
  );
  const view = pageWindow(rows.length, page, pageSize);
  const visible = rows.slice(view.start, view.end);

  const onSort = (key: TradeSortKey) => {
    toggleSort(key);
    setPage(1);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-1">
          Trades{" "}
          <span className="numeric font-normal text-muted-foreground">
            {rows.length}
          </span>
          <InfoTip title="Cómo se lee la tabla">
            <p>
              <strong>P&amp;L</strong>: dólares de Schwab, netos de comisiones.
              Un trade abierto muestra lo realizado por sus salidas.
            </p>
            <p>
              <strong>Retorno</strong>: ese P&amp;L sobre lo que costó lo que
              salió, comisiones incluidas. En un trade abierto con salidas es el
              de la parte que salió (<em>parcial</em>).
            </p>
            <p>
              Lo que no tiene la cifra queda al final al ordenar, en los dos
              sentidos.
            </p>
          </InfoTip>
        </CardTitle>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="max-w-full overflow-x-auto">
            <Segmented
              label="Filtrar trades"
              options={FILTERS}
              value={filter}
              onChange={(value) => {
                setFilter(value);
                setPage(1);
              }}
            />
          </div>
          <Segmented
            label="Resultado en"
            options={UNITS}
            value={unit}
            onChange={(value) => {
              setUnit(value);
              setPage(1);
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
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
                <SortableTableHead sortKey="symbol" sort={sort} onSort={onSort}>
                  Símbolo
                </SortableTableHead>
                <SortableTableHead
                  sortKey="result"
                  sort={sort}
                  onSort={onSort}
                  align="right"
                >
                  {unit === "money" ? "P&L" : "Retorno"}
                </SortableTableHead>
                <SortableTableHead
                  sortKey="r"
                  sort={sort}
                  onSort={onSort}
                  align="right"
                >
                  R
                </SortableTableHead>
                <TableHead scope="col">Tipo</TableHead>
                <TableHead scope="col">Setup</TableHead>
                <SortableTableHead sortKey="opened" sort={sort} onSort={onSort}>
                  Entrada
                </SortableTableHead>
                <SortableTableHead sortKey="closed" sort={sort} onSort={onSort}>
                  Salida
                </SortableTableHead>
                <SortableTableHead
                  sortKey="days"
                  sort={sort}
                  onSort={onSort}
                  align="right"
                >
                  Días
                </SortableTableHead>
                <TableHead scope="col" className="text-right">
                  Cantidad
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Precio entrada
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Precio salida
                </TableHead>
                <SortableTableHead
                  sortKey="fees"
                  sort={sort}
                  onSort={onSort}
                  align="right"
                >
                  Fees
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((trade) => {
                const open = expanded === trade.tradeId;
                const days = daysHeld(trade);
                const entry = entries[trade.tradeId];
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
                        <SymbolCell trade={trade} entry={entry} />
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        <TradeResult trade={trade} entry={entry} unit={unit} />
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <RValue r={entry?.r ?? null} />
                      </TableCell>
                      <TableCell>
                        <TradeKind trade={trade} />
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
                      <TableCell className="text-right text-muted-foreground">
                        <Money value={trade.fees} />
                      </TableCell>
                    </TableRow>
                    {open ? (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell />
                        <TableCell colSpan={COLUMN_COUNT - 1}>
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
        {rows.length === 0 ? null : (
          <div className="px-4">
            <TablePagination
              view={view}
              pageSize={pageSize}
              pageSizes={PAGE_SIZES}
              noun="trades"
              onPageChange={(next) => {
                setPage(next);
                setExpanded(null);
              }}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
