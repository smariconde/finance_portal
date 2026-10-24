import { cedearPriceTargets } from "@/modules/cedears/domain/cedear-price-targets";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { getCedearRegistryRepository } from "@/server/persistence/get-cedear-registry-repository";
import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import {
  planSecSicClassification,
  SEC_SIC_TAXONOMY_ID,
} from "@/modules/classification/domain/sec-sic-classification";
import {
  assertCompanyFactsJob,
  buildCompanyFactsJobPlan,
  createCompanyFactsAdmission,
  createCompanyFactsJobExecutor,
  observeSourceSignals,
} from "@/modules/fundamentals/application/company-facts-backfill";
import { ingestCompanyFacts } from "@/modules/fundamentals/application/ingest-company-facts";
import {
  createLiveCompanyFactsSource,
  SEC_SOURCE_ID,
} from "@/modules/fundamentals/application/live-company-facts-source";
import { REFRESH_PROBE_DATASET_ID } from "@/modules/fundamentals/application/refresh-company-facts";
import { SEC_SUBMISSIONS_PARSER_VERSION } from "@/modules/fundamentals/domain/parse-sec-submissions";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import {
  createPacedEgressFetch,
  SEC_REQUEST_PACING,
} from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import {
  runIngestionJob,
  type RunIngestionJobResult,
} from "@/modules/ingestion/application/run-ingestion-job";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import {
  INGESTION_JOB_POLICY,
  type IngestionJobPolicy,
} from "@/modules/ingestion/domain/ingestion-job";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { runPointInTimeAudit } from "@/modules/observations/application/point-in-time-audit-reader";
import {
  buildPriceRefreshJobPlan,
  loadRecentPriceChecks,
} from "@/modules/prices/application/sector-price-refresh";
import { assessReferenceFreshness } from "@/modules/prices/domain/price-freshness";
import { subtractDays } from "@/modules/temporal/domain/calendar-date";
import {
  classifyDurableRun,
  type DurableDownload,
  type SicObservation,
  type ValuationDataDependencies,
} from "@/modules/valuation/application/ensure-valuation-data";
import { getMeteredEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getIngestionJobStore } from "@/server/persistence/get-ingestion-job-store";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getPointInTimeAuditReader } from "@/server/persistence/get-point-in-time-audit-reader";
import { getPriceRepository } from "@/server/persistence/get-price-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceDocumentRepository } from "@/server/persistence/get-source-document-repository";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

import { runPriceRefreshJob } from "./sector-price-refresh";

/**
 * Raíz de composición del paso de datos de la corrida (`F6-05`,
 * [ADR 0051](../../../docs/architecture/adr/0051-on-demand-valuation-data.md)).
 *
 * Fundamentals y precios corren como los jobs durables de la ADR 0015, bajo el
 * lease de su fuente: un plan igual a uno abierto devuelve ese job, y así un
 * pedido nuevo retoma el anterior. El SIC es una request sin lease, como en
 * `valuation:assess --apply`. Ninguna espera en línea pasa del minuto: más es
 * un pendiente, no un request colgado.
 */
const ON_DEMAND_POLICY: IngestionJobPolicy = Object.freeze({
  ...INGESTION_JOB_POLICY,
  maxInlineWaitMs: 60_000,
});

const now = () => new Date().toISOString();

function holderName(): string {
  return `web/${hostname().replace(/[^A-Za-z0-9.-]/gu, "-")}/${process.pid}/${randomUUID().slice(0, 8)}`;
}

/** Los puertos del paso de datos sobre la base y el egress del proyecto. */
export function createValuationDataDependencies(
  graph: IdentityGraph,
): ValuationDataDependencies {
  // Un solo ritmo para todas las requests de la SEC del paso: 2 por segundo.
  const signals = observeSourceSignals(getMeteredEgressFetch());
  const secFetch = createPacedEgressFetch(signals.fetch, SEC_REQUEST_PACING, {
    elapsedMs: () => performance.now(),
    sleep: (ms) => sleep(ms),
  });
  const registry = getSourceRegistryRepository();
  let registrySynced: Promise<unknown> | null = null;
  const syncRegistry = () =>
    (registrySynced ??= syncDeclaredSourceRegistry(
      DEMO_SOURCE_REGISTRY,
      registry,
    ));
  const jobs = getIngestionJobStore();

  return {
    async ingestFundamentals(ciks) {
      await syncRegistry();
      const { job } = await jobs.createJob(
        buildCompanyFactsJobPlan(ciks.map((cik) => ({ cik }))),
        { now: now() },
      );
      assertCompanyFactsJob(job);

      const ingestion = {
        sourceRegistry: registry,
        ingestionRuns: getIngestionRunRepository(),
        sourceDocuments: getSourceDocumentRepository(),
        observations: getObservationRepository(),
        identity: createGraphIdentityResolver(() => graph),
        source: createLiveCompanyFactsSource({ fetch: secFetch }),
        now,
        newId: () => randomUUID(),
      };
      const result = await runIngestionJob(
        { jobId: job.jobId, holder: holderName() },
        {
          store: jobs,
          execute: createCompanyFactsJobExecutor({
            ingest: (cik) =>
              ingestCompanyFacts(
                { cik, mode: "personal", dryRun: false },
                ingestion,
              ),
            takeSignal: signals.take,
          }),
          now,
          sleep: (ms) => sleep(ms),
          newLeaseToken: () => randomUUID(),
          startHeartbeat: startTimer,
          admitItem: createCompanyFactsAdmission({
            fetch: secFetch,
            pacing: SEC_REQUEST_PACING,
            budgets: getSourceBudgetStore(),
            now,
          }),
          policy: ON_DEMAND_POLICY,
        },
      );

      return classify(result);
    },
    async observeSic({ legalEntityId, cik }) {
      await syncRegistry();
      const refusal = await sicRefusal(registry);

      if (refusal !== null) {
        return refusal;
      }

      let probe;

      try {
        probe = await createLiveCompanyFactsSource({ fetch: secFetch }).probe(
          cik,
        );
      } catch (error) {
        // Una negativa nuestra a mitad de camino es un pendiente, no un fallo
        // del filer; cualquier otro error lo nombra el job.
        if (error instanceof SourceRequestRefusedError) {
          return {
            status: "pending",
            reason: "source_disabled",
            resumesAt: null,
          };
        }

        throw error;
      }

      if (probe.industry === null) {
        return { status: "not_published" };
      }

      const classifications = getClassificationRepository();
      const stored = await classifications.loadClassifications({
        taxonomyId: SEC_SIC_TAXONOMY_ID,
        limit: 10_000,
      });
      const plan = planSecSicClassification({
        observation: {
          subjectId: legalEntityId,
          reading: probe.industry,
          observedAt: probe.fetchedAt,
          sourceId: SEC_SOURCE_ID,
          sourceDocumentId: `submissions/CIK${cik}.json`,
        },
        stored,
        recordedAt: now(),
        taxonomyVersion: SEC_SUBMISSIONS_PARSER_VERSION,
        newId: () => randomUUID(),
        hashContent: (input) =>
          createHash("sha256").update(input).digest("hex"),
      });

      if (plan.counts.opened > 0 || plan.counts.superseded > 0) {
        await classifications.applyClassificationPlan(plan);
      }

      return { status: "observed", code: probe.industry.sic };
    },
    async latestClose(securityId) {
      const today = now().slice(0, 10);
      // Dos semanas alcanzan para encontrar la última rueda sin barrer la serie.
      const closes = await getPriceRepository().loadSeries({
        securityId,
        from: subtractDays(today, 14),
        to: today,
        limit: 30,
      });

      return closes.at(-1)?.marketDate ?? null;
    },
    async lastPriceCheck(securityId) {
      const checks = await loadRecentPriceChecks(jobs);

      return checks.get(securityId)?.checkedAt ?? null;
    },
    async ensureCedearPrices(securityId) {
      await syncRegistry();
      const at = now();
      const registry = await getCedearRegistryRepository().loadRegistry({});
      const query = pointInTimeQuerySchema.parse({
        effectiveAt: at,
        knownAt: at,
        revisionPolicy: "as_known",
        sourcePolicyVersion: "source-policy-1.0.0",
      });
      const targets = cedearPriceTargets(graph, registry, securityId, query);
      // Una falla depositaria no bloquea la valuación del subyacente.
      for (const target of targets) {
        const last = await getPriceRepository().loadSeries({
          securityId: target.securityId,
          from: subtractDays(at.slice(0, 10), 14),
          limit: 30,
        });
        const checks = await loadRecentPriceChecks(jobs);
        const freshness = assessReferenceFreshness({
          latestClose: last.at(-1)?.marketDate ?? null,
          lastCheckedAt: checks.get(target.securityId)?.checkedAt ?? null,
          now: at,
        });
        if (freshness.status === "fresh") continue;
        const { job: localJob } = await jobs.createJob(
          buildPriceRefreshJobPlan("securities", [target.securityId]),
          { now: now() },
        );
        try {
          await runPriceRefreshJob(localJob.jobId, {
            policy: ON_DEMAND_POLICY,
          });
        } catch (error) {
          console.error(
            "CEDEAR price refresh failed",
            error instanceof Error ? error.name : typeof error,
          );
        }
      }
    },
    async ingestPrices(securityId) {
      const { job } = await jobs.createJob(
        buildPriceRefreshJobPlan("securities", [securityId]),
        { now: now() },
      );
      const result = await runPriceRefreshJob(job.jobId, {
        policy: ON_DEMAND_POLICY,
      });

      return result === null
        ? { status: "failed", code: "job_missing" }
        : classify(result);
    },
    async auditSubjects(subjectIds) {
      return runPointInTimeAudit(getPointInTimeAuditReader(), { subjectIds });
    },
    now,
  };

  async function classify(
    result: RunIngestionJobResult,
  ): Promise<DurableDownload> {
    const [counts, [failedItem]] = await Promise.all([
      jobs.countItems(result.job.jobId),
      jobs.listItems({
        jobId: result.job.jobId,
        statuses: ["failed", "poisoned"],
        limit: 1,
      }),
    ]);

    return classifyDurableRun({
      result,
      counts,
      failedItem: failedItem ?? null,
    });
  }
}

/**
 * Lo que impide pedir el SIC antes de abrir el socket: el dataset sin
 * declarar o sin derechos es de la fuente, igual que la cuota.
 */
async function sicRefusal(
  registry: ReturnType<typeof getSourceRegistryRepository>,
): Promise<SicObservation | null> {
  const entry = await registry.findBySourceId(SEC_SOURCE_ID);

  if (
    entry === null ||
    !entry.datasets.includes(REFRESH_PROBE_DATASET_ID) ||
    !evaluateIngestionRights(entry, {
      storesRawPayload: false,
      storesNormalizedValues: true,
      publicDisplay: false,
    }).allowed
  ) {
    return { status: "pending", reason: "source_disabled", resumesAt: null };
  }

  const verdict = await checkSourceBudget(
    getSourceBudgetStore(),
    SEC_SOURCE_ID,
    1,
    now(),
  );

  switch (verdict.status) {
    case "allowed":
      return null;
    case "daily_budget_exhausted":
      return {
        status: "pending",
        reason: "daily_budget_exhausted",
        resumesAt: verdict.resumesAt,
      };
    case "source_disabled":
    case "budget_undeclared":
      return { status: "pending", reason: "source_disabled", resumesAt: null };
  }
}

function startTimer(beat: () => Promise<void>, intervalMs: number) {
  const timer = setInterval(() => void beat(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
