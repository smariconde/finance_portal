import { z } from "zod";

import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import {
  ingestionRunSchema,
  isPublishableStatus,
} from "@/modules/ingestion/domain/ingestion-run";

import {
  dailyCloseSchema,
  priceEventSchema,
  type DailyClose,
  type PriceEvent,
} from "../domain/daily-close";
import {
  unadjustSeries,
  PRICE_UNADJUST_RULE_VERSION,
} from "../domain/unadjust-series";

import type { PriceRepository, PriceWriteSummary } from "./price-repository";
import type { PriceSourceProvider } from "./live-price-source";

/**
 * Ingesta de la serie diaria de una security
 * ([ADR 0026](../../../../docs/architecture/adr/0026-daily-prices-source.md)).
 *
 * Lo que decide el slice pasa acá en dos líneas: la serie que llega viene
 * **ajustada por la fuente**, y se guarda **cruda**. En el medio está
 * `unadjustSeries`, que la devuelve a lo que se operó usando los splits que la
 * misma respuesta trae.
 */
export const PRICES_DATASET_ID = "yahoo.daily-close";

export const ingestPricesCommandSchema = z.object({
  securityId: z.uuid(),
  symbol: z.string().trim().min(1).max(32),
});

export type IngestPricesCommand = z.input<typeof ingestPricesCommandSchema>;

export type IngestPricesDependencies = {
  readonly source: PriceSourceProvider;
  readonly repository: PriceRepository;
  readonly ingestionRuns: IngestionRunRepository;
  /** Reloj inyectado: `recordedAt` es auditoría, no un `Date.now()` disperso. */
  readonly now: () => string;
  readonly newId: () => string;
  readonly hashContent: (input: string) => string;
  /** En seco no se registra corrida ni se escribe fila. */
  readonly dryRun?: boolean;
};

export type IngestPricesOutcome = {
  readonly symbol: string;
  readonly securityId: string;
  readonly unadjustRuleVersion: string;
  readonly parserVersion: string;
  readonly currency: string;
  readonly bars: number;
  readonly barsWithoutClose: number;
  readonly splits: number;
  readonly dividends: number;
  /** Ruedas que el des-ajuste tuvo que mover: cero si no hubo splits. */
  readonly barsRestatedBySource: number;
  readonly byteLength: number;
  /** `null` en seco: no se escribió nada. */
  readonly summary: PriceWriteSummary | null;
  readonly runId: string | null;
  readonly runStatus: string | null;
};

/**
 * Corre una ingesta sin escribir: devuelve exactamente lo que se guardaría.
 * El comando lo usa para el dry run, y así lo que se mide en seco es lo mismo
 * que después se aplica.
 */
export function buildRows(
  securityId: string,
  parsed: {
    readonly currency: string;
    readonly bars: readonly { marketDate: string; close: string }[];
    readonly splits: readonly { effectiveOn: string; ratio: string }[];
    readonly dividends: readonly { effectiveOn: string; amount: string }[];
  },
): {
  readonly closes: readonly DailyClose[];
  readonly events: readonly PriceEvent[];
  readonly barsRestatedBySource: number;
} {
  const unadjusted = unadjustSeries(parsed.bars, parsed.splits, securityId);

  const closes = unadjusted.map((bar) =>
    dailyCloseSchema.parse({
      securityId,
      marketDate: bar.marketDate,
      close: bar.close,
      currency: parsed.currency,
    }),
  );

  const events: PriceEvent[] = [
    ...parsed.splits.map((split) =>
      priceEventSchema.parse({
        securityId,
        eventType: "split",
        effectiveOn: split.effectiveOn,
        value: split.ratio,
        currency: null,
      }),
    ),
    ...parsed.dividends.map((dividend) =>
      priceEventSchema.parse({
        securityId,
        eventType: "dividend",
        effectiveOn: dividend.effectiveOn,
        value: dividend.amount,
        currency: parsed.currency,
      }),
    ),
  ];

  return {
    closes,
    events,
    barsRestatedBySource: unadjusted.filter((bar) => bar.appliedFactor !== "1")
      .length,
  };
}

export async function ingestPrices(
  command: IngestPricesCommand,
  dependencies: IngestPricesDependencies,
): Promise<IngestPricesOutcome> {
  const parsedCommand = ingestPricesCommandSchema.parse(command);
  const {
    source,
    repository,
    ingestionRuns,
    now,
    newId,
    hashContent,
    dryRun = false,
  } = dependencies;

  const fetched = await source.load(parsedCommand.symbol);
  const startedAt = now();
  const { closes, events, barsRestatedBySource } = buildRows(
    parsedCommand.securityId,
    fetched.parsed,
  );

  const base = {
    symbol: parsedCommand.symbol,
    securityId: parsedCommand.securityId,
    unadjustRuleVersion: PRICE_UNADJUST_RULE_VERSION,
    parserVersion: fetched.parsed.parserVersion,
    currency: fetched.parsed.currency,
    bars: closes.length,
    barsWithoutClose: fetched.parsed.barsWithoutClose,
    splits: fetched.parsed.splits.length,
    dividends: fetched.parsed.dividends.length,
    barsRestatedBySource,
    byteLength: fetched.byteLength,
  };

  if (dryRun) {
    return { ...base, summary: null, runId: null, runStatus: null };
  }

  // El contenido de la serie identifica la corrida: dos descargas del mismo
  // contenido son la misma corrida, y la segunda se registra `duplicate` en vez
  // de publicar otra.
  const contentHash = hashContent(
    JSON.stringify({
      securityId: parsedCommand.securityId,
      closes: closes.map((close) => [close.marketDate, close.close]),
      events: events.map((event) => [
        event.eventType,
        event.effectiveOn,
        event.value,
      ]),
    }),
  );

  const previous = await ingestionRuns.findByIdempotencyKey(contentHash);
  const replayOf =
    previous !== null && isPublishableStatus(previous.status) ? previous : null;
  const finishedAt = now();

  // La corrida se registra **antes** de las filas que la referencian: el `FK`
  // de `security_prices` apunta a ella, y escribir primero fallaría.
  const run = await ingestionRuns.append(
    ingestionRunSchema.parse({
      runId: newId(),
      sourceId: fetched.sourceId,
      datasetId: PRICES_DATASET_ID,
      parserVersion: fetched.parsed.parserVersion,
      idempotencyKey: contentHash,
      requestedAsOf: null,
      requestedVintage: null,
      cursor: null,
      nextCursor: null,
      subjectKey: parsedCommand.symbol,
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

  // Publicar bajo la corrida original ante un duplicado sólo inserta lo que
  // falte —la escritura es idempotente por clave natural—, así que una ingesta
  // cortada a la mitad se completa en vez de quedar coja.
  const publishingRun = replayOf ?? run;
  const summary = await repository.writeSeries(
    closes,
    events,
    publishingRun.runId,
  );

  return {
    ...base,
    summary,
    runId: run.runId,
    runStatus: run.status,
  };
}
