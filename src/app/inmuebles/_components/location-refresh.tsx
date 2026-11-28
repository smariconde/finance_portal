"use client";

import { CircleAlert, CirclePause, MapPin, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  refreshListingLocations,
  type LocationRefreshResult,
} from "../actions";

const POLL_MS = 3000;

const BLOCKED_COPY: Readonly<
  Record<Extract<LocationRefreshResult, { state: "blocked" }>["reason"], string>
> = {
  daily_budget_exhausted: "sin cuota hoy",
  source_disabled: "apagada",
  budget_undeclared: "sin cuota declarada",
};

/**
 * Ubica los avisos al abrir la página (`F13-06`): Georef normaliza las
 * direcciones, IDECOR da la parcela y la capa de la Ord. 8256, la
 * Municipalidad los barrios. Sólo se ve mientras trabaja o si algo quedó
 * sin consultar; al terminar relee la página.
 */
export function LocationRefresh() {
  const router = useRouter();
  const [status, setStatus] = useState<LocationRefreshResult | null>(null);
  const worked = useRef(false);

  const ask = useCallback(
    async (retryFailures: boolean) => {
      const next = await refreshListingLocations({ retryFailures });
      setStatus(next);
      if (next.state === "running") worked.current = true;
      else if (worked.current) {
        worked.current = false;
        router.refresh();
      }
      return next;
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async (retry: boolean) => {
      const next = await ask(retry);
      if (!cancelled && next.state === "running")
        timer = setTimeout(() => void loop(false), POLL_MS);
    };
    void loop(false);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [ask]);

  if (
    status === null ||
    status.state === "fresh" ||
    status.state === "unavailable"
  )
    return null;

  if (status.state === "running")
    return (
      <Line icon={RefreshCw} spinning>
        Ubicando avisos
        {status.pending + status.done > 0 ? (
          <span className="numeric text-muted-foreground">
            {" "}
            {status.done} de {status.pending + status.done}
          </span>
        ) : null}
        <Sources />
      </Line>
    );

  if (status.state === "blocked")
    return (
      <Line icon={CirclePause} warning>
        {status.label}: {BLOCKED_COPY[status.reason]}
      </Line>
    );

  return (
    <Line
      icon={CircleAlert}
      warning
      action={
        <button
          type="button"
          onClick={() => {
            void (async () => {
              const next = await ask(true);
              if (next.state === "running") {
                const poll = async () => {
                  const again = await ask(false);
                  if (again.state === "running")
                    setTimeout(() => void poll(), POLL_MS);
                };
                setTimeout(() => void poll(), POLL_MS);
              }
            })();
          }}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Reintentar
        </button>
      }
    >
      Sin consultar: <span className="numeric">{status.failed}</span> ·{" "}
      {status.labels.join(", ")}
    </Line>
  );
}

function Sources() {
  return (
    <InfoTip title="Qué se consulta">
      <p>Georef: calle y altura normalizadas.</p>
      <p>IDECOR: parcela bajo el punto y la Ord. 8256 (FOS, FOT, altura).</p>
      <p>Municipalidad: barrios oficiales.</p>
    </InfoTip>
  );
}

function Line({
  icon: Icon = MapPin,
  spinning = false,
  warning = false,
  action,
  children,
}: {
  readonly icon?: typeof MapPin;
  readonly spinning?: boolean;
  readonly warning?: boolean;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      aria-label="Ubicación de los avisos"
      className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5 text-sm"
    >
      <p role="status" className="flex min-w-0 items-center gap-2">
        <Icon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            warning ? "text-warning" : "text-muted-foreground",
            spinning && "motion-safe:animate-spin",
          )}
        />
        <span className="min-w-0">{children}</span>
      </p>
      {action}
    </section>
  );
}
