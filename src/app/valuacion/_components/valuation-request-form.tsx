"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AssetProfile } from "@/modules/valuation/domain/asset-profile";
import type {
  ValuationJobGap,
  ValuationJobView,
  ValuationSnapshotGap,
} from "@/modules/valuation/domain/valuation-job";
import type { ValuationRunStatus } from "@/modules/valuation/domain/valuation-run";
import type { MethodSelectionReason } from "@/modules/valuation/domain/method-selection";
import type { RigorLevel } from "@/modules/valuation/domain/rigor-level";

import { enqueueValuation } from "../actions";

const POLL_MS = 2_000;

const GAP_COPY: Record<ValuationJobGap, string> = {
  unresolved_ticker: "Ese ticker no está en el universo constituido.",
  ambiguous_ticker: "El ticker corresponde a más de una security.",
  identity_conflict: "El grafo de identidad se contradice para ese ticker.",
  cik_missing:
    "La empresa resuelve, pero no tiene un CIK vigente a este corte.",
  annual_fundamentals:
    "No hay fundamentals guardados. Esta corrida no los descarga.",
  unsupported_method: "El método que le corresponde no está admitido.",
  snapshot_not_assembled:
    "La evaluación está hecha, pero el snapshot de supuestos no se pudo armar. No hay corrida.",
  assessment_failed: "La evaluación no terminó. Se puede volver a encolar.",
  run_recorded:
    "Se registró una corrida con supuestos derivados de lo guardado. Esta página no muestra su valor.",
};

const SNAPSHOT_GAP_COPY: Record<ValuationSnapshotGap, string> = {
  method_not_derived: "este método todavía no tiene una regla de supuestos",
  security_missing: "la empresa no resuelve a una security",
  cost_of_capital_unavailable: "falta el costo de capital fechado",
  normalization_unavailable: "falta el ejercicio base normalizado",
  revenue_history_insufficient:
    "hay menos de tres ejercicios consecutivos de ventas",
  revenue_history_non_positive: "las ventas de la historia no son positivas",
  base_margin_unavailable: "falta el margen operativo del ejercicio base",
  sales_to_capital_unavailable:
    "falta un sales-to-capital positivo del ejercicio base",
  tax_rate_unavailable: "falta la tasa de impuesto del ejercicio base",
  employee_equity_not_proposed:
    "falta la transcripción aceptada de opciones de empleados",
  shares_outstanding_unavailable:
    "faltan las acciones en circulación de la carátula",
  market_unavailable:
    "faltan el precio o la volatilidad para valuar las opciones",
};

const RUN_STATUS_COPY: Record<ValuationRunStatus, string> = {
  computed: "Calculada",
  requires_review: "Calculada, pide revisión",
  rejected: "Rechazada por un policy check",
};

const PROFILE_COPY: Record<AssetProfile, string> = {
  non_financial_mature: "No financiera madura",
  high_growth: "Alto crecimiento",
  loss_making: "Pérdidas persistentes",
  bank: "Banco",
  insurer: "Aseguradora",
  reit: "REIT",
  cyclical: "Cíclica",
  commodity: "Commodity",
  holding: "Holding",
  distressed: "Distress",
};

const RIGOR_COPY: Record<RigorLevel, string> = {
  full: "Pleno",
  standard: "Estándar",
  screening: "Screening",
  unsupported: "No admitido",
};

const REASON_COPY: Record<MethodSelectionReason, string> = {
  missing_classification_evidence: "falta evidencia de clasificación",
  conflicting_evidence: "la evidencia se contradice",
  method_not_implemented: "el método no está implementado",
  missing_required_input: "falta un input requerido",
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
          <dd>{RUN_STATUS_COPY[described.runStatus]}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Regla</dt>
      <dd className="font-mono">{view.ruleVersion}</dd>
    </dl>
  );
}
