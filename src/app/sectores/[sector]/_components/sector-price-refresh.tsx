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

import { refreshSectorPrices, type SectorPriceRefreshResult } from "../actions";

type RunningStatus = Extract<SectorPriceRefreshResult, { state: "running" }>;
type BlockedStatus = Extract<SectorPriceRefreshResult, { state: "blocked" }>;
type FreshStatus = Extract<SectorPriceRefreshResult, { state: "fresh" }>;

type View =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "running"; readonly status: RunningStatus }
  | { readonly kind: "blocked"; readonly status: BlockedStatus }
  | { readonly kind: "unavailable" }
  | { readonly kind: "done"; readonly status: FreshStatus };

const POLL_MS = 2_000;
const OTHER_SECTOR_POLL_MS = 4_000;
const MAX_WAIT_POLL_MS = 30_000;

function pollDelay(status: RunningStatus): number {
  if (status.waitingUntil !== null) {
    const remaining = Date.parse(status.waitingUntil) - Date.now();

    return Math.min(Math.max(remaining, POLL_MS), MAX_WAIT_POLL_MS);
  }

  return status.phase === "other_sector" ? OTHER_SECTOR_POLL_MS : POLL_MS;
}

function formatClock(instant: string): string {
  return new Date(instant).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Consulta la acción hasta que no quede nada que esperar. Sólo el primer pedido
 * lleva `retryFailures`: consultar nunca replanea un cierre faltante.
 */
async function pollSectorPrices(options: {
  readonly sectorCode: string;
  readonly retryFailures: boolean;
  readonly alive: () => boolean;
  readonly onView: (view: View) => void;
}): Promise<void> {
  const { sectorCode, alive, onView } = options;
  let retryFailures = options.retryFailures;

  while (alive()) {
    let result: SectorPriceRefreshResult;

    try {
      result = await refreshSectorPrices({ sectorCode, retryFailures });
    } catch {
      result = { state: "unavailable" };
    }

    retryFailures = false;

    if (!alive()) {
      return;
    }

    if (result.state === "running") {
      onView({ kind: "running", status: result });
      await new Promise((resolve) => setTimeout(resolve, pollDelay(result)));
      continue;
    }

    onView(
      result.state === "fresh"
        ? { kind: "done", status: result }
        : result.state === "blocked"
          ? { kind: "blocked", status: result }
          : { kind: "unavailable" },
    );
    return;
  }
}

export type SectorPriceRefreshProps = {
  readonly sectorCode: string;
  /** El render vio algo que descargar o una descarga en curso. */
  readonly needsRefresh: boolean;
  /** Símbolos ya revisados que siguen sin la rueda. */
  readonly failed: readonly string[];
  /** Rueda pedida, ya formateada; `null` si la referencia no la dio. */
  readonly targetSessionLabel: string | null;
};

/**
 * Estado de la actualización de precios del sector (`F7-08`, ADR 0030).
 *
 * Al abrir la página, si el servidor vio que falta algo, dispara la Server
 * Action y la consulta hasta que no quede nada; entonces vuelve a pedir la
 * página, que recalcula la matriz con lo guardado. Sólo el primer pedido puede
 * reintentar cierres faltantes, y sólo si el owner lo pide: consultar nunca replanea.
 */
export function SectorPriceRefresh({
  sectorCode,
  needsRefresh,
  failed,
  targetSessionLabel,
}: SectorPriceRefreshProps) {
  const router = useRouter();
  const [view, setView] = useState<View>(
    needsRefresh ? { kind: "checking" } : { kind: "idle" },
  );
  const [, startTransition] = useTransition();
  const generation = useRef(0);

  const run = useCallback(
    (retryFailures: boolean) => {
      // Cada corrida invalida la anterior: un desmontaje o un reintento no deja
      // dos bucles consultando a la vez.
      const mine = ++generation.current;

      void pollSectorPrices({
        sectorCode,
        retryFailures,
        alive: () => generation.current === mine,
        onView: (next) => {
          setView(next);

          if (next.kind === "done") {
            startTransition(() => router.refresh());
          }
        },
      });
    },
    [router, sectorCode],
  );

  const retry = (retryFailures: boolean) => {
    setView({ kind: "checking" });
    run(retryFailures);
  };

  useEffect(() => {
    if (needsRefresh) {
      run(false);
    }

    return () => {
      generation.current += 1;
    };
  }, [needsRefresh, run]);

  if (view.kind === "idle" || view.kind === "done") {
    const missing = view.kind === "done" ? view.status.failed : failed;

    if (missing.length === 0) {
      return view.kind === "done" ? (
        <StatusLine icon={CircleCheck} title="Precios al día." />
      ) : null;
    }

    const referenceMissing = missing.includes("^SP500TR");
    const shown = missing.slice(0, 8).join(", ");
    const remaining = missing.length - 8;

    return (
      <StatusLine
        icon={CircleAlert}
        title={
          referenceMissing
            ? "La referencia sigue sin el último cierre"
            : `${missing.length === 1 ? "Una security sigue" : `${missing.length} securities siguen`} sin el cierre${targetSessionLabel === null ? "" : ` del ${targetSessionLabel}`}`
        }
        detail={`Yahoo Finance ya fue consultado, pero ${referenceMissing ? "la referencia" : "estos precios"} siguen sin ese cierre: ${shown}${remaining > 0 ? ` y ${remaining} más` : ""}. La matriz muestra «Sin valor» donde falta el dato.`}
        action={<RetryButton onRetry={() => retry(true)} />}
      />
    );
  }

  if (view.kind === "checking") {
    return <StatusLine icon={RefreshCw} spinning title="Revisando precios…" />;
  }

  if (view.kind === "running") {
    return <RunningLine status={view.status} />;
  }

  if (view.kind === "blocked") {
    return <BlockedLine status={view.status} />;
  }

  return (
    <StatusLine
      icon={CircleAlert}
      title="No se pudieron actualizar los precios"
      detail="La matriz muestra lo que ya estaba guardado."
      action={<RetryButton onRetry={() => retry(false)} />}
    />
  );
}

function RunningLine({ status }: { readonly status: RunningStatus }) {
  const waiting = status.waitingUntil;
  const title =
    status.phase === "reference"
      ? "Actualizando la referencia S&P 500 Total Return…"
      : status.phase === "other_sector"
        ? "Esperando que termine otra descarga…"
        : "Descargando los precios que faltan…";
  const detail =
    waiting !== null
      ? `Yahoo Finance pidió esperar; se retoma a las ${formatClock(waiting)}.`
      : status.phase === "reference"
        ? "Su último cierre es la rueda que se le pide a cada security."
        : status.phase === "other_sector"
          ? "La fuente atiende una descarga a la vez; ésta sigue después."
          : "Sólo las securities sin el último cierre, una por segundo. La matriz se recalcula al terminar.";
  const label =
    status.phase === "other_sector"
      ? "Progreso de la otra descarga"
      : "Progreso de la descarga";

  return (
    <StatusLine
      icon={waiting === null ? RefreshCw : Clock}
      spinning={waiting === null}
      title={title}
      detail={detail}
    >
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={label}
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
          {status.failed > 0 ? ` · ${status.failed} sin descargar` : null}
        </span>
      </div>
    </StatusLine>
  );
}

function BlockedLine({ status }: { readonly status: BlockedStatus }) {
  switch (status.reason) {
    case "daily_budget_exhausted":
      return (
        <StatusLine
          icon={CirclePause}
          title="Se agotó la cuota diaria de Yahoo Finance"
          detail={`${status.resumesAt === null ? "Se repone mañana" : `Se repone a las ${formatClock(status.resumesAt)}`}. La matriz muestra lo que ya estaba guardado.`}
        />
      );
    case "source_disabled":
      return (
        <StatusLine
          icon={CirclePause}
          title="La descarga de precios está frenada"
          detail="El kill switch de yahoo-finance está activo; se reactiva con pnpm ingestion:sources. La matriz muestra lo que ya estaba guardado."
        />
      );
    case "budget_undeclared":
      return (
        <StatusLine
          icon={CirclePause}
          title="Yahoo Finance no tiene cuota diaria declarada"
          detail="Sin cuota declarada la fuente no hace ninguna llamada. La matriz muestra lo que ya estaba guardado."
        />
      );
    case "job_paused":
      return (
        <StatusLine
          icon={CirclePause}
          title="La descarga de precios está pausada"
          detail="Se retoma con pnpm ingestion:jobs. La matriz muestra lo que ya estaba guardado."
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
      aria-label="Actualización de precios"
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
          {/* Sólo el título es región viva: el conteo cambia cada dos segundos. */}
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
