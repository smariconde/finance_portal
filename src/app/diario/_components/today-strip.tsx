"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { formatClock, formatSession } from "@/app/_components/trading-format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PeriodPnl } from "@/modules/trading/domain/daily-pnl";
import {
  dayTotal,
  type OpenDayPnl,
} from "@/modules/trading/domain/open-day-pnl";

import { readOpenPnl, type OpenPnlResult } from "../actions";
import { Money, RValue } from "./pnl-values";

type OpenView =
  | { readonly kind: "loading" }
  | { readonly kind: "read"; readonly at: string; readonly pnl: OpenDayPnl }
  | { readonly kind: "failed"; readonly code: string };

const FAILURE_COPY: Record<string, string> = {
  not_connected: "Sin acceso a Schwab: reconectá la cuenta.",
  http_401: "Schwab rechazó el token: reconectá la cuenta.",
  source_daily_budget_exhausted: "Se agotó la cuota diaria de Schwab.",
  unavailable: "Schwab no está disponible en este entorno.",
};

function viewOf(result: OpenPnlResult): OpenView {
  if (result.state === "read") {
    return { kind: "read", at: result.readAt, pnl: result.pnl };
  }
  return {
    kind: "failed",
    code: result.state === "unavailable" ? "unavailable" : result.code,
  };
}

function Stat({
  label,
  children,
  detail,
}: {
  readonly label: React.ReactNode;
  readonly children: React.ReactNode;
  readonly detail?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
      </dt>
      <dd className="text-xl leading-none font-semibold">{children}</dd>
      {detail === undefined ? null : (
        <dd className="text-xs text-muted-foreground">{detail}</dd>
      )}
    </div>
  );
}

/**
 * El día de un vistazo (`F11-06`): lo realizado en la sesión de Nueva York de
 * hoy, lo abierto que publica Schwab, el total y R. Lo abierto se lee una vez al
 * abrir y cuando el owner lo pide; la cuenta en vivo con cadencia es `/cuenta`.
 */
export function TodayStrip({
  session,
  realized,
}: {
  readonly session: string;
  readonly realized: PeriodPnl | null;
}) {
  const [open, setOpen] = useState<OpenView>({ kind: "loading" });
  const generation = useRef(0);

  const read = useCallback(() => {
    const mine = ++generation.current;
    void readOpenPnl({})
      .catch((): OpenPnlResult => ({ state: "unavailable" }))
      .then((result) => {
        if (generation.current === mine) setOpen(viewOf(result));
      });
  }, []);

  useEffect(() => {
    read();
    return () => {
      generation.current += 1;
    };
  }, [read]);

  // Sin salidas hoy no se realizó nada: es un cero real, no un faltante.
  const realizedValue = realized?.realizedPnl ?? "0";
  const total =
    open.kind === "read" ? dayTotal(realizedValue, open.pnl.day) : null;

  return (
    <Card className="py-0">
      <section aria-labelledby="hoy-title">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <h2 id="hoy-title" className="text-sm font-medium">
            Hoy{" "}
            <span className="numeric font-normal text-muted-foreground">
              {formatSession(session)}
            </span>
          </h2>
          <InfoTip title="Cómo se arma el día">
            <p>
              <strong>Realizado:</strong> lo que cerraron las salidas de la
              sesión de Nueva York de hoy, por FIFO y neto de comisiones.
            </p>
            <p>
              <strong>Abierto:</strong> el P&amp;L del día de las posiciones
              abiertas, tal como lo publica Schwab.
            </p>
            <p>
              <strong>R:</strong> el P&amp;L sobre el riesgo inicial; necesita
              el stop planeado de cada trade.
            </p>
          </InfoTip>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4 md:divide-x [&>div]:border-border max-md:[&>div:nth-child(-n+2)]:border-b max-md:[&>div:nth-child(odd)]:border-r">
          <Stat
            label="Realizado"
            detail={
              realized === null
                ? "Sin salidas"
                : `${realized.trades} ${realized.trades === 1 ? "trade" : "trades"}`
            }
          >
            <Money
              value={realizedValue}
              signed={realized !== null}
              className={
                realized === null ? "text-muted-foreground" : undefined
              }
            />
            {realized !== null && realized.unknownExits > 0 ? (
              <span className="sr-only">
                , sin contar {realized.unknownExits} salidas sin entrada
              </span>
            ) : null}
          </Stat>
          <Stat
            label="Abierto"
            detail={
              open.kind === "read" ? (
                <span className="inline-flex items-center gap-1">
                  {open.pnl.positions === 0
                    ? "Sin posiciones"
                    : `${open.pnl.positions} ${open.pnl.positions === 1 ? "posición" : "posiciones"}`}
                  <span aria-hidden="true">·</span>
                  <time dateTime={open.at} className="numeric">
                    {formatClock(open.at)}
                  </time>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen({ kind: "loading" });
                      read();
                    }}
                    aria-label="Volver a leer lo abierto"
                    className="inline-flex size-6 items-center justify-center rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
              ) : open.kind === "failed" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setOpen({ kind: "loading" });
                    read();
                  }}
                >
                  Reintentar
                </Button>
              ) : undefined
            }
          >
            {open.kind === "loading" ? (
              <span role="status" aria-label="Leyendo Schwab">
                <Skeleton className="h-5 w-24" />
              </span>
            ) : open.kind === "failed" ? (
              <span className="inline-flex items-center gap-1 text-base font-normal">
                <CircleAlert
                  className="size-4 text-amber-700 dark:text-amber-400"
                  aria-hidden="true"
                />
                <span className="text-amber-800 dark:text-amber-300">
                  Sin leer
                </span>
                <InfoTip title="Por qué no se leyó">
                  <p>{FAILURE_COPY[open.code] ?? "Schwab no respondió."}</p>
                  <p className="font-mono text-xs">{open.code}</p>
                </InfoTip>
              </span>
            ) : open.pnl.day.value === null ? (
              <span className="inline-flex items-center gap-1">
                <span className="text-muted-foreground">—</span>
                <InfoTip title="Sin P&L abierto">
                  <p>
                    Schwab no publicó el P&amp;L del día de{" "}
                    {open.pnl.day.missing} de las posiciones: sumar las demás
                    mostraría un parcial como total.
                  </p>
                </InfoTip>
              </span>
            ) : (
              <Money value={open.pnl.day.value} signed />
            )}
          </Stat>
          <Stat label="Total del día">
            {open.kind === "loading" ? (
              <Skeleton className="h-5 w-24" />
            ) : (
              <Money value={total} signed />
            )}
          </Stat>
          <Stat
            label={
              <>
                R
                {realized === null || realized.r.value !== null ? null : (
                  <InfoTip title="R del día">
                    <p>
                      {realized.r.missing === 1
                        ? "Una salida de hoy no tiene"
                        : `${realized.r.missing} salidas de hoy no tienen`}{" "}
                      stop planeado: sin el riesgo inicial no hay R.
                    </p>
                  </InfoTip>
                )}
              </>
            }
            detail={
              realized !== null && realized.r.value === null
                ? "Sin stop planeado"
                : undefined
            }
          >
            <RValue r={realized?.r ?? null} />
          </Stat>
        </dl>
      </section>
    </Card>
  );
}
