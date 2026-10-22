"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { ValuationJobView } from "@/modules/valuation/domain/valuation-job";
import type { ValuationRunStatus } from "@/modules/valuation/domain/valuation-run";

import { enqueueValuation } from "../actions";
import {
  describeDataStep,
  describeQualitativeStep,
  GAP_COPY,
  SNAPSHOT_GAP_COPY,
} from "./job-copy";

const POLL_MS = 2_000;

const RUN_STATUS_COPY: Record<ValuationRunStatus, string> = {
  computed: "Corrida registrada.",
  requires_review: "Corrida registrada; pide revisión.",
  rejected: "Corrida registrada, rechazada por un control.",
};

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly state: "queued" | "running" }
  | { readonly kind: "done"; readonly message: string }
  | { readonly kind: "failed" };

/**
 * Valuar desde la página del ticker (`F6-12`).
 *
 * Al abrirse, consulta si hay un pedido abierto del ticker —el que encoló la
 * entrada de `/valuacion` o una pestaña anterior— y lo sigue. El botón encola
 * con la misma acción de `F6-01`; cuando el job registra una corrida, la
 * página se vuelve a leer en el lugar, sin un link intermedio. Consultar no
 * crea un job y el render del servidor sigue sin escribir.
 */
export function ValuationRunner({
  ticker,
  hasRun,
}: {
  readonly ticker: string;
  readonly hasRun: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [refreshing, startRefresh] = useTransition();
  const alive = useRef(true);
  const busy = useRef(false);

  async function follow(intent: "enqueue" | "status") {
    if (busy.current) {
      return;
    }

    busy.current = true;
    let next = intent;
    let followed = intent === "enqueue";

    try {
      while (alive.current) {
        let view: ValuationJobView;

        try {
          view = await enqueueValuation({ ticker, intent: next });
        } catch {
          view = { state: "unavailable" };
        }

        if (!alive.current) {
          return;
        }

        next = "status";

        if (view.state === "queued" || view.state === "running") {
          followed = true;
          setPhase({ kind: "working", state: view.state });
          await sleep(POLL_MS);
          continue;
        }

        if (view.state === "unavailable") {
          setPhase({ kind: "failed" });
        } else if (view.state === "completed" && intent === "enqueue") {
          setPhase({
            kind: "done",
            message:
              view.runStatus !== null
                ? RUN_STATUS_COPY[view.runStatus]
                : `No se registró una corrida: ${
                    view.gap === null ? "sin resultado." : GAP_COPY[view.gap]
                  }${view.snapshotGap === null ? "" : ` ${SNAPSHOT_GAP_COPY[view.snapshotGap]}.`}${
                    describeDataStep(view.dataStep) === null
                      ? ""
                      : ` ${describeDataStep(view.dataStep)}`
                  }${
                    describeQualitativeStep(view.qualitativeStep) === null
                      ? ""
                      : ` ${describeQualitativeStep(view.qualitativeStep)}`
                  }`,
          });
        } else if (view.state === "completed" && followed) {
          setPhase({
            kind: "done",
            message:
              view.runStatus !== null
                ? RUN_STATUS_COPY[view.runStatus]
                : "El pedido terminó sin registrar una corrida.",
          });
        }

        // Al abrir la página sólo se sigue un pedido abierto: uno ya
        // terminado es el que la página muestra, y no hace falta releerla.
        if (view.state === "completed" && followed) {
          startRefresh(() => router.refresh());
        }

        return;
      }
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    alive.current = true;
    void follow("status");

    return () => {
      alive.current = false;
    };
    // Sólo al abrir la página del ticker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const working = phase.kind === "working" || refreshing;

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button
        className="max-md:h-11"
        disabled={working}
        onClick={() => void follow("enqueue")}
        type="button"
      >
        {working ? (
          <LoaderCircle
            aria-hidden="true"
            className="motion-safe:animate-spin"
          />
        ) : (
          <RefreshCw aria-hidden="true" />
        )}
        {working ? "Valuando" : hasRun ? "Volver a valuar" : `Valuar ${ticker}`}
      </Button>
      <p
        aria-live="polite"
        className="max-w-xs text-sm text-muted-foreground sm:text-right"
        role="status"
      >
        {phase.kind === "working"
          ? phase.state === "queued"
            ? "En cola: el pedido espera su turno."
            : "Bajando lo que falta, auditando, consultando a la IA si hace falta y valuando: la página se actualiza al terminar."
          : phase.kind === "done"
            ? phase.message
            : phase.kind === "failed"
              ? "No se pudo pedir la valuación: este runtime no pudo leer la base."
              : hasRun
                ? "Baja el cierre del día si falta, audita la empresa, pide a la IA lo cualitativo que falte y vuelve a valuar al corte de hoy."
                : null}
      </p>
    </div>
  );
}
