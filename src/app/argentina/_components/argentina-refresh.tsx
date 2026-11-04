"use client";

import {
  CircleAlert,
  CircleCheck,
  CirclePause,
  Clock,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { refreshArgentinaData, type ArgentinaRefreshResult } from "../actions";

type RunningStatus = Extract<ArgentinaRefreshResult, { state: "running" }>;
type BlockedStatus = Extract<ArgentinaRefreshResult, { state: "blocked" }>;
type FreshStatus = Extract<ArgentinaRefreshResult, { state: "fresh" }>;

type View =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "running"; readonly status: RunningStatus }
  | { readonly kind: "blocked"; readonly status: BlockedStatus }
  | { readonly kind: "unavailable" }
  | { readonly kind: "done"; readonly status: FreshStatus };

const POLL_MS = 2_000;
const MAX_WAIT_POLL_MS = 30_000;

function pollDelay(status: RunningStatus): number {
  if (status.waitingUntil === null) return POLL_MS;
  const remaining = Date.parse(status.waitingUntil) - Date.now();
  return Math.min(Math.max(remaining, POLL_MS), MAX_WAIT_POLL_MS);
}

function formatClock(instant: string): string {
  return new Date(instant).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function listOf(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

/**
 * Asks the action until nothing is left to wait for. Only the first request
 * carries `retryFailures`: polling never replans a failure.
 */
async function pollRefresh(options: {
  readonly retryFailures: boolean;
  readonly alive: () => boolean;
  readonly onView: (view: View) => void;
}): Promise<void> {
  let retryFailures = options.retryFailures;
  while (options.alive()) {
    let result: ArgentinaRefreshResult;
    try {
      result = await refreshArgentinaData({ retryFailures });
    } catch {
      result = { state: "unavailable" };
    }
    retryFailures = false;
    if (!options.alive()) return;
    if (result.state === "running") {
      options.onView({ kind: "running", status: result });
      await new Promise((resolve) => setTimeout(resolve, pollDelay(result)));
      continue;
    }
    options.onView(
      result.state === "fresh"
        ? { kind: "done", status: result }
        : result.state === "blocked"
          ? { kind: "blocked", status: result }
          : { kind: "unavailable" },
    );
    return;
  }
}

/**
 * Refresh status of `/argentina` (`F9-12`, ADR 0070). When the server saw
 * something past its cadence, the page asks the Server Action on open and
 * follows it; when it ends, the page is read again with what was stored.
 * The blocks below keep showing the stored data meanwhile.
 */
export function ArgentinaRefresh({
  needsRefresh,
  failedSources,
}: {
  /** The render saw something to ask for, or a refresh in progress. */
  readonly needsRefresh: boolean;
  /** Sources a job checked and could not bring. */
  readonly failedSources: readonly string[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(
    needsRefresh ? { kind: "checking" } : { kind: "idle" },
  );
  const [, startTransition] = useTransition();
  const generation = useRef(0);
  const sawRunning = useRef(false);

  const run = useCallback(
    (retryFailures: boolean) => {
      // Each run invalidates the previous one: an unmount or a retry never
      // leaves two loops polling at once.
      const mine = ++generation.current;
      void pollRefresh({
        retryFailures,
        alive: () => generation.current === mine,
        onView: (next) => {
          if (next.kind === "running") sawRunning.current = true;
          setView(next);
          if (
            (next.kind === "done" || next.kind === "blocked") &&
            sawRunning.current
          ) {
            startTransition(() => router.refresh());
          }
        },
      });
    },
    [router],
  );

  const retry = (retryFailures: boolean) => {
    setView({ kind: "checking" });
    run(retryFailures);
  };

  useEffect(() => {
    if (needsRefresh) run(false);
    return () => {
      generation.current += 1;
    };
  }, [needsRefresh, run]);

  if (view.kind === "idle" || view.kind === "done") {
    const failed =
      view.kind === "done" ? view.status.failedSources : failedSources;
    if (failed.length === 0) {
      return view.kind === "done" ? (
        <StatusLine icon={CircleCheck} title="Datos al día." />
      ) : null;
    }
    return (
      <StatusLine
        icon={CircleAlert}
        title={`No se pudo actualizar todo de ${listOf(failed)}`}
        detail="La fuente ya fue consultada y no respondió con datos nuevos. La página muestra lo último guardado."
        action={<RetryButton onRetry={() => retry(true)} />}
      />
    );
  }

  if (view.kind === "checking") {
    return (
      <StatusLine icon={RefreshCw} spinning title="Buscando datos nuevos…" />
    );
  }

  if (view.kind === "running") return <RunningLine status={view.status} />;
  if (view.kind === "blocked") return <BlockedLine status={view.status} />;

  return (
    <StatusLine
      icon={CircleAlert}
      title="No se pudieron actualizar los datos"
      detail="La página muestra lo que ya estaba guardado."
      action={<RetryButton onRetry={() => retry(false)} />}
    />
  );
}

function RunningLine({ status }: { readonly status: RunningStatus }) {
  const waiting = status.waitingUntil;
  return (
    <StatusLine
      icon={waiting === null ? RefreshCw : Clock}
      spinning={waiting === null}
      title={`Actualizando ${listOf(status.sources)}…`}
      detail={
        waiting !== null
          ? `Una fuente pidió esperar; se retoma a las ${formatClock(waiting)}.`
          : "Revisando cada fuente según su frecuencia. La página se actualiza al terminar."
      }
    >
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label="Progreso de la actualización"
          aria-valuemin={0}
          aria-valuemax={status.total}
          aria-valuenow={status.done}
          aria-valuetext={`${status.done} de ${status.total}`}
          className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{
              width: `${status.total === 0 ? 0 : (status.done / status.total) * 100}%`,
            }}
          />
        </div>
        <span className="numeric text-xs whitespace-nowrap text-muted-foreground">
          {status.done} de {status.total}
          {status.failed > 0 ? ` · ${status.failed} sin actualizar` : null}
        </span>
      </div>
    </StatusLine>
  );
}

function BlockedLine({ status }: { readonly status: BlockedStatus }) {
  switch (status.reason) {
    case "credential_missing":
    case "credential_invalid":
      return (
        <StatusLine
          icon={CircleAlert}
          title={`${status.source} necesita un token válido`}
          detail="Configurá INDEC_API_TOKEN en el entorno privado y reiniciá la aplicación. Las demás fuentes pueden seguir actualizándose."
        />
      );
    case "daily_budget_exhausted":
      return (
        <StatusLine
          icon={CirclePause}
          title={`Se agotó la cuota diaria de ${status.source}`}
          detail={`${status.resumesAt === null ? "Se repone mañana" : `Se repone a las ${formatClock(status.resumesAt)}`}. La página muestra lo que ya estaba guardado.`}
        />
      );
    case "source_disabled":
      return (
        <StatusLine
          icon={CirclePause}
          title={`La descarga de ${status.source} está frenada`}
          detail="El kill switch de la fuente está activo; se reactiva con pnpm ingestion:sources."
        />
      );
    case "budget_undeclared":
      return (
        <StatusLine
          icon={CirclePause}
          title={`${status.source} no tiene cuota diaria declarada`}
          detail="Sin cuota declarada la fuente no hace ninguna llamada."
        />
      );
    case "job_paused":
      return (
        <StatusLine
          icon={CirclePause}
          title={`La actualización de ${status.source} está pausada`}
          detail="Se retoma con pnpm ingestion:jobs."
        />
      );
  }
}

function RetryButton({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
    >
      Reintentar
    </button>
  );
}

function StatusLine({
  icon: Icon,
  spinning = false,
  title,
  detail,
  action,
  children,
}: {
  readonly icon: typeof RefreshCw;
  readonly spinning?: boolean;
  readonly title: string;
  readonly detail?: string;
  readonly action?: React.ReactNode;
  readonly children?: React.ReactNode;
}) {
  return (
    <section
      aria-label="Actualización de datos"
      className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex min-w-0 flex-1 gap-2.5">
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground",
            spinning && "motion-safe:animate-spin",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Only the title is live: the count changes every two seconds. */}
          <p role="status" className="font-medium">
            {title}
          </p>
          {detail === undefined ? null : (
            <p className="text-muted-foreground">{detail}</p>
          )}
          {children}
        </div>
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </section>
  );
}
