import { ArrowRight, DatabaseZap } from "lucide-react";
import Link from "next/link";

import { termShort } from "@/app/_components/financial-terms";
import { formatSession } from "@/app/_components/trading-format";
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
import { formatPercent } from "@/modules/valuation/domain/display-format";
import type { SetupHistory } from "@/server/trading/setup-history";

import { Money, RValue } from "../../diario/_components/pnl-values";
import { WinLossBar } from "../../diario/estadisticas/_components/win-loss-bar";

export type SetupHistoryState =
  | { readonly state: "read"; readonly history: SetupHistory }
  | { readonly state: "unavailable"; readonly reference: string }
  | { readonly state: "off" };

function Figure({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg leading-none font-semibold">{children}</dd>
    </div>
  );
}

const MAX_ROWS = 12;

/** Cómo le va al owner con este setup, desde su propio diario. */
export function SetupHistoryCard({
  label,
  reading,
}: {
  readonly label: string;
  readonly reading: SetupHistoryState;
}) {
  if (reading.state === "off") return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2">Tu historial</CardTitle>
        <Link
          href="/diario/estadisticas"
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Estadísticas
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {reading.state === "unavailable" ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <DatabaseZap className="size-4" aria-hidden="true" />
            Base de trading no disponible
            <code className="font-mono text-xs">{reading.reference}</code>
          </p>
        ) : reading.history.trades.length === 0 ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Ningún trade con el setup {label}
            <Link
              href="/diario"
              className="text-foreground underline underline-offset-4"
            >
              Etiquetar en el diario
            </Link>
          </p>
        ) : (
          <History history={reading.history} />
        )}
      </CardContent>
    </Card>
  );
}

function History({ history }: { readonly history: SetupHistory }) {
  const stats = history.stats;
  const shown = history.trades.slice(0, MAX_ROWS);
  return (
    <>
      {stats === null ? (
        <Badge variant="outline" className="w-fit">
          {history.currency === null && history.trades.length > 0
            ? "Trades en más de una moneda"
            : "Sin trades cerrados"}
        </Badge>
      ) : (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border ring-1 ring-foreground/10 md:grid-cols-4">
          <Figure label="Trades">
            <span className="numeric">{stats.trades}</span>
            {stats.smallSample ? (
              <Badge variant="outline" className="ml-2 align-middle">
                Muestra chica
              </Badge>
            ) : null}
          </Figure>
          <Figure label={termShort("winRate")}>
            <span className="numeric">
              {formatPercent(stats.winRate, { scale: 1 })}
            </span>
            <span className="mt-1.5 block">
              <WinLossBar stats={stats} />
            </span>
          </Figure>
          <Figure label={termShort("expectancy")}>
            <Money value={stats.expectancy} signed />
          </Figure>
          <Figure label={`${termShort("expectancy")} en R`}>
            <RValue r={stats.expectancyR} />
            <span className="numeric ml-2 text-xs font-normal text-muted-foreground">
              {stats.expectancyR.n}/{stats.trades} con stop
            </span>
          </Figure>
        </dl>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Trade</TableHead>
              <TableHead>Sesión</TableHead>
              <TableHead className="text-right">P&amp;L</TableHead>
              <TableHead className="text-right">R</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((trade) => (
              <TableRow key={trade.ref}>
                <TableCell>
                  <Link
                    href={`/diario/${trade.ref}`}
                    className="inline-flex min-h-6 items-center gap-2 rounded-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {trade.symbol}
                    <Badge variant="outline">
                      {trade.status === "open"
                        ? "Abierto"
                        : trade.dayTrade
                          ? "Day"
                          : "Swing"}
                    </Badge>
                  </Link>
                </TableCell>
                <TableCell className="numeric text-muted-foreground">
                  {formatSession(trade.closedSession ?? trade.openedSession)}
                </TableCell>
                <TableCell className="text-right">
                  <Money value={trade.realizedPnl} signed />
                </TableCell>
                <TableCell className="text-right">
                  <RValue r={trade.r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {history.trades.length > shown.length ? (
        <p className="numeric text-xs text-muted-foreground">
          {shown.length} de {history.trades.length}
        </p>
      ) : null}
    </>
  );
}
