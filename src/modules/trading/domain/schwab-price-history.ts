import { z } from "zod";

import {
  createDecimalOperations,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";

import {
  exactDecimalSchema,
  exactIntegerSchema,
  failure,
  issuePath,
  readExactJson,
  type SchwabParseResult,
} from "./schwab-exact";

/**
 * Parser cerrado de `/marketdata/v1/pricehistory` (`schwab-price-history-1.0.0`,
 * ADR 0076, enmienda de `F11-07`).
 *
 * Medido el 2026-11-14 con la cuenta real: `{symbol, empty, candles}` y cada vela
 * `{open, high, low, close, volume, datetime}`, precios con hasta seis decimales
 * y `datetime` en epoch de milisegundos (la vela diaria, a la medianoche de
 * Chicago). Un pedido trae como mucho 40.000 velas. Con horario extendido el
 * `endDate` no se respeta, así que el parser recorta a la ventana pedida.
 *
 * Las velas se muestran y no se guardan: nada de esto llega a una base.
 */
export const SCHWAB_PRICE_HISTORY_PARSER_VERSION = "schwab-price-history-1.0.0";

export const MAX_CANDLES = 40_000;

const candleSchema = z
  .object({
    open: exactDecimalSchema,
    high: exactDecimalSchema,
    low: exactDecimalSchema,
    close: exactDecimalSchema,
    volume: exactDecimalSchema,
    datetime: exactIntegerSchema,
  })
  .strict();

const envelopeSchema = z
  .object({
    symbol: z.string().min(1).max(64),
    empty: z.boolean(),
    candles: z.array(candleSchema).max(MAX_CANDLES),
    previousClose: exactDecimalSchema.optional(),
    previousCloseDate: exactIntegerSchema.optional(),
  })
  .strict();

export type Candle = {
  /** Inicio de la vela, en epoch de milisegundos. */
  readonly time: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
};

export type PriceHistory = {
  readonly symbol: string;
  readonly candles: readonly Candle[];
};

const { parseDecimal } = createDecimalOperations((code) => new Error(code));

/**
 * Las velas de la respuesta dentro de `[from, to]`, en orden. Una vela con un
 * máximo debajo del mínimo, un precio que no es positivo o una hora repetida no
 * se dibuja: es un cable que cambió.
 */
export function parseSchwabPriceHistory(
  body: Uint8Array,
  window: {
    readonly symbol: string;
    readonly from: number;
    readonly to: number;
  },
): SchwabParseResult<PriceHistory> {
  const json = readExactJson(body);
  if (json === null) return failure("invalid_json");
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) {
    return failure("price_history_schema_changed", issuePath(envelope.error));
  }
  if (envelope.data.symbol !== window.symbol) {
    return failure("price_history_symbol_mismatch", "symbol");
  }
  if (envelope.data.empty !== (envelope.data.candles.length === 0)) {
    return failure("price_history_empty_mismatch", "empty");
  }

  const candles: Candle[] = [];
  let previous = -Infinity;
  for (const [index, candle] of envelope.data.candles.entries()) {
    const path = `candles.[${index}]`;
    if (candle.datetime <= previous) {
      return failure("price_history_not_ascending", `${path}.datetime`);
    }
    previous = candle.datetime;
    const [open, high, low, close] = [
      candle.open,
      candle.high,
      candle.low,
      candle.close,
    ].map((value) => parseDecimal(value, path));
    if (!low!.greaterThan(ZERO)) {
      return failure("price_history_non_positive", `${path}.low`);
    }
    if (
      high!.lessThan(low!) ||
      open!.greaterThan(high!) ||
      open!.lessThan(low!) ||
      close!.greaterThan(high!) ||
      close!.lessThan(low!)
    ) {
      return failure("price_history_candle_inconsistent", path);
    }
    if (parseDecimal(candle.volume, path).lessThan(ZERO)) {
      return failure("price_history_negative_volume", `${path}.volume`);
    }
    if (candle.datetime < window.from || candle.datetime > window.to) continue;
    candles.push({
      time: candle.datetime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    });
  }

  return { ok: true, value: { symbol: envelope.data.symbol, candles } };
}
