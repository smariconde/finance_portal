import type { RunIngestionJobResult } from "@/modules/ingestion/application/run-ingestion-job";
import type {
  IngestionJobItem,
  IngestionJobItemCounts,
} from "@/modules/ingestion/domain/ingestion-job";
import { assessReferenceFreshness } from "@/modules/prices/domain/price-freshness";

import {
  auditStepFromReport,
  dataStepBlock,
  valuationDataStepSchema,
  VALUATION_DATA_RULE_VERSION,
  type DataPendingReason,
  type FundamentalsStep,
  type PricesStep,
  type SicStep,
  type ValuationDataStep,
} from "../domain/valuation-data-step";

/**
 * El paso de datos de la corrida (`F6-05`,
 * [ADR 0051](../../../../docs/architecture/adr/0051-on-demand-valuation-data.md)).
 *
 * Baja lo que la evaluación dijo que falta —la ventana de la SEC, el SIC, el
 * cierre del día— y audita el sujeto. Cada descarga es un puerto: la raíz de
 * composición los arma sobre los jobs durables de la ADR 0015, y un test los
 * reemplaza sin red.
 */
export type DurableDownload =
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly code: string }
  | {
      readonly status: "pending";
      readonly reason: DataPendingReason;
      readonly resumesAt: string | null;
    };

export type SicObservation =
  | { readonly status: "observed"; readonly code: string }
  | { readonly status: "not_published" }
  | {
      readonly status: "pending";
      readonly reason: DataPendingReason;
      readonly resumesAt: string | null;
    };

export type SubjectAuditReport = Parameters<typeof auditStepFromReport>[0];

export type ValuationDataDependencies = {
  /** Crea o retoma el job de companyfacts de estos CIKs y lo corre. */
  readonly ingestFundamentals: (
    ciks: readonly string[],
  ) => Promise<DurableDownload>;
  /** Una request a `submissions` y la aserción `sec-sic` si cambió. */
  readonly observeSic: (subject: {
    readonly legalEntityId: string;
    readonly cik: string;
  }) => Promise<SicObservation>;
  readonly ensureCedearPrices?: (securityId: string) => Promise<void>;
  readonly latestClose: (securityId: string) => Promise<string | null>;
  /** Cuándo un job de precios terminado revisó la security por última vez. */
  readonly lastPriceCheck: (securityId: string) => Promise<string | null>;
  readonly ingestPrices: (securityId: string) => Promise<DurableDownload>;
  readonly auditSubjects: (
    subjectIds: readonly string[],
  ) => Promise<SubjectAuditReport>;
  readonly now: () => string;
};

export type ValuationDataRequest = {
  readonly legalEntityId: string;
  readonly cik: string;
  readonly securityId: string | null;
  /** El CIK pedido primero, después sus antecesores de reporte. */
  readonly lineageCiks: readonly string[];
  /** El emisor y sus antecesores: las cadenas que se auditan. */
  readonly lineageSubjectIds: readonly string[];
  readonly needsFundamentals: boolean;
  /**
   * La ventana guardada se bajó con una selección de conceptos anterior a la
   * vigente (`F6-14`): se baja otra vez, una sola, y publica sólo lo nuevo.
   */
  readonly fundamentalsOutdated?: boolean;
  readonly needsSic: boolean;
  /** `false` en un job que continúa a otro: nunca baja, sólo audita. */
  readonly mayDownload: boolean;
};

export async function ensureValuationData(
  request: ValuationDataRequest,
  dependencies: ValuationDataDependencies,
): Promise<ValuationDataStep> {
  const fundamentals = await fundamentalsStep(request, dependencies);
  const sic = await sicStep(request, dependencies);
  const prices = await pricesStep(request, dependencies);
  const blocked = dataStepBlock({ fundamentals, sic }) !== null;

  return valuationDataStepSchema.parse({
    ruleVersion: VALUATION_DATA_RULE_VERSION,
    fundamentals,
    sic,
    prices,
    // Si una descarga quedó a medias, se audita cuando termine: auditar ahora
    // diría «pasó» sobre cadenas que todavía no llegaron.
    audit: blocked
      ? null
      : auditStepFromReport(
          await dependencies.auditSubjects(request.lineageSubjectIds),
        ),
  });
}

async function fundamentalsStep(
  request: ValuationDataRequest,
  dependencies: ValuationDataDependencies,
): Promise<FundamentalsStep> {
  const outdated =
    !request.needsFundamentals && request.fundamentalsOutdated === true;

  if (!request.needsFundamentals && !outdated) {
    return { status: "present" };
  }

  if (!request.mayDownload) {
    // Una ventana vieja sigue sirviendo: el job que continúa no la reemplaza.
    return outdated ? { status: "present" } : { status: "missing" };
  }

  const download = await dependencies.ingestFundamentals(request.lineageCiks);

  if (download.status !== "completed") {
    // Con una ventana vieja guardada, una descarga que no salió no frena:
    // se valúa con lo que hay, como antes de la selección nueva.
    return outdated ? { status: "present" } : download;
  }

  return {
    status: "ingested",
    filers: request.lineageCiks.length,
    ...(outdated ? { selectionOutdated: true as const } : {}),
  };
}

async function sicStep(
  request: ValuationDataRequest,
  dependencies: ValuationDataDependencies,
): Promise<SicStep> {
  if (!request.needsSic) {
    return { status: "present" };
  }

  if (!request.mayDownload) {
    return { status: "missing" };
  }

  return dependencies.observeSic({
    legalEntityId: request.legalEntityId,
    cik: request.cik,
  });
}

/**
 * `ticker-price-freshness-1.0.0`: la regla de la referencia (ADR 0030) sobre
 * una security. Al día si tiene la última rueda asentada o si un job la revisó
 * después de que se asentó.
 */
async function pricesStep(
  request: ValuationDataRequest,
  dependencies: ValuationDataDependencies,
): Promise<PricesStep> {
  const { securityId } = request;

  if (securityId === null) {
    return { status: "not_applicable" };
  }

  if (request.mayDownload) await dependencies.ensureCedearPrices?.(securityId);
  const [latestClose, lastCheckedAt] = await Promise.all([
    dependencies.latestClose(securityId),
    dependencies.lastPriceCheck(securityId),
  ]);
  const freshness = assessReferenceFreshness({
    latestClose,
    lastCheckedAt,
    now: dependencies.now(),
  });

  if (freshness.status === "fresh") {
    return { status: "current", latestClose };
  }

  if (!request.mayDownload) {
    return { status: "missing", latestClose };
  }

  const download = await dependencies.ingestPrices(securityId);

  return download.status === "completed" ? { status: "ingested" } : download;
}

/**
 * Lo que una corrida de un job durable significa para la valuación. Un item
 * que la fuente rechazó es un fallo con su código; cualquier otra parada deja
 * el job abierto para el próximo pedido.
 */
export function classifyDurableRun(input: {
  readonly result: Pick<
    RunIngestionJobResult,
    "stopReason" | "job" | "busyLease" | "waitUntil"
  >;
  readonly counts: IngestionJobItemCounts;
  readonly failedItem: Pick<IngestionJobItem, "lastFailure"> | null;
}): DurableDownload {
  const { result, counts, failedItem } = input;
  const pending = (
    reason: DataPendingReason,
    resumesAt: string | null = null,
  ): DurableDownload => ({ status: "pending", reason, resumesAt });

  if (result.job.status === "completed") {
    if (counts.failed + counts.poisoned > 0) {
      return {
        status: "failed",
        code: failedItem?.lastFailure?.code ?? "unknown_error",
      };
    }

    return { status: "completed" };
  }

  if (result.job.status === "cancelled") {
    return { status: "failed", code: "job_cancelled" };
  }

  if (result.job.status === "paused") {
    return pending("job_paused");
  }

  switch (result.stopReason) {
    case "source_busy":
    case "lease_lost":
      return pending("source_busy", result.busyLease?.expiresAt ?? null);
    case "source_disabled":
      return pending("source_disabled");
    case "daily_budget_exhausted":
      return pending("daily_budget_exhausted", result.waitUntil);
    case "budget_reserve":
      return pending("run_budget");
    default:
      return pending(
        "source_backoff",
        result.waitUntil ?? result.job.notBefore ?? null,
      );
  }
}
