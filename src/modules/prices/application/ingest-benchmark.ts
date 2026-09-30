import {
  ingestionRunSchema,
  isPublishableStatus,
} from "@/modules/ingestion/domain/ingestion-run";

import {
  benchmarkCloseSchema,
  findDeclaredBenchmark,
  type BenchmarkClose,
} from "../domain/declared-benchmarks";
import { settleSession } from "../domain/settled-session";

import type { IngestPricesDependencies } from "./ingest-prices";
import type { BenchmarkWriteSummary } from "./price-repository";

/**
 * Ingesta de una serie de referencia declarada (`F7-05`,
 * [ADR 0029](../../../../docs/architecture/adr/0029-reference-series-sector-risk-matrix.md)).
 *
 * Misma fuente, misma guarda de la rueda en curso y mismo registro de corrida
 * que la serie de una security; lo que cambia es qué se exige de la respuesta.
 * Un índice total return no tiene splits ni dividendos: ya los lleva adentro. Si
 * la fuente publicara alguno, la base dejaría de ser la declarada y comparar
 * contra las empresas mezclaría dos bases, que es lo que la ADR 0016 prohíbe.
 */
export const BENCHMARK_DATASET_ID = "yahoo.benchmark-close";

export type BenchmarkRefusalCode =
  /** El ID no está en `declared-benchmarks.ts`. */
  | "benchmark_not_declared"
  /** La respuesta trae splits o dividendos: la base no es la declarada. */
  | "benchmark_has_events"
  /** La moneda de la respuesta no es la declarada. */
  | "benchmark_currency_mismatch";

export class BenchmarkIngestionError extends Error {
  readonly code: BenchmarkRefusalCode;
  readonly benchmarkId: string;

  constructor(code: BenchmarkRefusalCode, benchmarkId: string) {
    super(`${code}: ${benchmarkId}`);
    this.name = "BenchmarkIngestionError";
    this.code = code;
    this.benchmarkId = benchmarkId;
  }
}

export type IngestBenchmarkOutcome = {
  readonly benchmarkId: string;
  readonly sourceSymbol: string;
  readonly parserVersion: string;
  readonly bars: number;
  readonly barsWithoutClose: number;
  readonly barsUnsettled: readonly string[];
  readonly byteLength: number;
  readonly summary: BenchmarkWriteSummary | null;
  readonly runId: string | null;
  readonly runStatus: string | null;
};

export async function ingestBenchmark(
  benchmarkId: string,
  dependencies: IngestPricesDependencies,
): Promise<IngestBenchmarkOutcome> {
  const benchmark = findDeclaredBenchmark(benchmarkId);

  if (benchmark === null) {
    throw new BenchmarkIngestionError("benchmark_not_declared", benchmarkId);
  }

  const {
    source,
    repository,
    ingestionRuns,
    now,
    newId,
    hashContent,
    dryRun = false,
  } = dependencies;
  const fetched = await source.load(benchmark.sourceSymbol);
  const startedAt = now();

  if (fetched.parsed.splits.length > 0 || fetched.parsed.dividends.length > 0) {
    throw new BenchmarkIngestionError("benchmark_has_events", benchmarkId);
  }

  if (fetched.parsed.currency !== benchmark.currency) {
    throw new BenchmarkIngestionError(
      "benchmark_currency_mismatch",
      benchmarkId,
    );
  }

  const settled = settleSession(
    fetched.parsed.bars,
    fetched.parsed,
    fetched.fetchedAt,
  );
  const closes: BenchmarkClose[] = settled.bars.map((bar) =>
    benchmarkCloseSchema.parse({
      benchmarkId,
      marketDate: bar.marketDate,
      close: bar.close,
      currency: fetched.parsed.currency,
    }),
  );

  const base = {
    benchmarkId,
    sourceSymbol: benchmark.sourceSymbol,
    parserVersion: fetched.parsed.parserVersion,
    bars: closes.length,
    barsWithoutClose: fetched.parsed.barsWithoutClose,
    barsUnsettled: settled.unsettled,
    byteLength: fetched.byteLength,
  };

  if (dryRun) {
    return { ...base, summary: null, runId: null, runStatus: null };
  }

  const contentHash = hashContent(
    JSON.stringify({
      benchmarkId,
      closes: closes.map((close) => [close.marketDate, close.close]),
    }),
  );
  const previous = await ingestionRuns.findByIdempotencyKey(contentHash);
  const replayOf =
    previous !== null && isPublishableStatus(previous.status) ? previous : null;
  const finishedAt = now();

  const run = await ingestionRuns.append(
    ingestionRunSchema.parse({
      runId: newId(),
      sourceId: fetched.sourceId,
      datasetId: BENCHMARK_DATASET_ID,
      parserVersion: fetched.parsed.parserVersion,
      idempotencyKey: contentHash,
      requestedAsOf: null,
      requestedVintage: null,
      cursor: null,
      nextCursor: null,
      subjectKey: benchmarkId,
      selectionVersion: null,
      selectionAnchorOn: null,
      status: replayOf === null ? "succeeded" : "duplicate",
      startedAt,
      finishedAt,
      counts:
        replayOf === null
          ? {
              fetched: closes.length,
              accepted: closes.length,
              rejected: 0,
              duplicate: 0,
            }
          : {
              fetched: closes.length,
              accepted: 0,
              rejected: 0,
              duplicate: closes.length,
            },
      contentHash,
      failure: null,
      qualityFlags: replayOf === null ? [] : ["duplicate_content"],
      replayOfRunId: replayOf?.runId ?? null,
      recordedAt: finishedAt,
    }),
  );

  const summary = await repository.writeBenchmarkSeries(
    closes,
    (replayOf ?? run).runId,
  );

  return { ...base, summary, runId: run.runId, runStatus: run.status };
}
