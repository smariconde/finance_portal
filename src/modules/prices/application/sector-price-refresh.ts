import { z } from "zod";

import type { ClassificationRepository } from "@/modules/classification/application/classification-repository";
import { loadSectorPopulation } from "@/modules/classification/application/load-sector-population";
import { listSectors } from "@/modules/classification/domain/sector-taxonomy";
import { securityTickersAt } from "@/modules/identity/domain/resolve-identity";
import type {
  PacedEgressFetch,
  RequestPacingPolicy,
} from "@/modules/ingestion/application/egress-fetch";
import type { IngestionJobStore } from "@/modules/ingestion/application/ingestion-job-store";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import type {
  IngestionJobAdmission,
  IngestionJobExecutor,
} from "@/modules/ingestion/application/run-ingestion-job";
import type { SourceBudgetStore } from "@/modules/ingestion/application/source-budget-store";
import type { SourceSignal } from "@/modules/ingestion/application/source-signals";
import {
  isTerminalItemStatus,
  type IngestionJob,
  type IngestionJobAttemptOutcome,
  type IngestionJobItem,
  type IngestionJobPlanInput,
} from "@/modules/ingestion/domain/ingestion-job";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { subtractDays } from "@/modules/temporal/domain/calendar-date";
import type { UniverseRepository } from "@/modules/universe/application/universe-repository";

import {
  findDeclaredBenchmark,
  SP500_TOTAL_RETURN_BENCHMARK_ID,
} from "../domain/declared-benchmarks";
import { CHART_PARSER_VERSION } from "../domain/parse-chart-payload";
import {
  assessReferenceFreshness,
  PRICE_FRESHNESS_RULE_VERSION,
  selectStaleSecurities,
  sessionSettledAt,
  type ReferenceFreshness,
} from "../domain/price-freshness";
import { BENCHMARK_DATASET_ID } from "./ingest-benchmark";
import { PRICES_DATASET_ID } from "./ingest-prices";
import { PRICES_SOURCE_ID, PriceSourceError } from "./live-price-source";
import type { PriceRepository } from "./price-repository";

/**
 * Precios de un sector al abrir su matriz (`F7-08`,
 * [ADR 0030](../../../../docs/architecture/adr/0030-sector-prices-on-open.md)).
 *
 * Es un job durable de la ADR 0015 con dos fases que nunca van juntas: primero
 * la referencia, porque su última rueda es la que se le pide a cada security, y
 * después sólo las securities a las que les falta. Lo guardado no se pide otra
 * vez, y lo que un job ya revisó después de asentarse la rueda —también lo que
 * falló— no se replanea solo: un fallo se reintenta cuando el owner lo pide, no
 * en cada visita.
 */
export const PRICE_REFRESH_KIND = "yahoo_prices_refresh";

/** Una request por item: el chart trae la serie entera con splits y dividendos. */
export const MAX_REQUESTS_PER_PRICE_ITEM = 1;

/** Cómo se nombra la referencia en un DTO: la página no ve IDs internos. */
const SP500_TOTAL_RETURN_SYMBOL = "^SP500TR";

/** Jobs terminados que se miran para saber qué ya se revisó. */
const RECENT_JOBS_LIMIT = 25;

export const sectorCodeSchema = z
  .string()
  .refine((code) => listSectors().some((sector) => sector.code === code), {
    message: "Unknown sector code.",
  });

export type PriceRefreshPhase = "reference" | "securities";

export function buildPriceRefreshJobPlan(
  phase: PriceRefreshPhase,
  subjects: readonly string[],
): IngestionJobPlanInput {
  return {
    kind: PRICE_REFRESH_KIND,
    sourceId: PRICES_SOURCE_ID,
    datasetId: phase === "reference" ? BENCHMARK_DATASET_ID : PRICES_DATASET_ID,
    parserVersion: CHART_PARSER_VERSION,
    selectionVersion: PRICE_FRESHNESS_RULE_VERSION,
    subjects: [...subjects],
  };
}

function phaseOf(job: IngestionJob): PriceRefreshPhase {
  return job.datasetId === BENCHMARK_DATASET_ID ? "reference" : "securities";
}

type StaleSecurity = { readonly securityId: string; readonly symbol: string };

/** Una revisión de un sujeto por un job ya terminado. */
type SubjectCheck = {
  readonly checkedAt: string;
  readonly status: IngestionJobItem["status"];
  readonly failureCode: string | null;
};

export type SectorPriceAssessment = {
  readonly sectorCode: string;
  readonly members: number;
  readonly reference: ReferenceFreshness;
  /**
   * La referencia sigue atrasada aunque un job ya la revisó después de la rueda
   * esperada: no se replanea sola, igual que una security que falló.
   */
  readonly referenceUnavailable: boolean;
  /** Todos los miembros al corte, con o sin ticker. */
  readonly memberIds: readonly string[];
  /** Rueda que se le pide a cada security; `null` mientras la referencia esté atrasada. */
  readonly targetSession: string | null;
  /** Securities a descargar, en el orden de la población. */
  readonly stale: readonly StaleSecurity[];
  /** Revisadas después de la rueda y que igual fallaron: no se replanean solas. */
  readonly failed: readonly StaleSecurity[];
  /** Miembros sin ticker vigente: no hay qué pedirle a la fuente. */
  readonly withoutTicker: number;
};

export type SectorPriceDependencies = {
  readonly universe: UniverseRepository;
  readonly classifications: ClassificationRepository;
  readonly prices: PriceRepository;
  readonly jobs: IngestionJobStore;
  readonly now: () => string;
};

/**
 * Revisiones de jobs terminados de este kind, por sujeto, la más reciente
 * primero. Un job cancelado no cuenta: el owner lo frenó, no lo revisó.
 */
async function loadRecentChecks(
  jobs: IngestionJobStore,
): Promise<Map<string, SubjectCheck>> {
  const recent = (
    await jobs.listJobs({
      sourceId: PRICES_SOURCE_ID,
      statuses: ["completed"],
      limit: RECENT_JOBS_LIMIT,
    })
  ).filter((job) => job.kind === PRICE_REFRESH_KIND);

  const checks = new Map<string, SubjectCheck>();

  for (const job of recent) {
    const items = await jobs.listItems({ jobId: job.jobId, limit: 1000 });

    for (const item of items) {
      if (!isTerminalItemStatus(item.status)) {
        continue;
      }

      const previous = checks.get(item.subjectKey);

      // Un item empezó después de crearse su job: el instante de creación es el
      // límite inferior de cuándo se lo revisó.
      if (previous === undefined || previous.checkedAt < job.createdAt) {
        checks.set(item.subjectKey, {
          checkedAt: job.createdAt,
          status: item.status,
          failureCode: item.lastFailure?.code ?? null,
        });
      }
    }
  }

  return checks;
}

function checkedSince(
  check: SubjectCheck | undefined,
  instant: string,
  retryFailures: boolean,
): boolean {
  if (check === undefined || check.checkedAt < instant) {
    return false;
  }

  return !(retryFailures && check.status !== "completed");
}

export async function assessSectorPrices(
  input: { readonly sectorCode: string; readonly retryFailures?: boolean },
  dependencies: SectorPriceDependencies,
): Promise<SectorPriceAssessment> {
  const sectorCode = sectorCodeSchema.parse(input.sectorCode);
  const retryFailures = input.retryFailures ?? false;
  const now = dependencies.now();
  const today = now.slice(0, 10);
  const benchmark = findDeclaredBenchmark(SP500_TOTAL_RETURN_BENCHMARK_ID)!;
  const query = pointInTimeQuerySchema.parse({
    effectiveAt: now,
    revisionPolicy: "as_known",
    knownAt: now,
    sourcePolicyVersion: "source-policy-1.0.0",
  });

  const [{ population, graph }, referenceRows, checks] = await Promise.all([
    loadSectorPopulation(
      { indexId: benchmark.indexId, code: sectorCode, query },
      dependencies,
    ),
    // Dos semanas alcanzan para encontrar la última rueda sin barrer la serie.
    dependencies.prices.loadBenchmarkSeries({
      benchmarkId: benchmark.benchmarkId,
      from: subtractDays(today, 14),
    }),
    loadRecentChecks(dependencies.jobs),
  ]);

  const latestReference = referenceRows.at(-1)?.marketDate ?? null;
  const referenceCheck = checks.get(benchmark.benchmarkId);
  const reference = assessReferenceFreshness({
    latestClose: latestReference,
    lastCheckedAt:
      referenceCheck === undefined ||
      (retryFailures && referenceCheck.status !== "completed")
        ? null
        : referenceCheck.checkedAt,
    now,
  });

  const members: StaleSecurity[] = [];
  let withoutTicker = 0;

  for (const member of population.members) {
    const [ticker] = securityTickersAt(graph, member.securityId, query);

    if (ticker === undefined) {
      withoutTicker += 1;
      continue;
    }

    members.push({ securityId: member.securityId, symbol: ticker.symbol });
  }

  const base = {
    sectorCode,
    members: population.members.length,
    memberIds: population.members.map((member) => member.securityId),
    reference,
    withoutTicker,
  };

  if (reference.status === "stale") {
    return {
      ...base,
      referenceUnavailable: checkedSince(
        referenceCheck,
        sessionSettledAt(reference.expectedSession),
        retryFailures,
      ),
      targetSession: null,
      stale: [],
      failed: [],
    };
  }

  const targetSession = reference.latestClose;
  const settled = sessionSettledAt(targetSession);
  const withTargetClose = new Set(
    await dependencies.prices.listSecuritiesWithClosesSince({
      from: targetSession,
    }),
  );
  const checkedSinceSettled = new Set(
    members
      .filter((member) =>
        checkedSince(checks.get(member.securityId), settled, retryFailures),
      )
      .map((member) => member.securityId),
  );
  const stale = selectStaleSecurities({
    members,
    withTargetClose,
    checkedSinceSettled,
  });
  const failed = members.filter((member) => {
    const check = checks.get(member.securityId);

    return (
      !withTargetClose.has(member.securityId) &&
      check !== undefined &&
      check.checkedAt >= settled &&
      check.status !== "completed"
    );
  });

  return {
    ...base,
    referenceUnavailable: false,
    targetSession,
    stale,
    failed,
  };
}

/**
 * Lo que la página ve de una actualización. Es un DTO mínimo: conteos y códigos,
 * nunca el mensaje de un error, que puede traer un host o una sentencia (`TM-02`).
 */
export type SectorPriceStatus =
  | {
      readonly state: "fresh";
      readonly targetSession: string | null;
      /** Securities que siguen sin la rueda después de revisarlas. */
      readonly failed: readonly string[];
    }
  | {
      readonly state: "running";
      readonly jobId: string;
      /** `other_sector`: la fuente está ocupada con la descarga de otro sector. */
      readonly phase: PriceRefreshPhase | "other_sector";
      readonly done: number;
      readonly total: number;
      readonly failed: number;
      /** La fuente pidió esperar hasta este instante. */
      readonly waitingUntil: string | null;
    }
  | {
      readonly state: "blocked";
      readonly reason:
        | "source_disabled"
        | "daily_budget_exhausted"
        | "job_paused"
        | "budget_undeclared";
      readonly resumesAt: string | null;
    };

export type EnsureSectorPricesResult = {
  readonly status: SectorPriceStatus;
  /** Si hay que arrancar un worker para el job abierto. */
  readonly runJobId: string | null;
};

export type EnsureSectorPricesDependencies = SectorPriceDependencies & {
  readonly budgets: SourceBudgetStore;
  /** Si este proceso ya tiene un worker corriendo para la fuente. */
  readonly workerActive: () => boolean;
};

async function admissionBlock(
  budgets: SourceBudgetStore,
  now: string,
): Promise<SectorPriceStatus | null> {
  const verdict = await checkSourceBudget(
    budgets,
    PRICES_SOURCE_ID,
    MAX_REQUESTS_PER_PRICE_ITEM,
    now,
  );

  switch (verdict.status) {
    case "allowed":
      return null;
    case "source_disabled":
      return { state: "blocked", reason: "source_disabled", resumesAt: null };
    case "budget_undeclared":
      return { state: "blocked", reason: "budget_undeclared", resumesAt: null };
    case "daily_budget_exhausted":
      return {
        state: "blocked",
        reason: "daily_budget_exhausted",
        resumesAt: verdict.resumesAt,
      };
  }
}

async function describeOpenJob(
  job: IngestionJob,
  sectorMembers: ReadonlySet<string>,
  dependencies: EnsureSectorPricesDependencies,
): Promise<EnsureSectorPricesResult> {
  const { jobs, budgets } = dependencies;
  const now = dependencies.now();

  if (job.status === "paused") {
    return {
      status: { state: "blocked", reason: "job_paused", resumesAt: null },
      runJobId: null,
    };
  }

  const [counts, next, lease] = await Promise.all([
    jobs.countItems(job.jobId),
    jobs.peekNext(job.jobId),
    jobs.getLease(PRICES_SOURCE_ID),
  ]);

  let phase: PriceRefreshPhase | "other_sector" = phaseOf(job);

  if (phase === "securities") {
    const [first] = await jobs.listItems({ jobId: job.jobId, limit: 1 });

    if (first !== undefined && !sectorMembers.has(first.subjectKey)) {
      phase = "other_sector";
    }
  }

  const waits = [job.notBefore, next.item?.notBefore ?? null].filter(
    (instant): instant is string =>
      instant !== null && Date.parse(instant) > Date.parse(now),
  );
  const waitingUntil = waits.sort().at(-1) ?? null;
  const leaseLive =
    lease !== null && Date.parse(lease.expiresAt) > Date.parse(now);

  let runJobId: string | null = null;

  if (waitingUntil === null && !leaseLive && !dependencies.workerActive()) {
    const blocked = await admissionBlock(budgets, now);

    if (blocked !== null) {
      return { status: blocked, runJobId: null };
    }

    runJobId = job.jobId;
  }

  return {
    status: {
      state: "running",
      jobId: job.jobId,
      phase,
      done: counts.completed + counts.failed + counts.poisoned,
      total: job.itemCount,
      failed: counts.failed + counts.poisoned,
      waitingUntil,
    },
    runJobId,
  };
}

/**
 * Un paso de la actualización: si hay un job de precios abierto, su estado; si
 * no, lo que falta —referencia primero— como job nuevo; si no falta nada,
 * `fresh`. Es idempotente: llamarlo dos veces no crea dos jobs, porque mientras
 * uno está abierto no se planea otro, y un plan igual devuelve el existente.
 */
export async function ensureSectorPrices(
  input: { readonly sectorCode: string; readonly retryFailures?: boolean },
  dependencies: EnsureSectorPricesDependencies,
): Promise<EnsureSectorPricesResult> {
  const sectorCode = sectorCodeSchema.parse(input.sectorCode);
  const { jobs } = dependencies;

  const open = (
    await jobs.listJobs({
      sourceId: PRICES_SOURCE_ID,
      statuses: ["open", "paused"],
      limit: 10,
    })
  ).filter((job) => job.kind === PRICE_REFRESH_KIND);

  const assessment = await assessSectorPrices(
    { sectorCode, retryFailures: input.retryFailures },
    dependencies,
  );

  // El más viejo primero: es el que la fuente está procesando o va a procesar.
  const current = open.at(-1);

  const sectorMembers = new Set(assessment.memberIds);

  if (current !== undefined) {
    return describeOpenJob(current, sectorMembers, dependencies);
  }

  if (assessment.referenceUnavailable) {
    return {
      status: {
        state: "fresh",
        targetSession: null,
        failed: [SP500_TOTAL_RETURN_SYMBOL],
      },
      runJobId: null,
    };
  }

  let plan: IngestionJobPlanInput | null = null;

  if (assessment.reference.status === "stale") {
    plan = buildPriceRefreshJobPlan("reference", [
      SP500_TOTAL_RETURN_BENCHMARK_ID,
    ]);
  } else if (assessment.stale.length > 0) {
    plan = buildPriceRefreshJobPlan(
      "securities",
      assessment.stale.map((member) => member.securityId),
    );
  }

  if (plan === null) {
    return {
      status: {
        state: "fresh",
        targetSession: assessment.targetSession,
        failed: assessment.failed.map((member) => member.symbol),
      },
      runJobId: null,
    };
  }

  // Antes de planear: una fuente frenada o sin cuota no deja un job abierto que
  // nadie puede correr.
  const blocked = await admissionBlock(
    dependencies.budgets,
    dependencies.now(),
  );

  if (blocked !== null) {
    return { status: blocked, runJobId: null };
  }

  const { job } = await jobs.createJob(plan, { now: dependencies.now() });

  return describeOpenJob(job, sectorMembers, dependencies);
}

export class PriceRefreshJobMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceRefreshJobMismatchError";
  }
}

/**
 * Un job planeado con otra regla o con otro parser no se corre con el código
 * actual: diría haber revisado algo distinto de lo que el plan nombra.
 */
export function assertPriceRefreshJob(job: IngestionJob): void {
  const expected = {
    kind: PRICE_REFRESH_KIND,
    sourceId: PRICES_SOURCE_ID,
    parserVersion: CHART_PARSER_VERSION,
    selectionVersion: PRICE_FRESHNESS_RULE_VERSION,
  };

  for (const [field, value] of Object.entries(expected)) {
    const actual = job[field as keyof typeof expected];

    if (actual !== value) {
      throw new PriceRefreshJobMismatchError(
        `Job ${job.jobId} was planned with ${field} ${String(actual)}; this code runs ${value}.`,
      );
    }
  }
}

/**
 * Admisión de un item: el presupuesto de la corrida y los dos controles por
 * fuente de la ADR 0020, con la reserva de una request.
 */
export function createPriceRefreshAdmission(dependencies: {
  readonly fetch: PacedEgressFetch;
  readonly pacing: RequestPacingPolicy;
  readonly budgets: SourceBudgetStore;
  readonly now: () => string;
}): () => Promise<IngestionJobAdmission> {
  return async () => {
    if (
      dependencies.fetch.requestCount() + MAX_REQUESTS_PER_PRICE_ITEM >
      dependencies.pacing.maxRequests
    ) {
      return { status: "budget_reserve" };
    }

    const blocked = await admissionBlock(
      dependencies.budgets,
      dependencies.now(),
    );

    if (blocked === null) {
      return { status: "ready" };
    }

    if (
      blocked.state === "blocked" &&
      blocked.reason === "daily_budget_exhausted"
    ) {
      return {
        status: "daily_budget_exhausted",
        resumesAt: blocked.resumesAt!,
      };
    }

    return {
      status: "source_disabled",
      reason:
        blocked.state === "blocked" && blocked.reason === "budget_undeclared"
          ? `${PRICES_SOURCE_ID} no tiene presupuesto diario declarado`
          : `${PRICES_SOURCE_ID} está frenada por el owner`,
    };
  };
}

export class PriceSubjectUnresolvedError extends Error {
  constructor(securityId: string) {
    super(`Security ${securityId} has no current ticker.`);
    this.name = "PriceSubjectUnresolvedError";
  }
}

/** Errores de la fuente que se repetirían igual en cada item del plan. */
const SOURCE_LEVEL_PRICE_ERRORS = new Set([
  "source_not_registered",
  "rights_not_approved",
]);

export function createPriceRefreshJobExecutor(dependencies: {
  /** Ingresa la serie de una security; devuelve la corrida registrada. */
  readonly ingestSecurity: (securityId: string) => Promise<string>;
  /** Ingresa la referencia; devuelve la corrida registrada. */
  readonly ingestBenchmark: (benchmarkId: string) => Promise<string>;
  readonly takeSignal: () => SourceSignal | null;
}): IngestionJobExecutor {
  const { ingestSecurity, ingestBenchmark, takeSignal } = dependencies;

  return async (item, job) => {
    // Una señal de un intento anterior no es de este.
    takeSignal();

    try {
      const runId =
        phaseOf(job) === "reference"
          ? await ingestBenchmark(item.subjectKey)
          : await ingestSecurity(item.subjectKey);

      return { kind: "ingested", ingestionRunId: runId };
    } catch (cause) {
      return classifyPriceFailure(cause, takeSignal());
    }
  };
}

function classifyPriceFailure(
  cause: unknown,
  signal: SourceSignal | null,
): IngestionJobAttemptOutcome {
  if (signal !== null) {
    return {
      kind: "source_signal",
      signal: signal.kind,
      ingestionRunId: null,
      retryAfter: signal.retryAfter,
      message: signal.detail,
    };
  }

  // Una negativa nuestra —kill switch o cuota— no es un problema del sujeto.
  if (cause instanceof SourceRequestRefusedError) {
    return {
      kind: "source_signal",
      signal: "refused",
      ingestionRunId: null,
      retryAfter: null,
      message: cause.code,
    };
  }

  if (cause instanceof PriceSubjectUnresolvedError) {
    return { kind: "subject_rejected", message: cause.message };
  }

  if (cause instanceof PriceSourceError) {
    if (SOURCE_LEVEL_PRICE_ERRORS.has(cause.code)) {
      return {
        kind: "source_signal",
        signal: "refused",
        ingestionRunId: null,
        retryAfter: null,
        message: cause.code,
      };
    }

    // Un payload que el parser rechaza no cambia por pedirlo de nuevo.
    if (cause.code === "payload_rejected") {
      return { kind: "subject_rejected", message: cause.message };
    }

    return { kind: "executor_error", message: cause.message };
  }

  throw cause;
}

export type SectorPriceReadiness = {
  /** Hay algo que descargar, o una descarga en curso que seguir. */
  readonly needsRefresh: boolean;
  /** Rueda que se le pide a cada security; `null` si la referencia no la dio. */
  readonly targetSession: string | null;
  /** Símbolos que ya se revisaron y siguen sin la rueda. */
  readonly failed: readonly string[];
};

/**
 * Lo que el render necesita saber, **sin escribir nada**: una página no planea
 * jobs ni sale a la red mientras se dibuja. Disparar la descarga es de la
 * Server Action.
 */
export async function readSectorPriceReadiness(
  input: { readonly sectorCode: string },
  dependencies: SectorPriceDependencies,
): Promise<SectorPriceReadiness> {
  const [assessment, open] = await Promise.all([
    assessSectorPrices(input, dependencies),
    dependencies.jobs.listJobs({
      sourceId: PRICES_SOURCE_ID,
      statuses: ["open"],
      limit: 10,
    }),
  ]);

  const running = open.some((job) => job.kind === PRICE_REFRESH_KIND);
  const pending =
    (assessment.reference.status === "stale" &&
      !assessment.referenceUnavailable) ||
    assessment.stale.length > 0;

  return {
    needsRefresh: running || pending,
    targetSession: assessment.targetSession,
    failed: [
      ...(assessment.referenceUnavailable ? [SP500_TOTAL_RETURN_SYMBOL] : []),
      ...assessment.failed.map((member) => member.symbol),
    ],
  };
}
