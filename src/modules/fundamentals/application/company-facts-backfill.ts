import type {
  EgressFetch,
  PacedEgressFetch,
  RequestPacingPolicy,
} from "@/modules/ingestion/application/egress-fetch";
import type { IngestionJobExecutor } from "@/modules/ingestion/application/run-ingestion-job";
import type { IngestionFailureCode } from "@/modules/ingestion/domain/ingestion-failure";
import type {
  IngestionJob,
  IngestionJobAttemptOutcome,
  IngestionJobPlanInput,
  SourceSignalKind,
} from "@/modules/ingestion/domain/ingestion-job";

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

/** Una empresa sólo empieza si el presupuesto cubre su peor caso. */
export function hasBudgetForCompanyFactsLoad(
  fetch: PacedEgressFetch,
  policy: RequestPacingPolicy,
): boolean {
  return (
    fetch.requestCount() + MAX_REQUESTS_PER_COMPANY_FACTS_LOAD <=
    policy.maxRequests
  );
}

export type SourceSignal = {
  readonly kind: SourceSignalKind;
  readonly status: number | null;
  readonly retryAfter: string | null;
  readonly detail: string;
};

/**
 * Egress que falla por la red o por la fuente y no por el documento pedido.
 * `response_too_large` queda afuera: es un filer con un documento enorme, no una
 * fuente caída.
 */
const UNAVAILABLE_EGRESS_CODES: ReadonlySet<string> = new Set([
  "address_unresolvable",
  "deadline_exceeded",
  "transport_error",
]);
const DOCUMENT_EGRESS_CODES: ReadonlySet<string> = new Set([
  "response_too_large",
]);

function egressCode(cause: unknown): string | null {
  const code = (cause as { code?: unknown } | null)?.code;

  return typeof code === "string" ? code : null;
}

/**
 * Observa el egress de la SEC y recuerda la primera señal de la fuente desde la
 * última lectura.
 *
 * - `429` → `throttled`;
 * - `403` → `refused`: en `data.sec.gov` un filer inexistente es `404`, así que un
 *   `403` es la fuente rechazando al cliente —User-Agent o ritmo—, no al filer;
 * - `503`, red caída o sin respuesta → `unavailable`;
 * - cualquier otro bloqueo del egress —allowlist, dirección privada, redirect—
 *   es configuración o una fuente que dejó de ser la aprobada → `refused`.
 *
 * Va **debajo** del espaciador: un presupuesto agotado no es una señal de la
 * fuente, y la reserva por empresa impide que ocurra a mitad de una carga.
 */
export function observeSourceSignals(fetch: EgressFetch): {
  readonly fetch: EgressFetch;
  readonly take: () => SourceSignal | null;
} {
  let signal: SourceSignal | null = null;
  const record = (next: SourceSignal) => {
    signal ??= next;
  };

  return {
    fetch: async (request) => {
      let response;

      try {
        response = await fetch(request);
      } catch (cause) {
        const code = egressCode(cause);

        if (code === null || UNAVAILABLE_EGRESS_CODES.has(code)) {
          record({
            kind: "unavailable",
            status: null,
            retryAfter: null,
            detail: code ?? "egress failed",
          });
        } else if (!DOCUMENT_EGRESS_CODES.has(code)) {
          record({
            kind: "refused",
            status: null,
            retryAfter: null,
            detail: code,
          });
        }

        throw cause;
      }

      const kind: SourceSignalKind | null =
        response.status === 429
          ? "throttled"
          : response.status === 403
            ? "refused"
            : response.status === 503
              ? "unavailable"
              : null;

      if (kind !== null) {
        record({
          kind,
          status: response.status,
          retryAfter: response.retryAfter ?? null,
          detail: `status ${response.status}`,
        });
      }

      return response;
    },
    take: () => {
      const taken = signal;
      signal = null;
      return taken;
    },
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
