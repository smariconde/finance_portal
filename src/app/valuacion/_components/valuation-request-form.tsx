"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ValuationJobView } from "@/modules/valuation/domain/valuation-job";
import type { ValuationRunStatus } from "@/modules/valuation/domain/valuation-run";

import type { ValuationHistoryView } from "@/modules/valuation/application/read-valuation-history";

import { enqueueValuation, loadValuationHistory } from "../actions";
import {
  GAP_COPY,
  PROFILE_COPY,
  REASON_COPY,
  RIGOR_COPY,
  SNAPSHOT_GAP_COPY,
} from "./job-copy";
import { ValuationHistory } from "./valuation-history";

const POLL_MS = 2_000;

const RUN_STATUS_COPY: Record<ValuationRunStatus, string> = {
  computed: "Calculada",
  requires_review: "Calculada, pide revisión",
  rejected: "Rechazada por un policy check",
};

type OpenView = Extract<
  ValuationJobView,
  { state: "queued" | "running" | "completed" }
>;

function formatCutoff(instant: string): string {
  return new Date(instant).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Encola y consulta la misma acción. Consultar no crea otro job.
 */
export function ValuationRequestForm() {
  const [ticker, setTicker] = useState("");
  const [view, setView] = useState<ValuationJobView | { state: "editing" }>({
    state: "editing",
  });
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<ValuationHistoryView | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = ticker;
    setPending(true);
    setHistory(null);

    let intent: "enqueue" | "status" = "enqueue";

    try {
      while (alive.current) {
        let result: ValuationJobView;

        try {
          result = await enqueueValuation({ ticker: submitted, intent });
        } catch {
          result = { state: "unavailable" };
        }

        if (!alive.current) {
          return;
        }

        intent = "status";
        setView(result);

        if (result.state !== "queued" && result.state !== "running") {
          if (result.state !== "unavailable") {
            let past: ValuationHistoryView;

            try {
              past = await loadValuationHistory({ ticker: submitted });
            } catch {
              past = { state: "unavailable" };
            }

            if (alive.current) {
              setHistory(past);
            }
          }

          break;
        }

        await sleep(POLL_MS);
      }
    } finally {
      if (alive.current) {
        setPending(false);
      }
    }
  }

  const open = view.state === "editing" ? null : view;
  const described =
    open !== null && open.state !== "idle" && open.state !== "unavailable"
      ? open
      : null;

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={onSubmit}
      >
        <div className="flex w-full max-w-xs flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="valuation-ticker">
            Ticker
          </label>
          <Input
            id="valuation-ticker"
            name="ticker"
            value={ticker}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            required
            disabled={pending}
            className="max-md:h-11 font-mono uppercase"
            onChange={(event) => setTicker(event.target.value)}
          />
        </div>
        <Button className="max-md:h-11" disabled={pending} type="submit">
          {pending ? "Evaluando" : "Encolar"}
        </Button>
      </form>
      <div aria-live="polite" className="flex flex-col gap-3">
        <JobStatus described={described} view={open} />
      </div>
      <ValuationHistory view={history} />
    </div>
  );
}

function JobStatus({
  view,
  described,
}: {
  readonly view: ValuationJobView | null;
  readonly described: OpenView | null;
}) {
  if (view === null) {
    return (
      <p className="max-w-prose text-sm text-muted-foreground">
        Todavía no hay una corrida en esta página.
      </p>
    );
  }

  if (view.state === "unavailable") {
    return (
      <p className="max-w-prose text-sm" role="status">
        No se pudo encolar. Revisá que el ticker sea un símbolo y que este
        runtime pueda leer la base.
      </p>
    );
  }

  if (view.state === "idle") {
    return (
      <p className="max-w-prose text-sm text-muted-foreground">
        No hay una corrida guardada para ese ticker.
      </p>
    );
  }

  return (
    <dl className="grid max-w-prose grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Estado</dt>
      <dd>
        {view.state === "queued"
          ? "En cola"
          : view.state === "running"
            ? "Evaluando lo guardado"
            : "Terminada"}
      </dd>
      <dt className="text-muted-foreground">Ticker</dt>
      <dd className="font-mono">{view.ticker}</dd>
      <dt className="text-muted-foreground">Corte</dt>
      <dd>{formatCutoff(view.knownAt)} UTC</dd>
      {described?.gap === null ? null : (
        <>
          <dt className="text-muted-foreground">Resultado</dt>
          <dd>
            {described === null || described.gap === null
              ? null
              : GAP_COPY[described.gap]}
          </dd>
        </>
      )}
      {described?.assetProfile === null ||
      described?.assetProfile === undefined ? null : (
        <>
          <dt className="text-muted-foreground">Perfil</dt>
          <dd>{PROFILE_COPY[described.assetProfile]}</dd>
        </>
      )}
      {described?.method === null || described?.method === undefined ? null : (
        <>
          <dt className="text-muted-foreground">Método</dt>
          <dd className="font-mono">{described.method}</dd>
        </>
      )}
      {described?.rigor === null || described?.rigor === undefined ? null : (
        <>
          <dt className="text-muted-foreground">Rigor</dt>
          <dd>{RIGOR_COPY[described.rigor]}</dd>
        </>
      )}
      {described?.unsupportedReason === null ||
      described?.unsupportedReason === undefined ? null : (
        <>
          <dt className="text-muted-foreground">Motivo</dt>
          <dd>{REASON_COPY[described.unsupportedReason]}</dd>
        </>
      )}
      {described?.snapshotGap === null ||
      described?.snapshotGap === undefined ? null : (
        <>
          <dt className="text-muted-foreground">Motivo</dt>
          <dd>{SNAPSHOT_GAP_COPY[described.snapshotGap]}</dd>
        </>
      )}
      {described?.runStatus === null ||
      described?.runStatus === undefined ? null : (
        <>
          <dt className="text-muted-foreground">Corrida</dt>
          <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {RUN_STATUS_COPY[described.runStatus]}
            <Link
              className="text-foreground underline underline-offset-4"
              href={`/valuacion/${encodeURIComponent(view.ticker)}`}
            >
              Ver el resultado
            </Link>
          </dd>
        </>
      )}
      <dt className="text-muted-foreground">Regla</dt>
      <dd className="font-mono">{view.ruleVersion}</dd>
    </dl>
  );
}
