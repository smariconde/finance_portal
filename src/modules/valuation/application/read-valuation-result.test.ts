import { describe, expect, it } from "vitest";

import {
  DEMO_CURRENT_SYMBOL,
  DEMO_IDENTITY_GRAPH,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import type { StoredCedearRegistry } from "@/modules/cedears/domain/plan-cedear-registry";
import { InMemoryPriceRepository } from "@/modules/prices/infrastructure/in-memory-price-repository";

import { FIXTURE_READING } from "./market-expectations-repository.contract";

import {
  buildDemoValuationRun,
  buildDemoValuationRunBeforeAmendment,
} from "../infrastructure/demo-valuation-run";
import { createInMemoryMarketExpectationsRepository } from "../infrastructure/in-memory-market-expectations-repository";
import { createInMemoryValuationJobStore } from "../infrastructure/in-memory-valuation-job-store";
import { createInMemoryValuationRunRepository } from "../infrastructure/in-memory-valuation-run-repository";
import {
  addMilliseconds,
  outcomeForAssessment,
  outcomeForIdentity,
  queueValuationJob,
  type ValuationJobOutcome,
} from "../domain/valuation-job";
import {
  cedearAccessAt,
  readValuationResult,
  subjectAt,
} from "./read-valuation-result";
import type { ValuationRun } from "../domain/valuation-run";
import type { ValuationJobStore } from "./valuation-job-store";

const T0 = "2026-10-21T15:00:00.000Z";
const READING = {
  legalEntityId: "33333333-3333-4333-8333-333333333333",
  securityId: "44444444-4444-4444-8444-444444444444",
  listingId: null,
  cik: "0000320193",
  hasAnnualFundamentals: true,
  methodStatus: "selected",
  assetProfile: "non_financial_mature",
  method: "fcff_base",
  rigor: "standard",
  unsupportedReason: null,
} as const;

const universe = {
  loadState: async () => ({ graph: DEMO_IDENTITY_GRAPH, memberships: [] }),
};
const REGISTRY: StoredCedearRegistry = {
  programs: DEMO_IDENTITY_GRAPH.depositaryPrograms,
  ratios: DEMO_IDENTITY_GRAPH.depositaryRatios,
};
const cedears = { loadRegistry: async () => REGISTRY };
const prices = new InMemoryPriceRepository();
const expectations = createInMemoryMarketExpectationsRepository();
/** Sin fundamentals ingeridos: la historia queda nula, no inventada. */
const fundamentals = () => ({
  readFundamentals: async () => [],
  fiscalYearAnchors: async () => [],
});

let sequence = 0;

async function finished(
  store: ValuationJobStore,
  outcome: ValuationJobOutcome,
): Promise<void> {
  sequence += 1;
  const at = addMilliseconds(T0, sequence * 1_000);
  const job = queueValuationJob({
    jobId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    ticker: "AAPL",
    knownAt: at,
    createdAt: at,
  });
  const token = `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  await store.insert(job);
  await store.claim({
    jobId: job.jobId,
    startedAt: at,
    claimToken: token,
    staleBefore: at,
  });
  await store.finish({
    jobId: job.jobId,
    claimToken: token,
    finishedAt: at,
    outcome,
  });
}

describe("readValuationResult", () => {
  it("names a ticker that never finished a job", async () => {
    const reading = await readValuationResult(
      { ticker: "aapl" },
      {
        jobs: createInMemoryValuationJobStore(),
        runs: createInMemoryValuationRunRepository(),
        universe,
        cedears,
        prices,
        expectations,
        fundamentals,
      },
    );

    expect(reading).toEqual({ state: "not_requested", ticker: "AAPL" });
  });

  it("reads the company's history at the run's own cutoff", async () => {
    const jobs = createInMemoryValuationJobStore();
    const runs = createInMemoryValuationRunRepository();
    const run = await runs.record(buildDemoValuationRun());
    await finished(
      jobs,
      outcomeForAssessment(READING, {
        valuationRunId: run.valuationRunId,
        runStatus: "computed",
      }),
    );

    const queries: unknown[] = [];
    const ciks: (string | null)[] = [];
    const revenue = (asOf: string, periodStart: string, value: string) => ({
      observationId: `40000000-0000-4000-8000-${asOf.replaceAll("-", "").padStart(12, "0")}`,
      subjectId: run.subject.legalEntityId,
      concept: "us-gaap:Revenues",
      periodType: "annual",
      asOf,
      periodStart,
      unit: "USD",
      currency: "USD",
      value,
      availableAt: "2025-03-01T12:00:00.000Z",
      recordedAt: "2025-03-01T12:00:00.000Z",
      sourceDocumentId: null,
    });

    const reading = await readValuationResult(
      { ticker: "AAPL" },
      {
        jobs,
        runs,
        universe,
        cedears,
        prices,
        expectations,
        fundamentals: (cikOf) => ({
          readFundamentals: async (subjectId, query) => {
            queries.push(query);
            ciks.push(cikOf(subjectId));
            return [
              revenue("2024-12-31", "2024-01-01", "1100"),
              revenue("2023-12-31", "2023-01-01", "1000"),
            ];
          },
          fiscalYearAnchors: async () => ["2024-12-31"],
        }),
      },
    );

    if (reading.state !== "run") throw new Error(reading.state);

    expect(queries).toEqual([run.provenance.knowledge]);
    expect(ciks).toEqual(["0000999901"]);
    expect(reading.trajectory?.years.map((year) => year.revenue)).toEqual([
      { status: "value", value: "1000" },
      { status: "value", value: "1100" },
    ]);
  });

  it("leaves the history null when the company has no fundamentals", async () => {
    const jobs = createInMemoryValuationJobStore();
    const runs = createInMemoryValuationRunRepository();
    const run = await runs.record(buildDemoValuationRun());
    await finished(
      jobs,
      outcomeForAssessment(READING, {
        valuationRunId: run.valuationRunId,
        runStatus: "computed",
      }),
    );

    const reading = await readValuationResult(
      { ticker: "AAPL" },
      { jobs, runs, universe, cedears, prices, expectations, fundamentals },
    );

    expect(reading.state === "run" && reading.trajectory).toBeNull();
  });

  it("names the latest gap when no job recorded a run", async () => {
    const jobs = createInMemoryValuationJobStore();
    await finished(jobs, outcomeForIdentity("not_found"));
    await finished(
      jobs,
      outcomeForAssessment(READING, { gap: "employee_equity_not_proposed" }),
    );

    const reading = await readValuationResult(
      { ticker: "AAPL" },
      {
        jobs,
        runs: createInMemoryValuationRunRepository(),
        universe,
        cedears,
        prices,
        expectations,
        fundamentals,
      },
    );

    expect(reading.state).toBe("no_run");
    expect(reading.state === "no_run" && reading.latest).toMatchObject({
      gap: "snapshot_not_assembled",
      snapshotGap: "employee_equity_not_proposed",
    });
  });

  it("shows the latest recorded run and the newer job that recorded none", async () => {
    const jobs = createInMemoryValuationJobStore();
    const runs = createInMemoryValuationRunRepository();
    const older = await runs.record(buildDemoValuationRunBeforeAmendment());
    const newer = await runs.record(buildDemoValuationRun());
    const recorded = (valuationRunId: string) =>
      outcomeForAssessment(READING, { valuationRunId, runStatus: "computed" });

    await finished(jobs, recorded(older.valuationRunId));
    await finished(jobs, recorded(newer.valuationRunId));
    await finished(
      jobs,
      outcomeForAssessment(READING, { gap: "market_unavailable" }),
    );

    const reading = await readValuationResult(
      { ticker: "AAPL" },
      { jobs, runs, universe, cedears, prices, expectations, fundamentals },
    );

    expect(reading.state).toBe("run");
    if (reading.state !== "run") return;

    expect(reading.run.valuationRunId).toBe(newer.valuationRunId);
    expect(reading.newerGap?.snapshotGap).toBe("market_unavailable");
    expect(reading.subject).toMatchObject({
      cik: "999901",
      symbol: DEMO_CURRENT_SYMBOL.symbol,
    });
  });

  it("has no newer gap when the latest job recorded the run", async () => {
    const jobs = createInMemoryValuationJobStore();
    const runs = createInMemoryValuationRunRepository();
    const run = await runs.record(buildDemoValuationRun());

    await finished(
      jobs,
      outcomeForAssessment(READING, {
        valuationRunId: run.valuationRunId,
        runStatus: "computed",
      }),
    );

    const reading = await readValuationResult(
      { ticker: "AAPL" },
      { jobs, runs, universe, cedears, prices, expectations, fundamentals },
    );

    expect(reading.state === "run" && reading.newerGap).toBeNull();
    // Sin serie guardada no hay precio: se nombra, no se inventa.
    expect(reading.state === "run" && reading.market.comparison).toMatchObject({
      status: "unavailable",
      reason: "no_close_at_as_of",
    });
  });

  it("compares the close at the run's as_of and keeps a later close apart", async () => {
    const jobs = createInMemoryValuationJobStore();
    const runs = createInMemoryValuationRunRepository();
    const run = await runs.record(buildDemoValuationRun());
    const series = new InMemoryPriceRepository();
    const close = (marketDate: string, value: string) => ({
      securityId: run.subject.securityId,
      marketDate,
      close: value,
      currency: run.currency,
    });

    await series.writeSeries(
      [close(run.asOf, "15"), close("2099-01-02", "99")],
      [],
    );
    await finished(
      jobs,
      outcomeForAssessment(READING, {
        valuationRunId: run.valuationRunId,
        runStatus: "computed",
      }),
    );

    const reading = await readValuationResult(
      { ticker: "AAPL" },
      {
        jobs,
        runs,
        universe,
        cedears,
        prices: series,
        expectations,
        fundamentals,
      },
    );

    expect(reading.state).toBe("run");
    if (reading.state !== "run") return;

    expect(reading.market.comparison).toMatchObject({
      status: "compared",
      price: { marketDate: run.asOf, close: "15" },
    });
    expect(reading.market.latestClose).toMatchObject({
      marketDate: "2099-01-02",
      close: "99",
    });
    expect(reading.market.implied.status).toBe("computed");
    expect(reading.market.reading).toBeNull();
  });

  it("puts the accepted AI reading of the base year's 10-K next to what the price requires", async () => {
    const jobs = createInMemoryValuationJobStore();
    const runs = createInMemoryValuationRunRepository();
    const demo = buildDemoValuationRun();
    const run = await runs.record(demo);
    const series = new InMemoryPriceRepository();
    const readings = createInMemoryMarketExpectationsRepository();
    const evidence = {
      evidenceId: "E1",
      sourceId: "sec-edgar",
      section: "item_7_mdna",
      documentUrl: "https://www.sec.gov/Archives/edgar/data/1/x.htm",
      accessionNumber: "0000000001-25-000001",
      documentAcceptedAt: "2025-02-01T00:00:00.000Z",
      sha256: "b".repeat(64),
      byteLength: 10,
      truncated: false,
      excerpt: "Synthetic.",
    };
    const record = (fiscalYearEnd: string, readingId: string) => ({
      readingId,
      legalEntityId: run.subject.legalEntityId,
      cik: "0000000001",
      accessionNumber: evidence.accessionNumber,
      fiscalYearEnd,
      taskVersion: "market-expectations-reading-1.0.0",
      promptVersion: "market-expectations-prompt-1.0.0",
      policyVersion: "market-expectations-policy-1.0.0",
      ladderVersion: "ai-model-ladder-1.1.0",
      extractVersion: "sec-10k-outlook-1.0.0",
      outcome: "accepted" as const,
      reading: FIXTURE_READING,
      reason: null,
      acceptedRung: 1,
      respondedModel: "fixture/model-a",
      proposedAt: "2026-10-21T12:00:00.000Z",
      recordedAt: "2026-10-21T12:00:00.000Z",
    });

    // Una lectura de otro ejercicio no es la de esta corrida.
    await readings.record({
      record: record("2023-12-31", "30000000-0000-4000-8000-000000000001"),
      evidence: [evidence],
    });
    await readings.record({
      record: record(
        demo.input.baseRevenue.asOf,
        "30000000-0000-4000-8000-000000000002",
      ),
      evidence: [evidence],
    });
    await series.writeSeries(
      [
        {
          securityId: run.subject.securityId,
          marketDate: run.asOf,
          close: "15",
          currency: run.currency,
        },
      ],
      [],
    );
    await finished(
      jobs,
      outcomeForAssessment(READING, {
        valuationRunId: run.valuationRunId,
        runStatus: "computed",
      }),
    );

    const reading = await readValuationResult(
      { ticker: "AAPL" },
      {
        jobs,
        runs,
        universe,
        cedears,
        prices: series,
        expectations: readings,
        fundamentals,
      },
    );

    if (reading.state !== "run") throw new Error(reading.state);

    expect(reading.market.reading?.stored.record.readingId).toBe(
      "30000000-0000-4000-8000-000000000002",
    );
    expect(
      reading.market.reading?.plausibility.map((entry) => entry.driver),
    ).toEqual(["revenue_growth", "operating_margin", "competitive_advantage"]);
  });
});

describe("subjectAt", () => {
  it("reads identity at the run's cutoff, so a later version does not leak in", () => {
    const run = buildDemoValuationRun();
    const entity = DEMO_IDENTITY_GRAPH.legalEntities.find(
      (candidate) => candidate.legalEntityId === run.subject.legalEntityId,
    )!;
    // Una versión conocida después del corte de la corrida.
    const later = "2099-01-01T00:00:00.000Z";
    const graph = {
      ...DEMO_IDENTITY_GRAPH,
      legalEntities: DEMO_IDENTITY_GRAPH.legalEntities.map((candidate) =>
        candidate.legalEntityId === entity.legalEntityId
          ? { ...candidate, availableAt: later, recordedAt: later }
          : candidate,
      ),
    };

    expect(subjectAt(DEMO_IDENTITY_GRAPH, run)?.legalName).toBe(
      entity.legalName,
    );
    expect(subjectAt(graph, run)).toBeNull();
  });
});

/** La corrida demo leída a otro corte, con la misma política. */
function atCutoff(instant: string): ValuationRun {
  const base = buildDemoValuationRun();

  return {
    ...base,
    provenance: {
      ...base.provenance,
      knowledge: {
        ...base.provenance.knowledge,
        revisionPolicy: "as_known",
        effectiveAt: instant,
        knownAt: instant,
      },
    },
  };
}

describe("cedearAccessAt", () => {
  it("converts the value with the ratio effective at the run's cutoff", () => {
    const run = buildDemoValuationRun();
    const access = cedearAccessAt(DEMO_IDENTITY_GRAPH, REGISTRY, run);

    expect(access.status).toBe("program");
    if (access.status !== "program") return;

    const [program] = access.programs;
    // El 10:1 terminó el 2024-09-01: a mediados de 2025 rige el 20:1.
    expect(program?.ratio).toMatchObject({
      depositaryUnits: "20",
      underlyingUnits: "1",
    });
    expect(program?.equivalent).toMatchObject({ status: "computed" });
    expect(
      program?.equivalent.status === "computed" &&
        Number(program.equivalent.value) * 20,
    ).toBeCloseTo(Number(run.result!.valuePerShare), 10);
    expect(JSON.stringify(access)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u,
    );
  });

  it("uses the earlier ratio for a run whose cutoff precedes the change", () => {
    const run = atCutoff("2024-08-01T00:00:00.000Z");
    const access = cedearAccessAt(DEMO_IDENTITY_GRAPH, REGISTRY, run);

    expect(
      access.status === "program" && access.programs[0]?.ratio?.depositaryUnits,
    ).toBe("10");
  });

  it("does not see a program before it was first observed", () => {
    const run = atCutoff("2020-01-01T00:00:00.000Z");

    expect(cedearAccessAt(DEMO_IDENTITY_GRAPH, REGISTRY, run)).toEqual({
      rule: "cedear-access-1.0.0",
      status: "none_known",
      reason: "not_effective_at_cutoff",
    });
  });

  it("names a security that no issuer lists", () => {
    const run = buildDemoValuationRun();

    expect(
      cedearAccessAt(DEMO_IDENTITY_GRAPH, { programs: [], ratios: [] }, run),
    ).toMatchObject({ status: "none_known", reason: "no_program_recorded" });
  });

  it("has no value per CEDEAR for a rejected run", () => {
    const base = buildDemoValuationRun();
    const run = { ...base, result: null };
    const access = cedearAccessAt(DEMO_IDENTITY_GRAPH, REGISTRY, run);

    expect(
      access.status === "program" && access.programs[0]?.equivalent,
    ).toMatchObject({ status: "unavailable", reason: "no_value_per_share" });
  });
});

describe("local identity cutoff", () => {
  it("does not infer a BYMA ticker whose assignment was observed after the run", () => {
    const run = buildDemoValuationRun();
    const graph = {
      ...DEMO_IDENTITY_GRAPH,
      listingSymbols: DEMO_IDENTITY_GRAPH.listingSymbols.map((symbol) => ({
        ...symbol,
        availableAt: "2099-01-01T00:00:00.000Z",
      })),
    };
    const access = cedearAccessAt(graph, REGISTRY, run);
    expect(
      access.status === "program" && access.programs[0]?.bymaSymbol,
    ).toBeNull();
  });
});
