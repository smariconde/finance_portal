import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";

import { SP500_TOTAL_RETURN_BENCHMARK_ID } from "../domain/declared-benchmarks";
import { parseChartPayload } from "../domain/parse-chart-payload";
import {
  FIXTURE_CHART_PAYLOAD,
  FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS,
} from "../infrastructure/fixture-chart-payload";
import { InMemoryPriceRepository } from "../infrastructure/in-memory-price-repository";

import { BenchmarkIngestionError, ingestBenchmark } from "./ingest-benchmark";
import type { PriceSourceProvider } from "./live-price-source";

function sourceOf(payload: unknown, currency?: string): PriceSourceProvider {
  const parsed = parseChartPayload(payload);

  if (!parsed.ok) {
    throw new Error("the fixture must parse");
  }

  return {
    sourceId: "yahoo-finance",
    async load(symbol) {
      return {
        sourceId: "yahoo-finance",
        symbol,
        parsed: currency === undefined ? parsed : { ...parsed, currency },
        byteLength: 512,
        fetchedAt: "2026-09-22T12:00:00.000Z",
      };
    },
  };
}

function deps(
  repository: InMemoryPriceRepository,
  source: PriceSourceProvider,
  dryRun = false,
) {
  let tick = 0;

  return {
    source,
    repository,
    ingestionRuns: createInMemoryIngestionRunRepository(),
    now: () => {
      tick += 1;
      return new Date(Date.UTC(2026, 8, 22, 12, 0, tick)).toISOString();
    },
    newId: () => randomUUID(),
    hashContent: (input: string) =>
      createHash("sha256").update(input).digest("hex"),
    dryRun,
  };
}

describe("ingestBenchmark", () => {
  it("asks the source for the declared symbol and stores the levels", async () => {
    const repository = new InMemoryPriceRepository();
    const asked: string[] = [];
    const source = sourceOf(FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS);
    const spying: PriceSourceProvider = {
      ...source,
      async load(symbol) {
        asked.push(symbol);
        return source.load(symbol);
      },
    };

    const outcome = await ingestBenchmark(
      SP500_TOTAL_RETURN_BENCHMARK_ID,
      deps(repository, spying),
    );

    expect(asked).toEqual(["^SP500TR"]);
    expect(outcome.summary?.closesInserted).toBe(2);
    expect(
      await repository.loadBenchmarkSeries({
        benchmarkId: SP500_TOTAL_RETURN_BENCHMARK_ID,
      }),
    ).toEqual([
      {
        benchmarkId: "sp500-total-return",
        marketDate: "2026-09-17",
        close: "50.25",
        currency: "USD",
      },
      {
        benchmarkId: "sp500-total-return",
        marketDate: "2026-09-18",
        close: "50.75",
        currency: "USD",
      },
    ]);
  });

  it("is idempotent and reports a changed level instead of overwriting it", async () => {
    const repository = new InMemoryPriceRepository();
    const dependencies = deps(
      repository,
      sourceOf(FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS),
    );

    await ingestBenchmark(SP500_TOTAL_RETURN_BENCHMARK_ID, dependencies);
    const again = await ingestBenchmark(
      SP500_TOTAL_RETURN_BENCHMARK_ID,
      dependencies,
    );

    expect(again.runStatus).toBe("duplicate");
    expect(again.summary?.closesInserted).toBe(0);
    expect(again.summary?.closesDuplicate).toBe(2);

    const revised = await repository.writeBenchmarkSeries([
      {
        benchmarkId: SP500_TOTAL_RETURN_BENCHMARK_ID,
        marketDate: "2026-09-17",
        close: "51",
        currency: "USD",
      },
    ]);

    expect(revised.closesConflicting).toEqual(["2026-09-17"]);
  });

  it("refuses a series with splits or dividends: the basis would not be the declared one", async () => {
    await expect(
      ingestBenchmark(
        SP500_TOTAL_RETURN_BENCHMARK_ID,
        deps(new InMemoryPriceRepository(), sourceOf(FIXTURE_CHART_PAYLOAD)),
      ),
    ).rejects.toMatchObject({ code: "benchmark_has_events" });
  });

  it("refuses a currency other than the declared one", async () => {
    await expect(
      ingestBenchmark(
        SP500_TOTAL_RETURN_BENCHMARK_ID,
        deps(
          new InMemoryPriceRepository(),
          sourceOf(FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS, "EUR"),
        ),
      ),
    ).rejects.toMatchObject({ code: "benchmark_currency_mismatch" });
  });

  it("refuses a benchmark nobody declared, before touching the source", async () => {
    const repository = new InMemoryPriceRepository();
    const source: PriceSourceProvider = {
      sourceId: "yahoo-finance",
      load: () => Promise.reject(new Error("must not be called")),
    };

    await expect(
      ingestBenchmark("nasdaq-100", deps(repository, source)),
    ).rejects.toBeInstanceOf(BenchmarkIngestionError);
  });

  it("writes nothing in a dry run", async () => {
    const repository = new InMemoryPriceRepository();
    const outcome = await ingestBenchmark(
      SP500_TOTAL_RETURN_BENCHMARK_ID,
      deps(repository, sourceOf(FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS), true),
    );

    expect(outcome.summary).toBeNull();
    expect(outcome.bars).toBe(2);
    expect(
      await repository.loadBenchmarkSeries({
        benchmarkId: SP500_TOTAL_RETURN_BENCHMARK_ID,
      }),
    ).toEqual([]);
  });
});
