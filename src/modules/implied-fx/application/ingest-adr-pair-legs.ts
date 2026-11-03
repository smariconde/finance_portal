import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import {
  ingestionRunSchema,
  isPublishableStatus,
} from "@/modules/ingestion/domain/ingestion-run";
import type { PriceSourceProvider } from "@/modules/prices/application/live-price-source";
import {
  settleCedearSession,
  settleSession,
} from "@/modules/prices/domain/settled-session";
import {
  PRICE_UNADJUST_RULE_VERSION,
  unadjustSeries,
} from "@/modules/prices/domain/unadjust-series";

import {
  adrLegCloseSchema,
  DECLARED_ADR_PAIRS,
  LEG_CURRENCY,
  legIdOf,
  type AdrLegClose,
  type AdrLegSide,
} from "../domain/declared-adr-pairs";

import type {
  AdrLegWriteSummary,
  AdrPairRepository,
} from "./adr-pair-repository";

/**
 * Ingesta de las patas de un par ADR (`F9-07`, ADR 0068). Una request por pata
 * trae la historia desde 2000; los cierres se des-ajustan por los splits
 * fechados de la misma respuesta (`price-unadjust-1.1.0`), así que la fila es lo
 * que se operó y no cambia con el próximo split. La rueda en curso se deja
 * afuera con la regla de su mercado: Nueva York para el ADR, BYMA para la
 * acción local.
 */
export const ADR_PAIR_DATASET_ID = "yahoo.adr-pair-close";
export const ADR_PAIR_HISTORY_FROM = "2000-01-01";

export type AdrLegRefusalCode =
  /** La moneda de la respuesta no es la de la pata. */
  "leg_currency_mismatch";

export class AdrLegIngestionError extends Error {
  readonly code: AdrLegRefusalCode;
  readonly legId: string;

  constructor(code: AdrLegRefusalCode, legId: string) {
    super(`${code}: ${legId}`);
    this.name = "AdrLegIngestionError";
    this.code = code;
    this.legId = legId;
  }
}

export type IngestAdrLegDependencies = {
  readonly source: PriceSourceProvider;
  readonly repository: AdrPairRepository;
  readonly ingestionRuns: IngestionRunRepository;
  readonly now: () => string;
  readonly newId: () => string;
  readonly hashContent: (input: string) => string;
  readonly dryRun?: boolean;
};

export type IngestAdrLegOutcome = {
  readonly legId: string;
  readonly symbol: string;
  readonly bars: number;
  readonly firstOn: string | null;
  readonly lastOn: string | null;
  readonly splits: number;
  readonly barsUnsettled: readonly string[];
  readonly byteLength: number;
  readonly summary: AdrLegWriteSummary | null;
  readonly runId: string | null;
  readonly runStatus: string | null;
};

export async function ingestAdrLeg(
  pairId: string,
  side: AdrLegSide,
  dependencies: IngestAdrLegDependencies,
): Promise<IngestAdrLegOutcome> {
  const pair = DECLARED_ADR_PAIRS.find(
    (candidate) => candidate.pairId === pairId,
  );

  if (pair === undefined) {
    throw new Error(`pair ${pairId} is not declared`);
  }

  const { source, repository, ingestionRuns, now, newId, hashContent } =
    dependencies;
  const legId = legIdOf(pairId, side);
  const symbol = side === "adr" ? pair.adrSymbol : pair.localSymbol;
  const startedAt = now();
  const fetched = await source.load(symbol);

  if (fetched.parsed.currency !== LEG_CURRENCY[side]) {
    throw new AdrLegIngestionError("leg_currency_mismatch", legId);
  }

  const raw = unadjustSeries(fetched.parsed.bars, fetched.parsed.splits, legId);
  const settled = (side === "adr" ? settleSession : settleCedearSession)(
    raw,
    fetched.parsed,
    fetched.fetchedAt,
  );
  const closes: AdrLegClose[] = settled.bars.map((bar) =>
    adrLegCloseSchema.parse({
      legId,
      marketDate: bar.marketDate,
      close: bar.close,
      currency: fetched.parsed.currency,
    }),
  );

  const base = {
    legId,
    symbol,
    bars: closes.length,
    firstOn: closes[0]?.marketDate ?? null,
    lastOn: closes.at(-1)?.marketDate ?? null,
    splits: fetched.parsed.splits.length,
    barsUnsettled: settled.unsettled,
    byteLength: fetched.byteLength,
  };

  if (dependencies.dryRun === true || closes.length === 0) {
    return { ...base, summary: null, runId: null, runStatus: null };
  }

  const contentHash = hashContent(
    JSON.stringify({
      legId,
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
      datasetId: ADR_PAIR_DATASET_ID,
      parserVersion: fetched.parsed.parserVersion,
      idempotencyKey: contentHash,
      requestedAsOf: null,
      requestedVintage: null,
      cursor: null,
      nextCursor: null,
      subjectKey: legId,
      selectionVersion: PRICE_UNADJUST_RULE_VERSION,
      selectionAnchorOn: fetched.requestedFrom,
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

  const summary = await repository.writeLegCloses(
    closes,
    (replayOf ?? run).runId,
  );

  return { ...base, summary, runId: run.runId, runStatus: run.status };
}
