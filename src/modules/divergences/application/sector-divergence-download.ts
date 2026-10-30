import type { ClassificationRepository } from "@/modules/classification/application/classification-repository";
import { loadSectorPopulation } from "@/modules/classification/application/load-sector-population";
import type { LegalEntityRelationship } from "@/modules/corporate-actions/domain/reporting-succession";
import {
  buildCompanyFactsJobPlan,
  COMPANY_FACTS_BACKFILL_KIND,
} from "@/modules/fundamentals/application/company-facts-backfill";
import { COMPANY_FACTS_DATASET_ID } from "@/modules/fundamentals/application/ingest-company-facts";
import {
  MAX_REQUESTS_PER_COMPANY_FACTS_LOAD,
  SEC_SOURCE_ID,
} from "@/modules/fundamentals/application/live-company-facts-source";
import { planCompanyFactsBackfill } from "@/modules/fundamentals/domain/plan-company-facts-backfill";
import type { IngestionJobStore } from "@/modules/ingestion/application/ingestion-job-store";
import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import type { SourceBudgetStore } from "@/modules/ingestion/application/source-budget-store";
import {
  isTerminalItemStatus,
  type IngestionJob,
  type IngestionJobPlanInput,
} from "@/modules/ingestion/domain/ingestion-job";
import { PRICES_DATASET_ID } from "@/modules/prices/application/ingest-prices";
import { PRICES_SOURCE_ID } from "@/modules/prices/application/live-price-source";
import {
  buildFiscalPriceHistoryJobPlan,
  isFiscalPriceHistoryJob,
  MAX_REQUESTS_PER_PRICE_ITEM,
  PRICE_REFRESH_KIND,
  sectorCodeSchema,
} from "@/modules/prices/application/sector-price-refresh";
import { assessFiscalPriceHistory } from "@/modules/prices/domain/fiscal-price-history";
import {
  pointInTimeQuerySchema,
  type PointInTimeQuery,
} from "@/modules/temporal/domain/point-in-time-query";
import type { UniverseRepository } from "@/modules/universe/application/universe-repository";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";

import { FISCAL_PRICE_MAX_LAG_DAYS } from "../domain/fiscal-endpoints";
import { sectorFilers } from "../domain/sector-filer-plan";

import type { SectorFiscalReading } from "./load-sector-fiscal-endpoints";

/**
 * Lo que la matriz de divergencias de un sector necesita bajar (`F8-02`,
 * [ADR 0064](../../../../docs/architecture/adr/0064-sector-divergence-download.md)).
 *
 * Dos fases que nunca van juntas, como los precios de la ADR 0030: primero
 * companyfacts de los filers del sector sin corrida anclada —el job SEC de la
 * ADR 0015—, y después siete años de precios para las securities a las que les
 * falta el cierre fiscal de un par, porque cuáles son sólo se sabe con los
 * ejercicios guardados. Lo ya pedido no se pide otra vez: un filer con ancla o
 * revisado por un job terminado, y una security pedida desde antes de su
 * cierre, quedan fuera. Una falla se nombra y se reintenta sólo si el owner lo
 * pide.
 *
 * Cada empresa se admite con la reserva de su peor caso (ADR 0020): si la cuota
 * del día no alcanza para todo el sector, el job frena sin gastar intentos y la
 * página ofrece seguir cuando se reponga.
 */
export const SECTOR_DIVERGENCE_DOWNLOAD_VERSION =
  "sector-divergence-download-1.0.0";

/** Jobs terminados que se miran para saber qué ya se revisó. */
const RECENT_JOBS_LIMIT = 25;

export type DivergenceDownloadPhase = "fundamentals" | "prices";

/**
 * Lo que la página ve: conteos, tickers y códigos, nunca un mensaje de error
 * ni un ID interno (`TM-02`).
 */
export type SectorDivergenceDownloadStatus =
  | {
      /** Nada que bajar: lo que falta se pidió y la fuente no lo tiene. */
      readonly state: "complete";
      readonly failedFilers: readonly string[];
      readonly failedPrices: readonly string[];
    }
  | {
      /** Sólo en la lectura del render: lo que un clic bajaría. */
      readonly state: "pending";
      readonly filers: number;
      readonly priceHistories: number;
      readonly failedFilers: readonly string[];
      readonly failedPrices: readonly string[];
    }
  | {
      readonly state: "running";
      /** `other_download`: la fuente atiende otra descarga; ésta sigue después. */
      readonly phase: DivergenceDownloadPhase | "other_download";
      readonly done: number;
      readonly total: number;
      readonly failed: number;
      readonly waitingUntil: string | null;
    }
  | {
      readonly state: "blocked";
      readonly source: typeof SEC_SOURCE_ID | typeof PRICES_SOURCE_ID;
      readonly reason:
        | "source_disabled"
        | "daily_budget_exhausted"
        | "job_paused"
        | "budget_undeclared";
      readonly resumesAt: string | null;
    };

export type EnsureSectorDivergenceDownloadResult = {
  readonly status: SectorDivergenceDownloadStatus;
  /** El job que hay que correr en este proceso, si no lo corre nadie. */
  readonly run: {
    readonly source: typeof SEC_SOURCE_ID | typeof PRICES_SOURCE_ID;
    readonly jobId: string;
  } | null;
};

export type SectorDivergenceDownloadDependencies = {
  readonly universe: UniverseRepository;
  readonly classifications: ClassificationRepository;
  readonly listRelationships: () => Promise<readonly LegalEntityRelationship[]>;
  readonly ingestionRuns: IngestionRunRepository;
  readonly jobs: IngestionJobStore;
  readonly budgets: SourceBudgetStore;
  /** La lectura guardada del sector: dice qué cierres fiscales no tienen precio. */
  readonly readFiscal: (sectorCode: string) => Promise<SectorFiscalReading>;
  readonly now: () => string;
  /** Si este proceso ya corre un worker para la fuente. */
  readonly workerActive: (
    source: typeof SEC_SOURCE_ID | typeof PRICES_SOURCE_ID,
  ) => boolean;
};

type Check = { readonly status: "completed" | "failed" };

/**
 * La última revisión terminada de cada sujeto en los jobs recientes de un tipo.
 * Un job ya terminado es el límite: lo que revisó no se replanea solo.
 */
async function recentChecks(
  jobs: IngestionJobStore,
  sourceId: string,
  matches: (job: IngestionJob) => boolean,
): Promise<Map<string, Check>> {
  const recent = (
    await jobs.listJobs({
      sourceId,
      statuses: ["completed"],
      limit: RECENT_JOBS_LIMIT,
    })
  ).filter(matches);
  const checks = new Map<string, Check>();

  // Del más nuevo al más viejo: la primera revisión que aparece es la última.
  for (const job of recent) {
    for (const item of await jobs.listItems({
      jobId: job.jobId,
      limit: 1000,
    })) {
      if (!isTerminalItemStatus(item.status) || checks.has(item.subjectKey)) {
        continue;
      }

      checks.set(item.subjectKey, {
        status: item.status === "completed" ? "completed" : "failed",
      });
    }
  }

  return checks;
}

function cutoffAt(instant: string): PointInTimeQuery {
  return pointInTimeQuerySchema.parse({
    effectiveAt: instant,
    revisionPolicy: "as_known",
    knownAt: instant,
    sourcePolicyVersion: "source-policy-1.0.0",
  });
}

type FilerAssessment = {
  /** Securities del sector, para saber si un job abierto es de este sector. */
  readonly securityIds: ReadonlySet<string>;
  readonly ciks: ReadonlySet<string>;
  readonly missing: readonly string[];
  readonly failed: readonly { readonly cik: string; readonly label: string }[];
};

async function assessFilers(
  sectorCode: string,
  retryFailures: boolean,
  dependencies: SectorDivergenceDownloadDependencies,
): Promise<FilerAssessment> {
  const cutoff = cutoffAt(dependencies.now());
  const [{ population }, state, relationships] = await Promise.all([
    loadSectorPopulation(
      { indexId: SP500_INDEX_ID, code: sectorCode, query: cutoff },
      dependencies,
    ),
    dependencies.universe.loadState({ indexId: SP500_INDEX_ID }),
    dependencies.listRelationships(),
  ]);
  const plan = planCompanyFactsBackfill({
    graph: state.graph,
    memberships: state.memberships,
    relationships,
    indexId: SP500_INDEX_ID,
    cutoff,
  });
  const filers = sectorFilers(population.members, plan.subjects);
  const anchored = await Promise.all(
    filers.map((filer) =>
      dependencies.ingestionRuns.findLatestAnchored(
        SEC_SOURCE_ID,
        COMPANY_FACTS_DATASET_ID,
        filer.cik,
      ),
    ),
  );
  const unanchored = filers.filter((_, index) => anchored[index] === null);
  // Sólo se miran los jobs si hay algo sin ancla: es lo único que pueden explicar.
  const checks =
    unanchored.length === 0
      ? new Map<string, Check>()
      : await recentChecks(
          dependencies.jobs,
          SEC_SOURCE_ID,
          (job) => job.kind === COMPANY_FACTS_BACKFILL_KIND,
        );
  const failed = unanchored.filter(
    (filer) => checks.get(filer.cik)?.status === "failed",
  );

  return {
    securityIds: new Set(population.members.map((m) => m.securityId)),
    ciks: new Set(filers.map((filer) => filer.cik)),
    missing: unanchored
      .filter((filer) => {
        const check = checks.get(filer.cik);
        return (
          check === undefined || (retryFailures && check.status === "failed")
        );
      })
      .map((filer) => filer.cik),
    failed: retryFailures
      ? []
      : failed.map((filer) => ({
          cik: filer.cik,
          label: filer.symbols.join("/") || filer.cik,
        })),
  };
}

type PriceAssessment = {
  readonly missing: readonly string[];
  readonly failed: readonly string[];
};

/**
 * Securities con un cierre fiscal sin precio que siete años alcanzarían. Mira
 * los dos horizontes: el par a dos años también puede caer fuera de cinco
 * años si el último ejercicio cerró hace más de uno.
 */
async function assessPriceHistories(
  reading: SectorFiscalReading,
  retryFailures: boolean,
  dependencies: SectorDivergenceDownloadDependencies,
): Promise<PriceAssessment> {
  const today = dependencies.now().slice(0, 10);
  const candidates: { securityId: string; ticker: string; from: string }[] = [];

  for (const member of reading.members) {
    if (member.ticker === null) {
      continue;
    }

    const earliest = [member.twoYears.earlier, member.fiveYears.earlier]
      .filter((endpoint) => endpoint !== null)
      .filter((endpoint) => endpoint.price === null)
      .map((endpoint) => endpoint.fiscalYearEnd)
      .sort()[0];

    if (earliest !== undefined) {
      candidates.push({
        securityId: member.securityId,
        ticker: member.ticker,
        from: earliest,
      });
    }
  }

  if (candidates.length === 0) {
    return { missing: [], failed: [] };
  }

  const [anchors, checks] = await Promise.all([
    Promise.all(
      candidates.map((candidate) =>
        dependencies.ingestionRuns.findLatestAnchored(
          PRICES_SOURCE_ID,
          PRICES_DATASET_ID,
          candidate.ticker,
        ),
      ),
    ),
    recentChecks(dependencies.jobs, PRICES_SOURCE_ID, (job) =>
      isFiscalPriceHistoryJob(job),
    ),
  ]);
  const missing: string[] = [];
  const failed: string[] = [];

  candidates.forEach((candidate, index) => {
    const need = assessFiscalPriceHistory({
      fiscalYearEnd: candidate.from,
      maxLagDays: FISCAL_PRICE_MAX_LAG_DAYS,
      priceFound: false,
      requestedFrom: anchors[index]?.selectionAnchorOn ?? null,
      today,
    });

    if (need.status !== "needed") {
      return;
    }

    if (
      checks.get(candidate.securityId)?.status === "failed" &&
      !retryFailures
    ) {
      failed.push(candidate.ticker);
      return;
    }

    missing.push(candidate.securityId);
  });

  return { missing, failed };
}

async function admissionBlock(
  budgets: SourceBudgetStore,
  source: typeof SEC_SOURCE_ID | typeof PRICES_SOURCE_ID,
  now: string,
): Promise<SectorDivergenceDownloadStatus | null> {
  const verdict = await checkSourceBudget(
    budgets,
    source,
    source === SEC_SOURCE_ID
      ? MAX_REQUESTS_PER_COMPANY_FACTS_LOAD
      : MAX_REQUESTS_PER_PRICE_ITEM,
    now,
  );

  switch (verdict.status) {
    case "allowed":
      return null;
    case "source_disabled":
    case "budget_undeclared":
      return {
        state: "blocked",
        source,
        reason: verdict.status,
        resumesAt: null,
      };
    case "daily_budget_exhausted":
      return {
        state: "blocked",
        source,
        reason: "daily_budget_exhausted",
        resumesAt: verdict.resumesAt,
      };
  }
}

async function openJobOf(
  jobs: IngestionJobStore,
  source: typeof SEC_SOURCE_ID | typeof PRICES_SOURCE_ID,
): Promise<IngestionJob | undefined> {
  const kind =
    source === SEC_SOURCE_ID ? COMPANY_FACTS_BACKFILL_KIND : PRICE_REFRESH_KIND;
  const open = (
    await jobs.listJobs({
      sourceId: source,
      statuses: ["open", "paused"],
      limit: 10,
    })
  ).filter((job) => job.kind === kind);

  // El más viejo primero: es el que la fuente está procesando o va a procesar.
  return open.at(-1);
}

/**
 * Estado de un job abierto. `mine` dice si es la descarga de este sector; si
 * no, la fuente está ocupada y ésta espera. `start` permite pedir un worker:
 * la lectura del render nunca lo pide.
 */
async function describeOpenJob(
  job: IngestionJob,
  source: typeof SEC_SOURCE_ID | typeof PRICES_SOURCE_ID,
  mine: (subjectKey: string) => boolean,
  start: boolean,
  dependencies: SectorDivergenceDownloadDependencies,
): Promise<EnsureSectorDivergenceDownloadResult> {
  const { jobs, budgets } = dependencies;
  const now = dependencies.now();

  if (job.status === "paused") {
    return {
      status: {
        state: "blocked",
        source,
        reason: "job_paused",
        resumesAt: null,
      },
      run: null,
    };
  }

  const [counts, next, lease, [first]] = await Promise.all([
    jobs.countItems(job.jobId),
    jobs.peekNext(job.jobId),
    jobs.getLease(source),
    jobs.listItems({ jobId: job.jobId, limit: 1 }),
  ]);
  const ours =
    first !== undefined &&
    mine(first.subjectKey) &&
    (source === SEC_SOURCE_ID || isFiscalPriceHistoryJob(job));
  const waits = [job.notBefore, next.item?.notBefore ?? null].filter(
    (instant): instant is string =>
      instant !== null && Date.parse(instant) > Date.parse(now),
  );
  const waitingUntil = waits.sort().at(-1) ?? null;
  const leaseLive =
    lease !== null && Date.parse(lease.expiresAt) > Date.parse(now);
  let run: EnsureSectorDivergenceDownloadResult["run"] = null;

  if (
    start &&
    waitingUntil === null &&
    !leaseLive &&
    !dependencies.workerActive(source)
  ) {
    const blocked = await admissionBlock(budgets, source, now);

    if (blocked !== null) {
      return { status: blocked, run: null };
    }

    run = { source, jobId: job.jobId };
  }

  return {
    status: {
      state: "running",
      phase: ours
        ? source === SEC_SOURCE_ID
          ? "fundamentals"
          : "prices"
        : "other_download",
      done: counts.completed + counts.failed + counts.poisoned,
      total: job.itemCount,
      failed: counts.failed + counts.poisoned,
      waitingUntil,
    },
    run,
  };
}

async function step(
  input: {
    readonly sectorCode: string;
    readonly retryFailures: boolean;
    readonly reading: SectorFiscalReading | null;
  },
  start: boolean,
  dependencies: SectorDivergenceDownloadDependencies,
): Promise<EnsureSectorDivergenceDownloadResult> {
  const sectorCode = sectorCodeSchema.parse(input.sectorCode);
  const { jobs } = dependencies;
  const [openSec, filers] = await Promise.all([
    openJobOf(jobs, SEC_SOURCE_ID),
    assessFilers(sectorCode, input.retryFailures, dependencies),
  ]);
  const failedFilers = filers.failed.map((filer) => filer.label);

  if (openSec !== undefined) {
    return describeOpenJob(
      openSec,
      SEC_SOURCE_ID,
      (cik) => filers.ciks.has(cik),
      start,
      dependencies,
    );
  }

  // La fase SEC va primero: qué cierres fiscales faltan sólo se sabe después.
  if (filers.missing.length > 0) {
    if (!start) {
      return {
        status: {
          state: "pending",
          filers: filers.missing.length,
          priceHistories: 0,
          failedFilers,
          failedPrices: [],
        },
        run: null,
      };
    }

    return plan(
      buildCompanyFactsJobPlan(filers.missing.map((cik) => ({ cik }))),
      SEC_SOURCE_ID,
      (cik) => filers.ciks.has(cik),
      dependencies,
    );
  }

  const openPrices = await openJobOf(jobs, PRICES_SOURCE_ID);

  if (openPrices !== undefined && isFiscalPriceHistoryJob(openPrices)) {
    return describeOpenJob(
      openPrices,
      PRICES_SOURCE_ID,
      (securityId) => filers.securityIds.has(securityId),
      start,
      dependencies,
    );
  }

  const reading = input.reading ?? (await dependencies.readFiscal(sectorCode));
  const prices = await assessPriceHistories(
    reading,
    input.retryFailures,
    dependencies,
  );

  if (prices.missing.length === 0) {
    return {
      status: {
        state: "complete",
        failedFilers,
        failedPrices: prices.failed,
      },
      run: null,
    };
  }

  if (!start) {
    return {
      status: {
        state: "pending",
        filers: 0,
        priceHistories: prices.missing.length,
        failedFilers,
        failedPrices: prices.failed,
      },
      run: null,
    };
  }

  // Un refresco de precios de otra matriz ocupa la fuente: éste espera, y el
  // plan se arma cuando termine para no encolar detrás de otro.
  if (openPrices !== undefined) {
    return describeOpenJob(
      openPrices,
      PRICES_SOURCE_ID,
      () => false,
      start,
      dependencies,
    );
  }

  return plan(
    buildFiscalPriceHistoryJobPlan(prices.missing),
    PRICES_SOURCE_ID,
    (securityId) => filers.securityIds.has(securityId),
    dependencies,
  );
}

async function plan(
  jobPlan: IngestionJobPlanInput,
  source: typeof SEC_SOURCE_ID | typeof PRICES_SOURCE_ID,
  mine: (subjectKey: string) => boolean,
  dependencies: SectorDivergenceDownloadDependencies,
): Promise<EnsureSectorDivergenceDownloadResult> {
  // Antes de planear: una fuente frenada o sin cuota no deja un job abierto
  // que nadie puede correr.
  const blocked = await admissionBlock(
    dependencies.budgets,
    source,
    dependencies.now(),
  );

  if (blocked !== null) {
    return { status: blocked, run: null };
  }

  const { job } = await dependencies.jobs.createJob(jobPlan, {
    now: dependencies.now(),
  });

  return describeOpenJob(job, source, mine, true, dependencies);
}

/**
 * Un paso de la descarga: el estado del job abierto, o el plan de la fase que
 * falta, o `complete`. Idempotente: mientras un job está abierto no se planea
 * otro, y un plan igual devuelve el existente.
 */
export function ensureSectorDivergenceDownload(
  input: { readonly sectorCode: string; readonly retryFailures: boolean },
  dependencies: SectorDivergenceDownloadDependencies,
): Promise<EnsureSectorDivergenceDownloadResult> {
  return step({ ...input, reading: null }, true, dependencies);
}

/**
 * Lo que el render necesita saber **sin escribir nada**: lo que un clic
 * bajaría, o la descarga en curso. Reusa la lectura que la página ya hizo.
 */
export async function readSectorDivergenceDownload(
  input: { readonly sectorCode: string; readonly reading: SectorFiscalReading },
  dependencies: SectorDivergenceDownloadDependencies,
): Promise<SectorDivergenceDownloadStatus> {
  return (await step({ ...input, retryFailures: false }, false, dependencies))
    .status;
}
