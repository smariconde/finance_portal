import type {
  PacedEgressFetch,
  RequestPacingPolicy,
} from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import type {
  IngestionJobAdmission,
  IngestionJobExecutor,
} from "@/modules/ingestion/application/run-ingestion-job";
import type { SourceBudgetStore } from "@/modules/ingestion/application/source-budget-store";
import type { IngestionFailureCode } from "@/modules/ingestion/domain/ingestion-failure";
import type {
  IngestionJob,
  IngestionJobAttemptOutcome,
  IngestionJobPlanInput,
} from "@/modules/ingestion/domain/ingestion-job";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";

import type { CompanyFactsRefreshSubject } from "../domain/plan-company-facts-refresh";
import {
  COMPANY_FACTS_FORM_SELECTION_VERSION,
  SEC_REFRESH_PROBE_VERSION,
} from "../domain/sec-refresh-decision";
import {
  COMPANY_FACTS_DATASET_ID,
  SubjectNotInUniverseError,
} from "./ingest-company-facts";
import {
  MAX_REQUESTS_PER_COMPANY_FACTS_LOAD,
  SEC_SOURCE_ID,
} from "./live-company-facts-source";
import type { RefreshCompanyFactsOutcome } from "./refresh-company-facts";
import type { SourceSignal } from "./company-facts-backfill";

/**
 * El refresh como job durable (ADR 0015 + ADR 0021).
 *
 * Reusa entera la maquinaria del backfill —lease por fuente, cursor, intentos,
 * poison policy, recuperación manual— y cambia sólo lo que el worker genérico no
 * puede saber: qué plan se pide, cuánto presupuesto reservar antes de empezar un
 * filer, y cómo se lee el resultado de una vuelta.
 *
 * Es un `job_kind` propio y no un backfill con otro plan: el item empieza por un
 * sondeo de `submissions` y sólo a veces termina bajando companyfacts.
 */
export const COMPANY_FACTS_REFRESH_KIND = "sec_companyfacts_refresh";

/**
 * Peor caso de requests de un item: el sondeo más la carga completa. Se reserva
 * antes de empezar, así que la cuota nunca se agota a mitad de un documento; que
 * la mayoría de los items gaste uno solo no cambia la reserva, igual que en el
 * backfill.
 */
export const MAX_REQUESTS_PER_REFRESH_ITEM =
  1 + MAX_REQUESTS_PER_COMPANY_FACTS_LOAD;

export function buildCompanyFactsRefreshJobPlan(
  subjects: readonly CompanyFactsRefreshSubject[],
): IngestionJobPlanInput {
  return {
    kind: COMPANY_FACTS_REFRESH_KIND,
    sourceId: SEC_SOURCE_ID,
    // El dataset del job es lo que mantiene fresco, no lo que descarga para
    // decidirlo: el sondeo pide `sec.submissions` y deja su propia corrida.
    datasetId: COMPANY_FACTS_DATASET_ID,
    parserVersion: SEC_REFRESH_PROBE_VERSION,
    selectionVersion: COMPANY_FACTS_FORM_SELECTION_VERSION,
    subjects: subjects.map((subject) => subject.cik),
  };
}

export class CompanyFactsRefreshJobMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyFactsRefreshJobMismatchError";
  }
}

/**
 * Un job planeado con otro sondeo u otra lista de formularios no se corre con el
 * código actual: sus vueltas dirían haber mirado algo distinto de lo que el plan
 * nombra. Se planea un job nuevo.
 */
export function assertCompanyFactsRefreshJob(job: IngestionJob): void {
  const expected = {
    kind: COMPANY_FACTS_REFRESH_KIND,
    sourceId: SEC_SOURCE_ID,
    datasetId: COMPANY_FACTS_DATASET_ID,
    parserVersion: SEC_REFRESH_PROBE_VERSION,
    selectionVersion: COMPANY_FACTS_FORM_SELECTION_VERSION,
  };

  for (const [field, value] of Object.entries(expected)) {
    const actual = job[field as keyof typeof expected];

    if (actual !== value) {
      throw new CompanyFactsRefreshJobMismatchError(
        `Job ${job.jobId} was planned with ${field} ${String(actual)}; this code runs ${value}.`,
      );
    }
  }
}

/** Un filer sólo empieza si el presupuesto de la corrida cubre su peor caso. */
export function hasBudgetForRefreshItem(
  fetch: PacedEgressFetch,
  policy: RequestPacingPolicy,
): boolean {
  return (
    fetch.requestCount() + MAX_REQUESTS_PER_REFRESH_ITEM <= policy.maxRequests
  );
}

/**
 * Admisión de un filer: el presupuesto de la corrida **y** los dos controles por
 * fuente (ADR 0020), los tres con la misma reserva. Se consulta antes de contar
 * el intento: una fuente frenada o sin cuota no es un problema del sujeto y no
 * lo envenena.
 */
export function createCompanyFactsRefreshAdmission(dependencies: {
  readonly fetch: PacedEgressFetch;
  readonly pacing: RequestPacingPolicy;
  readonly budgets: SourceBudgetStore;
  readonly now: () => string;
}): () => Promise<IngestionJobAdmission> {
  return async () => {
    if (!hasBudgetForRefreshItem(dependencies.fetch, dependencies.pacing)) {
      return { status: "budget_reserve" };
    }

    const verdict = await checkSourceBudget(
      dependencies.budgets,
      SEC_SOURCE_ID,
      MAX_REQUESTS_PER_REFRESH_ITEM,
      dependencies.now(),
    );

    switch (verdict.status) {
      case "allowed":
        return { status: "ready" };
      case "source_disabled":
        return { status: "source_disabled", reason: verdict.reason };
      case "budget_undeclared":
        // Falla cerrado: sin tope declarado no hay cuota que gastar.
        return {
          status: "source_disabled",
          reason: `${SEC_SOURCE_ID} no tiene presupuesto diario declarado`,
        };
      case "daily_budget_exhausted":
        return {
          status: "daily_budget_exhausted",
          resumesAt: verdict.resumesAt,
        };
    }
  };
}

/**
 * Fallos que son de la fuente y no del filer: se repetirían igual en cada item
 * del plan, así que frenan el job en vez de fallar a cada sujeto.
 */
const SOURCE_LEVEL_FAILURES: ReadonlySet<IngestionFailureCode> = new Set([
  "source_not_registered",
  "dataset_not_registered",
  "rights_not_approved",
]);

export function createCompanyFactsRefreshJobExecutor(dependencies: {
  readonly refresh: (cik: string) => Promise<RefreshCompanyFactsOutcome>;
  readonly takeSignal: () => SourceSignal | null;
}): IngestionJobExecutor {
  const { refresh, takeSignal } = dependencies;

  const fromSignal = (
    signal: SourceSignal,
    ingestionRunId: string | null,
  ): IngestionJobAttemptOutcome => ({
    kind: "source_signal",
    signal: signal.kind,
    ingestionRunId,
    retryAfter: signal.retryAfter,
    message: signal.detail,
  });

  return async (item) => {
    // Una señal de un intento anterior no es de este.
    takeSignal();
    let outcome: RefreshCompanyFactsOutcome;

    try {
      outcome = await refresh(item.subjectKey);
    } catch (cause) {
      const signal = takeSignal();

      if (signal !== null) {
        return fromSignal(signal, null);
      }

      if (cause instanceof SubjectNotInUniverseError) {
        return { kind: "subject_rejected", message: cause.message };
      }

      // La fuente quedó frenada a mitad de la vuelta: es una negativa nuestra y
      // no un problema del sujeto, así que difiere sin gastar el intento.
      if (cause instanceof SourceRequestRefusedError) {
        return {
          kind: "source_signal",
          signal: "refused",
          ingestionRunId: null,
          retryAfter: null,
          message: cause.code,
        };
      }

      throw cause;
    }

    if (!outcome.persisted) {
      throw new Error("A refresh attempt must persist its probe run.");
    }

    // La corrida del item es la del sondeo: existe en toda vuelta y lleva la
    // marca de la que partió. La de companyfacts, cuando la hubo, cuelga de la
    // fila de estado (`refresh_run_id`).
    const probeRunId = outcome.probeRun.runId;
    const signal = takeSignal();

    if (outcome.probeRun.status === "failed") {
      if (signal !== null) {
        return fromSignal(signal, probeRunId);
      }

      const failure = outcome.probeRun.failure!;

      if (SOURCE_LEVEL_FAILURES.has(failure.code)) {
        return {
          kind: "source_signal",
          signal: "refused",
          ingestionRunId: probeRunId,
          retryAfter: null,
          message: failure.code,
        };
      }

      return {
        kind: "ingestion_failed",
        ingestionRunId: probeRunId,
        retryable: failure.retryable,
        message: `${failure.code}: ${failure.message}`,
      };
    }

    const ingestion = outcome.ingestion;

    if (ingestion !== null && ingestion.run.status === "failed") {
      // Se sondeó bien pero la descarga falló: la marca no se movió, así que el
      // item se reintenta y la próxima vuelta vuelve a encontrar lo mismo.
      if (signal !== null) {
        return fromSignal(signal, probeRunId);
      }

      const failure = ingestion.run.failure!;

      return {
        kind: "ingestion_failed",
        ingestionRunId: probeRunId,
        retryable: failure.retryable,
        message: `${failure.code}: ${failure.message}`,
      };
    }

    // Sondeado y, si hacía falta, bajado. Un índice en cuarentena también
    // termina acá: repetirlo no lo va a hacer entendible.
    return { kind: "ingested", ingestionRunId: probeRunId };
  };
}
