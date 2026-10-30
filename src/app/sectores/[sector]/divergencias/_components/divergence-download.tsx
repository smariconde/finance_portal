"use client";

import {
  CircleAlert,
  CircleCheck,
  CirclePause,
  Clock,
  Download,
  Info,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  downloadSectorDivergenceData,
  type SectorDivergenceDownloadResult,
} from "../../actions";

type RunningStatus = Extract<
  SectorDivergenceDownloadResult,
  { state: "running" }
>;
type BlockedStatus = Extract<
  SectorDivergenceDownloadResult,
  { state: "blocked" }
>;
type PendingStatus = Extract<
  SectorDivergenceDownloadResult,
  { state: "pending" }
>;
type CompleteStatus = Extract<
  SectorDivergenceDownloadResult,
  { state: "complete" }
>;

/** Lo que el render leyó: lo que un clic bajaría, o una descarga en curso. */
export type DivergenceDownloadInitial =
  PendingStatus | CompleteStatus | RunningStatus | BlockedStatus;

export type SecQuota = {
  readonly disabled: boolean;
  readonly used: number;
  readonly limit: number | null;
  readonly perIssuerCeiling: number;
};

type View =
  | { readonly kind: "initial" }
  | { readonly kind: "checking" }
  | { readonly kind: "running"; readonly status: RunningStatus }
  | { readonly kind: "blocked"; readonly status: BlockedStatus }
  | { readonly kind: "done"; readonly status: CompleteStatus }
  | { readonly kind: "unavailable" };

const POLL_MS = 2_000;
const OTHER_DOWNLOAD_POLL_MS = 4_000;
const MAX_WAIT_POLL_MS = 30_000;

const integer = new Intl.NumberFormat("es-AR");

function pollDelay(status: RunningStatus): number {
  if (status.waitingUntil !== null) {
    const remaining = Date.parse(status.waitingUntil) - Date.now();

    return Math.min(Math.max(remaining, POLL_MS), MAX_WAIT_POLL_MS);
  }

  return status.phase === "other_download" ? OTHER_DOWNLOAD_POLL_MS : POLL_MS;
}

function formatClock(instant: string): string {
  return new Date(instant).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sourceLabel(source: BlockedStatus["source"]): string {
  return source === "sec-edgar" ? "la SEC" : "Yahoo Finance";
}

/** Hasta ocho tickers y el resto contado: la lista nunca empuja la página. */
function listTickers(tickers: readonly string[]): string {
  const shown = tickers.slice(0, 8).join(", ");
  const remaining = tickers.length - 8;

  return remaining > 0 ? `${shown} y ${remaining} más` : shown;
}

/**
 * Consulta la acción hasta que no quede nada que esperar. Cada consulta es un
 * paso idempotente: con la fase SEC terminada, el mismo paso planea los
 * precios. Sólo el primer pedido lleva `retryFailures`.
 */
async function pollDownload(options: {
  readonly sectorCode: string;
  readonly retryFailures: boolean;
  readonly alive: () => boolean;
  readonly onView: (view: View) => void;
}): Promise<void> {
  const { sectorCode, alive, onView } = options;
  let retryFailures = options.retryFailures;

  while (alive()) {
    let result: SectorDivergenceDownloadResult;

    try {
      result = await downloadSectorDivergenceData({
        sectorCode,
        retryFailures,
      });
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
      result.state === "complete"
        ? { kind: "done", status: result }
        : result.state === "blocked"
          ? { kind: "blocked", status: result }
          : // `pending` no vuelve de la acción: siempre planea o describe.
            { kind: "unavailable" },
    );
    return;
  }
}

/**
 * Descarga de lo que le falta a la matriz de divergencias (`F8-02`, ADR 0064).
 *
 * No corre sola: la dispara el owner, porque cuesta cuota SEC. Primero los
 * fundamentales de los filers sin corrida, después siete años de precios donde
 * falta un cierre fiscal; la página se recalcula al cambiar de fase y al
 * terminar. Una descarga del sector ya en curso se sigue al abrir.
 */
export function DivergenceDownload({
  sectorCode,
  initial,
  quota,
  issuers,
}: {
  readonly sectorCode: string;
  readonly initial: DivergenceDownloadInitial;
  readonly quota: SecQuota | null;
  /** Emisores del sector, para decir cuántos tienen fundamentales. */
  readonly issuers: { readonly total: number; readonly covered: number };
}) {
  const router = useRouter();
  const resume =
    initial.state === "running" && initial.phase !== "other_download";
  const [view, setView] = useState<View>(
    resume ? { kind: "running", status: initial } : { kind: "initial" },
  );
  const [, startTransition] = useTransition();
  const generation = useRef(0);
  const phase = useRef<RunningStatus["phase"] | null>(null);

  const run = useCallback(
    (retryFailures: boolean) => {
      // Cada corrida invalida la anterior: un desmontaje o un reintento no deja
      // dos bucles consultando a la vez.
      const mine = ++generation.current;

      void pollDownload({
        sectorCode,
        retryFailures,
        alive: () => generation.current === mine,
        onView: (next) => {
          setView(next);

          const previous = phase.current;
          phase.current = next.kind === "running" ? next.status.phase : null;

          // Al terminar la fase SEC ya hay ejercicios nuevos para mostrar.
          if (
            next.kind === "done" ||
            (previous === "fundamentals" && phase.current === "prices")
          ) {
            startTransition(() => router.refresh());
          }
        },
      });
    },
    [router, sectorCode],
  );

  const start = (retryFailures: boolean) => {
    setView({ kind: "checking" });
    run(retryFailures);
  };

  useEffect(() => {
    if (resume) {
      run(false);
    }

    return () => {
      generation.current += 1;
    };
  }, [resume, run]);

  if (view.kind === "checking") {
    return (
      <StatusLine icon={RefreshCw} spinning title="Revisando qué falta…" />
    );
  }

  if (view.kind === "running") {
    return <RunningLine status={view.status} />;
  }

  if (view.kind === "blocked") {
    return <BlockedLine status={view.status} onContinue={() => start(false)} />;
  }

  if (view.kind === "unavailable") {
    return (
      <StatusLine
        icon={CircleAlert}
        title="No se pudo completar la descarga"
        detail="Lo bajado hasta ahora queda guardado y la matriz lo muestra."
        action={
          <ActionButton onClick={() => start(false)}>Reintentar</ActionButton>
        }
      />
    );
  }

  if (view.kind === "done") {
    return (
      <Failures
        status={view.status}
        onRetry={() => start(true)}
        fallback={<StatusLine icon={CircleCheck} title="Descarga completa." />}
      />
    );
  }

  switch (initial.state) {
    case "complete":
      return (
        <Failures
          status={initial}
          onRetry={() => start(true)}
          fallback={null}
        />
      );
    case "blocked":
      return <BlockedLine status={initial} onContinue={() => start(false)} />;
    case "running":
      // Otra descarga ocupa la fuente: la de este sector espera detrás.
      return (
        <StatusLine
          icon={Clock}
          title="La fuente atiende otra descarga"
          detail="Esta matriz puede pedir lo suyo igual: espera en la cola y empieza cuando la otra termine."
          action={
            <ActionButton onClick={() => start(false)}>
              Bajar lo que falta
            </ActionButton>
          }
        />
      );
    case "pending":
      return (
        <PendingNotice
          status={initial}
          quota={quota}
          issuers={issuers}
          onStart={() => start(false)}
        />
      );
  }
}

function PendingNotice({
  status,
  quota,
  issuers,
  onStart,
}: {
  readonly status: PendingStatus;
  readonly quota: SecQuota | null;
  readonly issuers: { readonly total: number; readonly covered: number };
  readonly onStart: () => void;
}) {
  const missing = issuers.total - issuers.covered;

  // Sólo precios: la SEC ya está y lo que falta es la historia larga.
  if (status.filers === 0) {
    return (
      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>
          {status.priceHistories === 1
            ? "A una security le falta el precio de un cierre fiscal"
            : `A ${integer.format(status.priceHistories)} securities les falta el precio de un cierre fiscal`}
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>
            La matriz de riesgo guarda cinco años de precios y el cierre de hace
            cinco ejercicios queda antes. Bajar siete años cuesta un pedido a
            Yahoo Finance por security.
          </span>
          <span>
            <ActionButton primary onClick={onStart}>
              <Download aria-hidden="true" />
              Bajar 7 años de precios
            </ActionButton>
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  const ceiling = status.filers * (quota?.perIssuerCeiling ?? 0);
  const left =
    quota === null || quota.limit === null
      ? null
      : Math.max(0, quota.limit - quota.used);
  // Cada filer se admite con su peor caso: alcanza con que entre uno hoy.
  const startsToday =
    quota !== null &&
    !quota.disabled &&
    left !== null &&
    left >= quota.perIssuerCeiling;
  const fitsAll = startsToday && left >= ceiling;

  return (
    <Alert>
      <Info aria-hidden="true" />
      <AlertTitle>
        {issuers.covered === 0
          ? `Todavía no hay fundamentales SEC de este sector: 0 de ${integer.format(issuers.total)} emisores`
          : `${integer.format(missing)} de ${integer.format(issuers.total)} emisores sin fundamentales SEC`}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>
          Bajar{" "}
          {status.filers === 1
            ? "su filer"
            : `sus ${integer.format(status.filers)} filers`}{" "}
          cuesta hasta {integer.format(ceiling)} pedidos SEC (
          {quota?.perIssuerCeiling ?? "—"} por filer como máximo; suele ser
          mucho menos).{" "}
          {quota === null || quota.disabled
            ? "La fuente está frenada por el owner."
            : left === null
              ? "La SEC no tiene presupuesto declarado."
              : `Hoy quedan ${integer.format(left)} de ${integer.format(quota.limit!)}${fitsAll ? "." : startsToday ? ": si no alcanza, frena sin perder lo bajado y sigue cuando se reponga." : ": no alcanza para empezar."}`}{" "}
          Después baja siete años de precios donde falte un cierre fiscal.
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ActionButton primary disabled={!startsToday} onClick={onStart}>
            <Download aria-hidden="true" />
            Bajar lo que falta
          </ActionButton>
          {status.failedFilers.length === 0 ? null : (
            <span className="text-xs text-muted-foreground">
              Ya se intentó sin éxito: {listTickers(status.failedFilers)}.
            </span>
          )}
        </span>
      </AlertDescription>
    </Alert>
  );
}

function Failures({
  status,
  onRetry,
  fallback,
}: {
  readonly status: CompleteStatus;
  readonly onRetry: () => void;
  readonly fallback: React.ReactNode;
}) {
  const failed = [...status.failedFilers, ...status.failedPrices];

  if (failed.length === 0) {
    return fallback;
  }

  const parts = [
    status.failedFilers.length === 0
      ? null
      : `fundamentales SEC de ${listTickers(status.failedFilers)}`,
    status.failedPrices.length === 0
      ? null
      : `precios de ${listTickers(status.failedPrices)}`,
  ].filter((part) => part !== null);

  return (
    <StatusLine
      icon={CircleAlert}
      title={`${failed.length === 1 ? "Una descarga quedó" : `${failed.length} descargas quedaron`} sin completar`}
      detail={`La fuente ya fue consultada y no devolvió ${parts.join(" ni ")}. La matriz muestra «Sin valor» donde falta el dato.`}
      action={<ActionButton onClick={onRetry}>Reintentar</ActionButton>}
    />
  );
}

function RunningLine({ status }: { readonly status: RunningStatus }) {
  const waiting = status.waitingUntil;
  const title =
    status.phase === "fundamentals"
      ? "Bajando los fundamentales SEC del sector…"
      : status.phase === "prices"
        ? "Bajando siete años de precios…"
        : "Esperando que termine otra descarga…";
  const detail =
    waiting !== null
      ? `La fuente pidió esperar; se retoma a las ${formatClock(waiting)}.`
      : status.phase === "fundamentals"
        ? "Un filer por vez, a dos pedidos por segundo. Después siguen los precios que falten; la matriz se recalcula en cada fase."
        : status.phase === "prices"
          ? "Sólo las securities sin el precio de un cierre fiscal, una por segundo. La matriz se recalcula al terminar."
          : "La fuente atiende una descarga a la vez; ésta sigue después.";
  const label =
    status.phase === "other_download"
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

function BlockedLine({
  status,
  onContinue,
}: {
  readonly status: BlockedStatus;
  readonly onContinue: () => void;
}) {
  const source = sourceLabel(status.source);
  const kept = "Lo bajado queda guardado y la matriz lo muestra.";

  switch (status.reason) {
    case "daily_budget_exhausted":
      return (
        <StatusLine
          icon={CirclePause}
          title={`Se agotó la cuota diaria de ${source}`}
          detail={`${status.resumesAt === null ? "Se repone mañana" : `Se repone a las ${formatClock(status.resumesAt)}`}. ${kept}`}
          action={
            <ActionButton onClick={onContinue}>Seguir descargando</ActionButton>
          }
        />
      );
    case "source_disabled":
      return (
        <StatusLine
          icon={CirclePause}
          title={`La descarga desde ${source} está frenada`}
          detail={`El kill switch de ${status.source} está activo; se reactiva con pnpm ingestion:sources. ${kept}`}
        />
      );
    case "budget_undeclared":
      return (
        <StatusLine
          icon={CirclePause}
          title={`${source === "la SEC" ? "La SEC" : source} no tiene cuota diaria declarada`}
          detail={`Sin cuota declarada la fuente no hace ninguna llamada. ${kept}`}
        />
      );
    case "job_paused":
      return (
        <StatusLine
          icon={CirclePause}
          title="La descarga está pausada"
          detail={`Se retoma con pnpm ingestion:jobs. ${kept}`}
        />
      );
  }
}

function ActionButton({
  primary = false,
  disabled = false,
  onClick,
  children,
}: {
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        buttonVariants({
          variant: primary ? "default" : "outline",
          size: "sm",
        }),
      )}
    >
      {children}
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
      aria-label="Descarga de datos del sector"
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
