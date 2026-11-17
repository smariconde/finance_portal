import { InMemoryClassificationRepository } from "@/modules/classification/infrastructure/in-memory-classification-repository";
import type { StoredCedearRegistry } from "@/modules/cedears/domain/plan-cedear-registry";
import { DEMO_IDENTITY_GRAPH } from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { InMemoryPriceRepository } from "@/modules/prices/infrastructure/in-memory-price-repository";
import { readValuationResult } from "@/modules/valuation/application/read-valuation-result";
import { runExcessReturn } from "@/modules/valuation/application/run-excess-return";
import {
  addMilliseconds,
  outcomeForAssessment,
  queueValuationJob,
} from "@/modules/valuation/domain/valuation-job";
import { buildDemoValuationRun } from "@/modules/valuation/infrastructure/demo-valuation-run";
import { fixtureFinancialValuation } from "@/modules/valuation/infrastructure/fixture-financial-valuation";
import { createInMemoryMarketExpectationsRepository } from "@/modules/valuation/infrastructure/in-memory-market-expectations-repository";
import { createInMemoryValuationJobStore } from "@/modules/valuation/infrastructure/in-memory-valuation-job-store";
import { createInMemoryValuationRunRepository } from "@/modules/valuation/infrastructure/in-memory-valuation-run-repository";

const T0 = "2026-10-21T15:00:00.000Z";

/**
 * La lectura de `/valuacion/[ticker]` sobre una corrida de fixture, armada con
 * el mismo `readValuationResult` que la página y dobles en memoria. Sólo para
 * tests: ninguna raíz de composición la construye.
 */
export async function fixtureValuationReading(kind: "fcff" | "financial") {
  const jobs = createInMemoryValuationJobStore();
  const runs = createInMemoryValuationRunRepository();
  const run = await runs.record(
    kind === "fcff"
      ? buildDemoValuationRun()
      : runExcessReturn(fixtureFinancialValuation(), {
          now: () => T0,
          newValuationRunId: () => "70000000-0000-4000-8000-000000000001",
        }),
  );
  const at = addMilliseconds(T0, 1_000);
  const job = queueValuationJob({
    jobId: "00000000-0000-4000-8000-000000000001",
    ticker: "AAPL",
    knownAt: at,
    createdAt: at,
  });
  const claimToken = "10000000-0000-4000-8000-000000000001";
  await jobs.insert(job);
  await jobs.claim({
    jobId: job.jobId,
    startedAt: at,
    claimToken,
    staleBefore: at,
  });
  await jobs.finish({
    jobId: job.jobId,
    claimToken,
    finishedAt: at,
    outcome: outcomeForAssessment(
      {
        legalEntityId: run.subject.legalEntityId,
        securityId: run.subject.securityId,
        listingId: null,
        cik: "0000320193",
        hasAnnualFundamentals: true,
        methodStatus: "selected",
        assetProfile: kind === "fcff" ? "non_financial_mature" : "bank",
        method: kind === "fcff" ? "fcff_base" : "excess_return",
        rigor: kind === "fcff" ? "standard" : "screening",
        unsupportedReason: null,
      },
      { valuationRunId: run.valuationRunId, runStatus: run.status },
    ),
  });
  const registry: StoredCedearRegistry = {
    programs: DEMO_IDENTITY_GRAPH.depositaryPrograms,
    ratios: DEMO_IDENTITY_GRAPH.depositaryRatios,
  };
  const reading = await readValuationResult(
    { ticker: "AAPL" },
    {
      jobs,
      runs,
      universe: {
        loadState: async () => ({
          graph: DEMO_IDENTITY_GRAPH,
          memberships: [],
        }),
      },
      classifications: new InMemoryClassificationRepository(),
      cedears: { loadRegistry: async () => registry },
      prices: new InMemoryPriceRepository(),
      expectations: createInMemoryMarketExpectationsRepository(),
      fundamentals: () => ({
        readFundamentals: async () => [],
        fiscalYearAnchors: async () => [],
      }),
    },
  );

  return { reading, run };
}
