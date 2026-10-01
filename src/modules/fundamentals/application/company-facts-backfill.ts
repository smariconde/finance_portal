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
import type { SourceSignal } from "@/modules/ingestion/application/source-signals";

import type { CompanyFactsBackfillSubject } from "../domain/plan-company-facts-backfill";
import { SEC_CONCEPT_SELECTION_VERSION } from "../domain/sec-concept-selection";
import {
  COMPANY_FACTS_DATASET_ID,
  COMPANY_FACTS_PIPELINE,
  SubjectNotInUniverseError,
  type IngestCompanyFactsOutcome,
} from "./ingest-company-facts";
import {
  MAX_REQUESTS_PER_COMPANY_FACTS_LOAD,
  SEC_SOURCE_ID,
} from "./live-company-facts-source";

// El observador vivía acá; lo comparten los jobs de la SEC y el de precios.
export {
  observeSourceSignals,
  type SourceSignal,
} from "@/modules/ingestion/application/source-signals";

/**
 * Backfill de companyfacts como job durable (ADR 0015).
 *
 * Este módulo es lo único que el worker genérico no sabe de la SEC: qué plan se
 * pide, cuándo una respuesta es una señal de la fuente y no un problema del
 * filer, y cuánto presupuesto reservar antes de empezar una empresa.
 */
export const COMPANY_FACTS_BACKFILL_KIND = "sec_companyfacts_backfill";

export function buildCompanyFactsJobPlan(
  subjects: readonly CompanyFactsBackfillSubject[],
): IngestionJobPlanInput {
  return {
    kind: COMPANY_FACTS_BACKFILL_KIND,
    sourceId: SEC_SOURCE_ID,
    datasetId: COMPANY_FACTS_DATASET_ID,
    parserVersion: COMPANY_FACTS_PIPELINE.parserVersion,
    selectionVersion: SEC_CONCEPT_SELECTION_VERSION,
    subjects: subjects.map((subject) => subject.cik),
  };
}

export class CompanyFactsJobMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyFactsJobMismatchError";
  }
}

/**
 * Un job planeado con otro pipeline o selección no se corre con el código
 * actual: sus corridas dirían haber ingerido algo distinto de lo que el plan
 * nombra. Se planea un job nuevo.
 */
export function assertCompanyFactsJob(job: IngestionJob): void {
  const expected = {
    kind: COMPANY_FACTS_BACKFILL_KIND,
    sourceId: SEC_SOURCE_ID,
    datasetId: COMPANY_FACTS_DATASET_ID,
    parserVersion: COMPANY_FACTS_PIPELINE.parserVersion,
    selectionVersion: SEC_CONCEPT_SELECTION_VERSION,
  };

  for (const [field, value] of Object.entries(expected)) {
    const actual = job[field as keyof typeof expected];

    if (actual !== value) {
      throw new CompanyFactsJobMismatchError(
        `Job ${job.jobId} was planned with ${field} ${String(actual)}; this code runs ${value}.`,
      );
    }
  }
}

/** Una empresa sólo empieza si el presupuesto de la corrida cubre su peor caso. */
export function hasBudgetForCompanyFactsLoad(
  fetch: PacedEgressFetch,
  policy: RequestPacingPolicy,
): boolean {
  return (
    fetch.requestCount() + MAX_REQUESTS_PER_COMPANY_FACTS_LOAD <=
    policy.maxRequests
  );
}

/**
 * Admisión de una empresa: el presupuesto de la corrida **y** los dos controles
 * por fuente (ADR 0020), los tres con la misma reserva del peor caso.
 *
 * Se consulta antes de contar el intento, así que ninguna de las tres negativas
 * gasta intentos: una fuente frenada o sin cuota no es un problema del sujeto.
 */
export function createCompanyFactsAdmission(dependencies: {
  readonly fetch: PacedEgressFetch;
  readonly pacing: RequestPacingPolicy;
  readonly budgets: SourceBudgetStore;
  readonly now: () => string;
}): () => Promise<IngestionJobAdmission> {
  return async () => {
    if (
      !hasBudgetForCompanyFactsLoad(dependencies.fetch, dependencies.pacing)
    ) {
      return { status: "budget_reserve" };
    }

    const verdict = await checkSourceBudget(
      dependencies.budgets,
      SEC_SOURCE_ID,
      MAX_REQUESTS_PER_COMPANY_FACTS_LOAD,
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
 * Fallos de corrida que son de la fuente y no del filer: se repetirían igual en
 * cada empresa del plan, así que frenan el job en vez de fallar el universo.
 */
const SOURCE_LEVEL_FAILURES: ReadonlySet<IngestionFailureCode> = new Set([
  "source_not_registered",
  "dataset_not_registered",
  "rights_not_approved",
]);

export function createCompanyFactsJobExecutor(dependencies: {
  readonly ingest: (cik: string) => Promise<IngestCompanyFactsOutcome>;
  readonly takeSignal: () => SourceSignal | null;
}): IngestionJobExecutor {
  const { ingest, takeSignal } = dependencies;

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
    let outcome: IngestCompanyFactsOutcome;

    try {
      outcome = await ingest(item.subjectKey);
    } catch (cause) {
      const signal = takeSignal();

      if (signal !== null) {
        return fromSignal(signal, null);
      }

      if (cause instanceof SubjectNotInUniverseError) {
        return { kind: "subject_rejected", message: cause.message };
      }

      // La fuente quedó frenada a mitad de la carga: es una negativa nuestra y
      // no un problema del sujeto, así que difiere sin gastar el intento. La
      // admisión del próximo item la nombra con precisión.
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
      throw new Error("A backfill attempt must persist its ingestion run.");
    }

    const { run } = outcome;
    const signal = takeSignal();

    if (run.status !== "failed") {
      // Publicada, duplicada, vacía o en cuarentena: la corrida ya dice qué pasó
      // y repetirla no lo cambia.
      return { kind: "ingested", ingestionRunId: run.runId };
    }

    if (signal !== null) {
      return fromSignal(signal, run.runId);
    }

    const failure = run.failure!;

    if (SOURCE_LEVEL_FAILURES.has(failure.code)) {
      return {
        kind: "source_signal",
        signal: "refused",
        ingestionRunId: run.runId,
        retryAfter: null,
        message: failure.code,
      };
    }

    return {
      kind: "ingestion_failed",
      ingestionRunId: run.runId,
      retryable: failure.retryable,
      message: `${failure.code}: ${failure.message}`,
    };
  };
}
