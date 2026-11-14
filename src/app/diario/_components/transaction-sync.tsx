"use client";

import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { formatClock } from "@/app/_components/trading-format";
import { Button } from "@/components/ui/button";

import { syncTransactions, type SyncTransactionsResult } from "../actions";

type View =
  | { readonly kind: "checking" }
  | { readonly kind: "ok"; readonly at: string | null }
  | { readonly kind: "failed"; readonly code: string };

const FAILURE_COPY: Record<string, string> = {
  not_connected: "Sin acceso a Schwab: reconectá la cuenta.",
  http_401: "Schwab rechazó el token: reconectá la cuenta.",
  mass_change_guard:
    "Schwab cambió más de un décimo de lo guardado: la corrida quedó en cuarentena.",
  source_daily_budget_exhausted: "Se agotó la cuota diaria de Schwab.",
  unavailable: "La base de trading no respondió.",
};

/** Pide la sincronización y dice qué mostrar y si releer la página. */
const BUSY_RETRY_MS = 2_000;

async function requestSync(
  force: boolean,
  lastSyncAt: string | null,
): Promise<{
  readonly view: View;
  readonly refresh: boolean;
  readonly busy: boolean;
}> {
  let result: SyncTransactionsResult;
  try {
    result = await syncTransactions({ force });
  } catch {
    result = { state: "unavailable" };
  }
  if (result.state === "synced") {
    return {
      view: { kind: "ok", at: new Date().toISOString() },
      refresh: result.inserted + result.revised + result.withdrawn > 0,
      busy: false,
    };
  }
  if (result.state === "busy") {
    return { view: { kind: "checking" }, refresh: false, busy: true };
  }
  if (result.state === "fresh") {
    return {
      view: { kind: "ok", at: lastSyncAt },
      refresh: false,
      busy: false,
    };
  }
  return {
    view: {
      kind: "failed",
      code: result.state === "unavailable" ? "unavailable" : result.code,
    },
    refresh: false,
    busy: false,
  };
}

/**
 * Pone al día las transacciones al abrir el diario (`F11-05`). Si llegó algo
 * nuevo, relee la página en el lugar. Una falla no se reintenta sola: queda el
 * botón.
 */
export function TransactionSync({
  lastSyncAt,
}: {
  /** El último intento guardado: la hora que se muestra si no se pidió nada. */
  readonly lastSyncAt: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "checking" });
  const [, startTransition] = useTransition();
  const generation = useRef(0);

  const run = useCallback(
    (force: boolean) => {
      const mine = ++generation.current;
      // Si otro pedido tenía el reclamo, se espera a que termine y se relee la
      // página: lo que trajo el otro no llega por esta respuesta.
      const attempt = (waited: boolean) =>
        void requestSync(force && !waited, lastSyncAt).then(
          ({ view: next, refresh, busy }) => {
            if (generation.current !== mine) return;
            if (busy) {
              setTimeout(() => attempt(true), BUSY_RETRY_MS);
              return;
            }
            setView(next);
            if (refresh || waited) startTransition(() => router.refresh());
          },
        );
      attempt(false);
    },
    [lastSyncAt, router],
  );

  useEffect(() => {
    run(false);
    return () => {
      generation.current += 1;
    };
  }, [run]);

  if (view.kind === "checking") {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <RefreshCw
          className="size-4 motion-safe:animate-spin"
          aria-hidden="true"
        />
        Sincronizando
      </span>
    );
  }

  if (view.kind === "ok") {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <CircleCheck
          className="size-4 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        Al día
        {view.at === null ? null : (
          <time dateTime={view.at} className="numeric text-xs">
            {formatClock(view.at)}
          </time>
        )}
      </span>
    );
  }

  return (
    <span role="status" className="inline-flex items-center gap-1 text-sm">
      <CircleAlert
        className="size-4 text-amber-700 dark:text-amber-400"
        aria-hidden="true"
      />
      <span className="text-amber-800 dark:text-amber-300">Sin actualizar</span>
      <InfoTip title="Por qué no se actualizó">
        <p>{FAILURE_COPY[view.code] ?? "Schwab no respondió."}</p>
        <p className="font-mono text-xs">{view.code}</p>
      </InfoTip>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-1"
        onClick={() => {
          setView({ kind: "checking" });
          run(true);
        }}
      >
        Reintentar
      </Button>
    </span>
  );
}
