import { CircleCheck, TrendingDown } from "lucide-react";

import { termShort, termSpanish } from "@/app/_components/financial-terms";
import { InfoTip } from "@/app/_components/info-tip";
import { formatSession } from "@/app/_components/trading-format";
import { Card } from "@/components/ui/card";
import { tradingSessionOf } from "@/modules/trading/domain/trading-session";
import type {
  TradeStats,
  TradingStats,
} from "@/modules/trading/domain/trading-stats";
import {
  formatAmount,
  formatPercent,
} from "@/modules/valuation/domain/display-format";

import { Money, RValue } from "../../_components/pnl-values";

import { WinLossBar } from "./win-loss-bar";

type ReadyStats = Extract<TradingStats, { state: "ready" }>;

function Stat({
  label,
  tip,
  children,
  detail,
}: {
  readonly label: string;
  readonly tip?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly detail?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 bg-card px-4 py-3">
      <dt className="flex h-6 items-center gap-0.5 text-xs text-muted-foreground">
        {label}
        {tip === undefined ? null : <InfoTip title={label}>{tip}</InfoTip>}
      </dt>
      <dd className="text-xl leading-none font-semibold">{children}</dd>
      {detail === undefined ? null : (
        <dd className="min-h-4 text-xs text-muted-foreground">{detail}</dd>
      )}
    </div>
  );
}

function Pair({
  first,
  second,
  firstLabel,
  secondLabel,
}: {
  readonly first: React.ReactNode;
  readonly second: React.ReactNode;
  readonly firstLabel: string;
  readonly secondLabel: string;
}) {
  return (
    <span className="numeric inline-flex flex-wrap items-baseline gap-x-1">
      <span className="sr-only">{firstLabel}</span>
      {first}
      <span aria-hidden="true">/</span>
      <span className="sr-only">{secondLabel}</span>
      {second}
    </span>
  );
}

function sessionOrStart(instant: string | null): string {
  return instant === null ? "inicio" : formatSession(tradingSessionOf(instant));
}

function Figures({
  overall,
  stats,
}: {
  readonly overall: TradeStats;
  readonly stats: ReadyStats;
}) {
  const drawdown = stats.drawdown;
  const fell = drawdown !== null && drawdown.max.troughAt !== null;
  const excluded = stats.excluded.open + stats.excluded.beforeHistory;

  return (
    <dl className="grid grid-cols-2 gap-px bg-border md:grid-cols-3 lg:grid-cols-6">
      <Stat
        label="Trades"
        detail={
          excluded === 0 ? (
            "Cerrados"
          ) : (
            <span>
              Cerrados · <span className="numeric">{excluded}</span> fuera
            </span>
          )
        }
        tip={
          <>
            <p>Sólo los trades cerrados tienen resultado.</p>
            {excluded === 0 ? null : (
              <p className="numeric">
                Fuera: {stats.excluded.open} abiertos y{" "}
                {stats.excluded.beforeHistory} sin entrada en la historia.
              </p>
            )}
          </>
        }
      >
        <span className="numeric">{overall.trades}</span>
      </Stat>
      <Stat
        label={termShort("winRate")}
        tip={
          <p>
            Ganadores sobre todos los cerrados. Un trade en cero no gana y
            cuenta.
          </p>
        }
        detail={<WinLossBar stats={overall} />}
      >
        <span className="numeric">
          {formatPercent(overall.winRate, { scale: 1 })}
        </span>
      </Stat>
      <Stat
        label={termShort("expectancy")}
        tip={
          <>
            <p>
              {termSpanish("expectancy")}: lo realizado dividido por los trades.
            </p>
            <p>Debajo, la ganancia media y la pérdida media.</p>
          </>
        }
        detail={
          <Pair
            firstLabel="Ganancia media"
            secondLabel="Pérdida media"
            first={<Money value={overall.averageWin} signed />}
            second={
              <Money
                value={
                  overall.averageLoss === null
                    ? null
                    : `-${overall.averageLoss}`
                }
                signed
              />
            }
          />
        }
      >
        <Money value={overall.expectancy} signed />
      </Stat>
      <Stat
        label={`${termShort("expectancy")} en R`}
        tip={
          <>
            <p>
              El R medio de los trades con stop planeado. R es el P&amp;L sobre
              el riesgo inicial.
            </p>
            <p>Debajo, cuántos trades lo tienen.</p>
          </>
        }
        detail={
          <span className="numeric">
            {overall.expectancyR.n} / {overall.trades} con stop
          </span>
        }
      >
        <RValue r={overall.expectancyR} />
      </Stat>
      <Stat
        label={termShort("profitFactor")}
        tip={
          <>
            <p>
              {termSpanish("profitFactor")}. Sobre 1, se ganó más de lo que se
              perdió.
            </p>
            <p>Sin pérdidas no hay cociente: no se muestra infinito.</p>
          </>
        }
        detail={
          <Pair
            firstLabel="Ganancia bruta"
            secondLabel="Pérdida bruta"
            first={<Money value={overall.grossProfit} />}
            second={<Money value={overall.grossLoss} />}
          />
        }
      >
        {overall.profitFactor.value === null ? (
          <span className="text-muted-foreground">
            —<span className="sr-only">, sin pérdidas</span>
          </span>
        ) : (
          <span className="numeric">
            {formatAmount(overall.profitFactor.value, { scale: 2 })}
          </span>
        )}
      </Stat>
      <Stat
        label={termShort("maxDrawdown")}
        tip={
          <>
            <p>
              {termSpanish("maxDrawdown")} en la curva de lo realizado, salida
              por salida, desde cero.
            </p>
            <p>Debajo, del máximo al piso, y si ya se recuperó.</p>
          </>
        }
        detail={
          fell ? (
            <span className="inline-flex items-center gap-1">
              <span className="numeric">
                {sessionOrStart(drawdown.max.peakAt)} →{" "}
                {sessionOrStart(drawdown.max.troughAt)}
              </span>
              {drawdown.max.recoveredAt === null ? (
                <TrendingDown className="size-3.5" aria-label="sin recuperar" />
              ) : (
                <CircleCheck
                  className="size-3.5 text-primary"
                  aria-label={`recuperado el ${sessionOrStart(drawdown.max.recoveredAt)}`}
                />
              )}
            </span>
          ) : (
            "Nunca cayó"
          )
        }
      >
        {drawdown === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Money value={fell ? `-${drawdown.max.amount}` : "0"} signed />
        )}
      </Stat>
    </dl>
  );
}

export function StatsFigures({ stats }: { readonly stats: ReadyStats }) {
  return (
    <Card className="overflow-hidden py-0">
      {stats.overall === null ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Sin trades cerrados.
        </p>
      ) : (
        <Figures overall={stats.overall} stats={stats} />
      )}
    </Card>
  );
}
