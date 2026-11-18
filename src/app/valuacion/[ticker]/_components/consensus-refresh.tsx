"use client";

import { CircleAlert, CirclePause, Clock, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { refreshConsensus, type ConsensusRefreshResult } from "../../actions";

type View =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | {
      readonly kind: "running";
      readonly status: Extract<ConsensusRefreshResult, { state: "running" }>;
    }
  | {
      readonly kind: "blocked";
      readonly status: Extract<ConsensusRefreshResult, { state: "blocked" }>;
    }
  | { readonly kind: "failed" }
  | { readonly kind: "unavailable" };

const POLL_MS = 2_000;
const MAX_WAIT_POLL_MS = 30_000;

function clock(instant: string): string {
  return new Date(instant).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const BLOCKED_COPY: Record<
  Extract<ConsensusRefreshResult, { state: "blocked" }>["reason"],
  string
> = {
  daily_budget_exhausted: "Cuota diaria de Alpha Vantage agotada",
  source_disabled: "Alpha Vantage frenada por el kill switch",
  budget_undeclared: "Alpha Vantage sin cuota declarada",
  job_paused: "Captura del consenso pausada",
  credential_missing: "Falta ALPHA_VANTAGE_API_KEY",
};

/**
 * Polls the action until nothing is left to wait for. Only the first request
 * carries `retryFailures`: polling never replans a failure. When a job ran,
 * the page is re-read in place.
 */
async function pollConsensus(options: {
  readonly ticker: string;
  readonly retryFailures: boolean;
  readonly alive: () => boolean;
  readonly onView: (view: View) => void;
  readonly onSettled: () => void;
}): Promise<void> {
  let retryFailures = options.retryFailures;
  let polled = false;
  while (options.alive()) {
    let result: ConsensusRefreshResult;
    try {
      result = await refreshConsensus({
        ticker: options.ticker,
        retryFailures,
      });
    } catch {
      result = { state: "unavailable" };
    }
    retryFailures = false;
    if (!options.alive()) return;
    if (result.state === "running") {
      polled = true;
      options.onView({ kind: "running", status: result });
      const wait =
        result.waitingUntil === null
          ? POLL_MS
          : Math.min(
              Math.max(Date.parse(result.waitingUntil) - Date.now(), POLL_MS),
              MAX_WAIT_POLL_MS,
            );
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    if (result.state === "fresh" || result.state === "failed") {
      options.onView(
        result.state === "fresh" ? { kind: "idle" } : { kind: "failed" },
      );
      if (polled) options.onSettled();
    } else if (result.state === "blocked") {
      options.onView({ kind: "blocked", status: result });
    } else {
      options.onView({ kind: "unavailable" });
    }
    return;
  }
}

/**
 * The consensus capture on open (ADR 0083). When the render saw it due, the
 * page calls the action and polls it; on a capture it re-reads the page in
 * place. Only «Reintentar» replans a failure.
 */
export function ConsensusRefresh({
  ticker,
  needsRefresh,
  failed,
}: {
  readonly ticker: string;
  readonly needsRefresh: boolean;
  readonly failed: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(
    needsRefresh
      ? { kind: "checking" }
      : failed
        ? { kind: "failed" }
        : { kind: "idle" },
  );
  const [, startTransition] = useTransition();
  const generation = useRef(0);

  const run = useCallback(
    (retryFailures: boolean) => {
      // Each run invalidates the previous one: an unmount or a retry never
      // leaves two loops polling.
      const mine = ++generation.current;
      void pollConsensus({
        ticker,
        retryFailures,
        alive: () => generation.current === mine,
        onView: setView,
        onSettled: () => startTransition(() => router.refresh()),
      });
    },
    [router, ticker],
  );

  useEffect(() => {
    if (needsRefresh) run(false);
    return () => {
      generation.current += 1;
    };
  }, [needsRefresh, run]);

  if (view.kind === "idle") return null;

  const retry = () => {
    setView({ kind: "checking" });
    run(true);
  };

  if (view.kind === "checking" || view.kind === "running") {
    const waiting = view.kind === "running" ? view.status.waitingUntil : null;
    const title =
      waiting !== null
        ? `Alpha Vantage pidió esperar hasta las ${clock(waiting)}`
        : view.kind === "running" && view.status.other
          ? "Esperando otra captura…"
          : "Actualizando el consenso…";
    return (
      <StatusLine
        icon={waiting === null ? RefreshCw : Clock}
        spinning={waiting === null}
        title={title}
      />
    );
  }

  if (view.kind === "blocked") {
    const resumes = view.status.resumesAt;
    return (
      <StatusLine
        icon={CirclePause}
        title={`${BLOCKED_COPY[view.status.reason]}${resumes === null ? "" : ` · vuelve a las ${clock(resumes)}`}`}
      />
    );
  }

  return (
    <StatusLine
      icon={CircleAlert}
      title={
        view.kind === "failed"
          ? "Sin captura del consenso hoy"
          : "No se pudo actualizar el consenso"
      }
      action={
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          Reintentar
        </Button>
      }
    />
  );
}

function StatusLine({
  icon: Icon,
  spinning = false,
  title,
  action,
}: {
  readonly icon: typeof RefreshCw;
  readonly spinning?: boolean;
  readonly title: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground",
            spinning && "motion-safe:animate-spin",
          )}
        />
        <span role="status">{title}</span>
      </span>
      {action}
    </div>
  );
}
