import { z } from "zod";

import {
  exactDecimalSchema,
  exactIntegerSchema,
  failure,
  issuePath,
  readExactJson,
  type SchwabParseResult,
} from "./schwab-exact";

/**
 * Parser cerrado de `/marketdata/v1/quotes` (`schwab-quotes-1.0.0`, ADR 0076).
 *
 * Medido el 2026-11-13 con una acción y un ETF (`fields=quote,reference`): un
 * objeto por símbolo con `quote` de precios en decimal y horas en epoch de
 * milisegundos. Sólo se piden acciones y ETFs; la cotización de una opción tiene
 * otras claves que no se midieron y no se pide. Las cotizaciones se muestran y no
 * se guardan.
 */
export const SCHWAB_QUOTES_PARSER_VERSION = "schwab-quotes-1.0.0";

const optionalDecimal = exactDecimalSchema.optional();

const equityQuoteSchema = z
  .object({
    "52WeekHigh": optionalDecimal,
    "52WeekLow": optionalDecimal,
    askMICId: z.string().max(8).optional(),
    askPrice: optionalDecimal,
    askSize: optionalDecimal,
    askTime: exactIntegerSchema.optional(),
    bidMICId: z.string().max(8).optional(),
    bidPrice: optionalDecimal,
    bidSize: optionalDecimal,
    bidTime: exactIntegerSchema.optional(),
    closePrice: optionalDecimal,
    highPrice: optionalDecimal,
    lastMICId: z.string().max(8).optional(),
    lastPrice: exactDecimalSchema,
    lastSize: optionalDecimal,
    lowPrice: optionalDecimal,
    mark: optionalDecimal,
    markChange: optionalDecimal,
    markPercentChange: optionalDecimal,
    netChange: optionalDecimal,
    netPercentChange: optionalDecimal,
    openPrice: optionalDecimal,
    postMarketChange: optionalDecimal,
    postMarketPercentChange: optionalDecimal,
    quoteTime: exactIntegerSchema,
    securityStatus: z.string().max(32).optional(),
    totalVolume: optionalDecimal,
    tradeTime: exactIntegerSchema.optional(),
  })
  .strict();

const referenceSchema = z
  .object({
    cusip: z.string().max(16).optional(),
    description: z.string().max(256).optional(),
    exchange: z.string().max(8).optional(),
    exchangeName: z.string().max(64).optional(),
    isHardToBorrow: z.boolean().optional(),
    isShortable: z.boolean().optional(),
    htbQuantity: optionalDecimal,
    htbRate: optionalDecimal,
    optionable: z.boolean().optional(),
    ethOptionEligible: z.boolean().optional(),
  })
  .strict();

const quoteEntrySchema = z
  .object({
    assetMainType: z.enum(["EQUITY"]),
    assetSubType: z.string().max(16).optional(),
    quoteType: z.string().max(16).optional(),
    realtime: z.boolean(),
    ssid: exactIntegerSchema.optional(),
    symbol: z.string().min(1).max(64),
    quote: equityQuoteSchema,
    reference: referenceSchema.optional(),
  })
  .strict();

const errorsSchema = z
  .object({
    invalidSymbols: z.array(z.string().max(64)).max(64).optional(),
    invalidCusips: z.array(z.string().max(64)).max(64).optional(),
    invalidSSIDs: z.array(z.unknown()).max(64).optional(),
  })
  .strict();

export type SchwabQuote = {
  readonly symbol: string;
  readonly lastPrice: string;
  readonly mark: string | null;
  readonly bidPrice: string | null;
  readonly askPrice: string | null;
  readonly closePrice: string | null;
  readonly netChange: string | null;
  /** En puntos porcentuales, como lo publica Schwab. */
  readonly netPercentChange: string | null;
  /** La hora de la cotización, en ISO; la dice Schwab, no el portal. */
  readonly quotedAt: string;
  readonly realtime: boolean;
  readonly securityStatus: string | null;
};

export type SchwabQuotes = {
  readonly quotes: readonly SchwabQuote[];
  readonly invalidSymbols: readonly string[];
};

function isoFromEpochMs(value: number): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseSchwabQuotes(
  body: Uint8Array,
): SchwabParseResult<SchwabQuotes> {
  const json = readExactJson(body);
  if (json === null) return failure("invalid_json");
  if (typeof json !== "object" || Array.isArray(json)) {
    return failure("quotes_schema_changed");
  }

  const quotes: SchwabQuote[] = [];
  let invalidSymbols: readonly string[] = [];

  for (const [key, raw] of Object.entries(json as Record<string, unknown>)) {
    if (key === "errors") {
      const errors = errorsSchema.safeParse(raw);
      if (!errors.success) {
        return failure(
          "quotes_schema_changed",
          issuePath(errors.error, "errors"),
        );
      }
      invalidSymbols = errors.data.invalidSymbols ?? [];
      continue;
    }

    const entry = quoteEntrySchema.safeParse(raw);
    if (!entry.success) {
      return failure(
        "quote_schema_changed",
        issuePath(entry.error, "<symbol>"),
      );
    }
    if (entry.data.symbol !== key) {
      return failure("quote_symbol_mismatch", "<symbol>.symbol");
    }
    const quotedAt = isoFromEpochMs(entry.data.quote.quoteTime);
    if (quotedAt === null)
      return failure("quote_time_invalid", "<symbol>.quote.quoteTime");

    const quote = entry.data.quote;
    quotes.push({
      symbol: entry.data.symbol,
      lastPrice: quote.lastPrice,
      mark: quote.mark ?? null,
      bidPrice: quote.bidPrice ?? null,
      askPrice: quote.askPrice ?? null,
      closePrice: quote.closePrice ?? null,
      netChange: quote.netChange ?? null,
      netPercentChange: quote.netPercentChange ?? null,
      quotedAt,
      realtime: entry.data.realtime,
      securityStatus: quote.securityStatus ?? null,
    });
  }

  return {
    ok: true,
    value: {
      quotes: quotes.sort((a, b) => a.symbol.localeCompare(b.symbol)),
      invalidSymbols,
    },
  };
}
