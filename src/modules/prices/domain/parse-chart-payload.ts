import { z } from "zod";

/**
 * Parser del payload de la serie diaria
 * ([ADR 0026](../../../../docs/architecture/adr/0026-daily-prices-source.md)).
 *
 * Devuelve la serie **tal como la fuente la publica** —o sea, ajustada— más los
 * eventos fechados. Des-ajustarla es `unadjust-series.ts`, y la separación es
 * deliberada: el parser dice qué trajo el cable y la regla dice qué se guarda.
 *
 * El payload no está documentado como API pública, así que el parser no asume
 * nada: valida la forma con Zod, rechaza por nombre lo que no reconoce y **nunca
 * repite el valor recibido en el rechazo** (`TM-02`).
 */
export const CHART_PARSER_VERSION = "yahoo-chart-1.0.0";

const finiteNumber = z.number().finite();

const chartPayloadSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            currency: z.string().trim().min(1).max(8).nullish(),
            symbol: z.string().trim().min(1).max(32),
            /** Desfase en segundos del mercado respecto de UTC. */
            gmtoffset: z.number().int().nullish(),
          }),
          timestamp: z.array(z.number().int()).nullish(),
          indicators: z.object({
            quote: z
              .array(
                z.object({
                  close: z.array(finiteNumber.nullable()).nullish(),
                }),
              )
              .min(1),
          }),
          events: z
            .object({
              splits: z
                .record(
                  z.string(),
                  z.object({
                    date: z.number().int(),
                    numerator: finiteNumber,
                    denominator: finiteNumber,
                  }),
                )
                .nullish(),
              dividends: z
                .record(
                  z.string(),
                  z.object({
                    date: z.number().int(),
                    amount: finiteNumber,
                  }),
                )
                .nullish(),
            })
            .nullish(),
        }),
      )
      .nullish(),
    error: z.unknown().nullish(),
  }),
});

export type ChartRejectionCode =
  /** El cuerpo no tiene la forma del payload. */
  | "payload_unparsable"
  /** La fuente devolvió un error explícito en vez de una serie. */
  | "source_reported_error"
  /** No vino ningún resultado: símbolo desconocido o sin cobertura. */
  | "no_result"
  /** Vino un resultado sin ruedas. */
  | "empty_series"
  /** `timestamp` y `close` no tienen el mismo largo: no se aparean por posición. */
  | "series_length_mismatch"
  /** La serie no declara moneda y un precio sin moneda no es un precio. */
  | "currency_missing"
  /** Un split con numerador o denominador cero no define un ratio. */
  | "invalid_split";

export type ChartBar = {
  readonly marketDate: string;
  /** Cierre publicado por la fuente, todavía ajustado. */
  readonly close: string;
};

export type ChartSplit = {
  readonly effectiveOn: string;
  readonly ratio: string;
};

export type ChartDividend = {
  readonly effectiveOn: string;
  readonly amount: string;
};

export type ChartParseResult =
  | {
      readonly ok: true;
      readonly parserVersion: string;
      readonly symbol: string;
      readonly currency: string;
      readonly bars: readonly ChartBar[];
      readonly splits: readonly ChartSplit[];
      readonly dividends: readonly ChartDividend[];
      /** Ruedas sin cierre publicado: se cuentan y no se inventan. */
      readonly barsWithoutClose: number;
    }
  | {
      readonly ok: false;
      readonly parserVersion: string;
      readonly code: ChartRejectionCode;
    };

function reject(code: ChartRejectionCode): ChartParseResult {
  return { ok: false, parserVersion: CHART_PARSER_VERSION, code };
}

/**
 * Fecha de mercado de un instante, en la zona del mercado.
 *
 * El timestamp de una rueda diaria es su apertura, y convertirlo en UTC correría
 * la fecha de cualquier mercado al oeste de Greenwich: una apertura de las 9:30
 * en Nueva York es 13:30 UTC el mismo día, pero un mercado que abriera a las
 * 21:00 locales caería al día siguiente. Se usa el desfase que declara la propia
 * respuesta.
 */
function marketDateOf(epochSeconds: number, gmtOffsetSeconds: number): string {
  const shifted = new Date((epochSeconds + gmtOffsetSeconds) * 1000);

  return shifted.toISOString().slice(0, 10);
}

/**
 * Precisión que el payload puede cargar de verdad.
 *
 * La fuente transmite los precios como **float32 ensanchado a double**: el
 * cierre de 22,482 viaja literalmente como `22.48200035095215`, y el de 122,44
 * como `122.44000244140625`. Leerlos como exactos guardaría ese ruido en la
 * tabla más grande del proyecto y lo arrastraría a cada multiplicación del
 * des-ajuste —un 10:1 lo convierte en 1.224,40002—.
 *
 * Un float32 garantiza unos siete dígitos significativos, así que redondear a
 * siete no pierde nada que el payload pudiera estar diciendo: recupera el valor
 * cotizado y descarta el artefacto de la representación. Es una normalización
 * **declarada**, y por eso viaja en `CHART_PARSER_VERSION`: si algún día la
 * fuente empezara a mandar doubles de verdad, esto cambia de versión.
 */
const SOURCE_SIGNIFICANT_DIGITS = 7;

/**
 * Formatea un número del payload como decimal canónico, sin notación científica
 * y sin el ruido de la representación de origen.
 */
function toDecimalString(value: number): string {
  if (value === 0) {
    return "0";
  }

  // `toPrecision` puede devolver notación exponencial para valores muy chicos o
  // muy grandes; `Number` la deshace y `toFixed` la fija en decimal.
  const rounded = Number(value.toPrecision(SOURCE_SIGNIFICANT_DIGITS));
  const fixed = rounded.toFixed(10);

  return fixed.includes(".")
    ? fixed.replace(/0+$/u, "").replace(/\.$/u, "")
    : fixed;
}

export function parseChartPayload(body: unknown): ChartParseResult {
  const parsed = chartPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return reject("payload_unparsable");
  }

  const { chart } = parsed.data;

  if (chart.error !== null && chart.error !== undefined) {
    return reject("source_reported_error");
  }

  const result = chart.result?.[0];

  if (result === undefined) {
    return reject("no_result");
  }

  const currency = result.meta.currency?.trim().toUpperCase();

  if (currency === undefined || currency.length === 0) {
    return reject("currency_missing");
  }

  const timestamps = result.timestamp ?? [];
  const closes = result.indicators.quote[0]?.close ?? [];

  if (timestamps.length === 0) {
    return reject("empty_series");
  }

  if (timestamps.length !== closes.length) {
    return reject("series_length_mismatch");
  }

  const gmtOffset = result.meta.gmtoffset ?? 0;
  const bars: ChartBar[] = [];
  let barsWithoutClose = 0;

  for (const [index, timestamp] of timestamps.entries()) {
    const close = closes[index];

    // Una rueda sin cierre publicado —halt, feriado a medias— no se rellena con
    // el anterior ni con cero: se cuenta y se deja afuera. Un hueco es un hueco,
    // y la matriz ya tiene un motivo declarado para no dibujar una serie con
    // huecos por encima de su tolerancia.
    if (close === null || close === undefined) {
      barsWithoutClose += 1;
      continue;
    }

    bars.push({
      marketDate: marketDateOf(timestamp, gmtOffset),
      close: toDecimalString(close),
    });
  }

  const splits: ChartSplit[] = [];

  for (const split of Object.values(result.events?.splits ?? {})) {
    if (split.numerator <= 0 || split.denominator <= 0) {
      return reject("invalid_split");
    }

    splits.push({
      effectiveOn: marketDateOf(split.date, gmtOffset),
      ratio: toDecimalString(split.numerator / split.denominator),
    });
  }

  const dividends: ChartDividend[] = [];

  for (const dividend of Object.values(result.events?.dividends ?? {})) {
    if (dividend.amount <= 0) {
      continue;
    }

    dividends.push({
      effectiveOn: marketDateOf(dividend.date, gmtOffset),
      amount: toDecimalString(dividend.amount),
    });
  }

  return {
    ok: true,
    parserVersion: CHART_PARSER_VERSION,
    symbol: result.meta.symbol,
    currency,
    bars,
    splits: splits.sort((left, right) =>
      left.effectiveOn < right.effectiveOn ? -1 : 1,
    ),
    dividends: dividends.sort((left, right) =>
      left.effectiveOn < right.effectiveOn ? -1 : 1,
    ),
    barsWithoutClose,
  };
}
