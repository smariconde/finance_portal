"use client";

import {
  Check,
  CircleAlert,
  CircleCheck,
  CirclePause,
  Clock,
  RefreshCw,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SourceFreshness } from "@/modules/argentina-dashboard/domain/surface-freshness";

import type { ArgentinaRefreshResult } from "../actions";
import { useRefreshRound } from "./freshness-provider";

type RunningStatus = Extract<ArgentinaRefreshResult, { state: "running" }>;
type BlockedStatus = Extract<ArgentinaRefreshResult, { state: "blocked" }>;

function formatClock(instant: string): string {
  return new Date(instant).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function listOf(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

/** The sources this round asked for, as they stand now. */
function involvedSources(
  sources: readonly SourceFreshness[] | null,
  involved: readonly string[],
): readonly SourceFreshness[] {
  if (sources === null) return [];
  const asked = new Set(involved);
  return sources.filter(
    (source) =>
      asked.has(source.sourceId) ||
      source.state === "failed" ||
      source.state === "blocked",
  );
}

/**
 * Refresh status of `/argentina` (`F9-12`, ADR 0070): one line above the
 * tiles while the sources are asked, with a chip per source that says what
 * it is doing (`F9-22`). When the round ends the line says when, and which
 * source could not be verified, with «Reintentar». Each tile and block says
 * its own state; this line is the summary.
 */
export function ArgentinaRefresh() {
  const { round, sources, involved, renderedFailures, retry } =
    useRefreshRound();
  const chips = involvedSources(sources, involved);

  if (round.kind === "idle" || round.kind === "done") {
    const failed =
      round.kind === "done" ? round.status.failedSources : renderedFailures;
    if (failed.length > 0) {
      return (
        <StatusLine
          icon={CircleAlert}
          tone="warning"
          title={`Sin verificar: ${listOf(failed)}`}
          detail="Se consultó y no trajo datos. Sus cifras son las últimas guardadas."
          action={<RetryButton onRetry={() => retry(true)} />}
        >
          <SourceChips sources={chips} />
        </StatusLine>
      );
    }
    return round.kind === "done" ? (
      <StatusLine
        icon={CircleCheck}
        title={`Fuentes consultadas a las ${formatClock(round.at)}`}
      >
        <SourceChips sources={chips} />
      </StatusLine>
    ) : null;
  }

  if (round.kind === "checking") {
    return (
      <StatusLine icon={RefreshCw} spinning title="Buscando datos nuevos…">
        <SourceChips sources={chips} />
      </StatusLine>
    );
  }

  if (round.kind === "running") {
    return <RunningLine status={round.status} chips={chips} />;
  }
  if (round.kind === "blocked") {
    return <BlockedLine status={round.status} chips={chips} />;
  }

  return (
    <StatusLine
      icon={CircleAlert}
      tone="warning"
      title="No se pudieron actualizar los datos"
      detail="Las cifras son las últimas guardadas."
      action={<RetryButton onRetry={() => retry(false)} />}
    >
      <SourceChips sources={chips} />
    </StatusLine>
  );
}

const CHIP_STATE: Readonly<
  Record<
    SourceFreshness["state"],
    {
      readonly icon: typeof Check;
      readonly text: string;
      readonly className: string;
    }
  >
> = {
  pending: {
    icon: RefreshCw,
    text: "consultando",
    className: "text-muted-foreground",
  },
  checked: {
    icon: Check,
    text: "consultada",
    className: "text-foreground",
  },
  failed: {
    icon: CircleAlert,
    text: "sin datos",
    className:
      "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  blocked: {
    icon: CirclePause,
    text: "frenada",
    className:
      "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
};

/** One capsule per source: its name and what it is doing, icon and word. */
function SourceChips({
  sources,
}: {
  readonly sources: readonly SourceFreshness[];
}) {
  if (sources.length === 0) return null;
  return (
    <ul aria-label="Fuentes" className="flex flex-wrap gap-1.5">
      {sources.map((source) => {
        const chip = CHIP_STATE[source.state];
        const Icon = chip.icon;
        return (
          <li
            key={source.sourceId}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-4xl border bg-background px-2 text-xs whitespace-nowrap",
              chip.className,
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn(
                "size-3 shrink-0",
                source.state === "pending" && "motion-safe:animate-spin",
              )}
            />
            <span className="font-medium">{source.label}</span>
            <span className="sr-only">: {chip.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function RunningLine({
  status,
  chips,
}: {
  readonly status: RunningStatus;
  readonly chips: readonly SourceFreshness[];
}) {
  const waiting = status.waitingUntil;
  return (
    <StatusLine
      icon={waiting === null ? RefreshCw : Clock}
      spinning={waiting === null}
      title={`Actualizando ${listOf(status.sources)}…`}
      detail={
        waiting !== null
          ? `Una fuente pidió esperar; se retoma a las ${formatClock(waiting)}.`
          : undefined
      }
    >
      <SourceChips sources={chips} />
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

function BlockedLine({
  status,
  chips,
}: {
  readonly status: BlockedStatus;
  readonly chips: readonly SourceFreshness[];
}) {
  return (
    <BlockedReason status={status}>
      <SourceChips sources={chips} />
    </BlockedReason>
  );
}

function BlockedReason({
  status,
  children,
}: {
  readonly status: BlockedStatus;
  readonly children: React.ReactNode;
}) {
  switch (status.reason) {
    case "credential_missing":
    case "credential_invalid":
      return (
        <StatusLine
          tone="warning"
          icon={CircleAlert}
          title={`${status.source} necesita un token válido`}
          detail="Configurá INDEC_API_TOKEN en el entorno privado y reiniciá la aplicación. Las demás fuentes pueden seguir actualizándose."
        >
          {children}
        </StatusLine>
      );
    case "daily_budget_exhausted":
      return (
        <StatusLine
          tone="warning"
          icon={CirclePause}
          title={`Se agotó la cuota diaria de ${status.source}`}
          detail={`${status.resumesAt === null ? "Se repone mañana" : `Se repone a las ${formatClock(status.resumesAt)}`}. La página muestra lo que ya estaba guardado.`}
        >
          {children}
        </StatusLine>
      );
    case "source_disabled":
      return (
        <StatusLine
          tone="warning"
          icon={CirclePause}
          title={`La descarga de ${status.source} está frenada`}
          detail="El kill switch de la fuente está activo; se reactiva con pnpm ingestion:sources."
        >
          {children}
        </StatusLine>
      );
    case "budget_undeclared":
      return (
        <StatusLine
          tone="warning"
          icon={CirclePause}
          title={`${status.source} no tiene cuota diaria declarada`}
          detail="Sin cuota declarada la fuente no hace ninguna llamada."
        >
          {children}
        </StatusLine>
      );
    case "job_paused":
      return (
        <StatusLine
          tone="warning"
          icon={CirclePause}
          title={`La actualización de ${status.source} está pausada`}
          detail="Se retoma con pnpm ingestion:jobs."
        >
          {children}
        </StatusLine>
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
  tone = "neutral",
  title,
  detail,
  action,
  children,
}: {
  readonly icon: typeof RefreshCw;
  readonly spinning?: boolean;
  /** `warning`: some figures are not verified; the icon goes amber. */
  readonly tone?: "neutral" | "warning";
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
            "mt-0.5 size-4 shrink-0",
            tone === "warning"
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground",
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
