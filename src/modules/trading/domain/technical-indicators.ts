/**
 * Indicadores técnicos de las lecciones (`technical-indicators-1.0.0`, `F11-10`).
 *
 * Son ayudas de dibujo, no dinero: se calculan en `number` sobre velas que ya se
 * van a dibujar en `number`, y ningún resultado se guarda ni entra en un P&L.
 * Las definiciones son las de sus autores, sin variantes:
 *
 * - **SMA(n):** media simple de los últimos `n` cierres.
 * - **EMA(n):** `α = 2 / (n + 1)`, sembrada con la SMA de los primeros `n`
 *   cierres. Antes de la semilla no hay valor, nunca un cierre que la reemplace.
 * - **VWAP:** precio típico `(H + L + C) / 3` ponderado por volumen, acumulado
 *   desde la primera vela de cada sesión y reiniciado en la siguiente (Berkowitz,
 *   Logue y Noser, 1988). Sin volumen todavía en la sesión, no hay VWAP.
 * - **RSI(14):** suavizado de Wilder (1978): la primera media de subas y bajas es
 *   la simple de los primeros `n` cambios y después `(previa × (n − 1) + actual) / n`.
 *   Sin bajas es 100; sin subas ni bajas no hay RSI (`null`), porque 50 sería un
 *   valor inventado.
 * - **MACD(12, 26, 9):** EMA(12) − EMA(26), su señal es la EMA(9) de esa línea y
 *   el histograma la diferencia (Appel, 1979).
 *
 * Una serie con un precio que no es finito y positivo, o un volumen negativo o
 * no finito, no se calcula: `ok: false` con el motivo. Un tramo sin historia
 * suficiente es `null`, nunca cero.
 */
export const TECHNICAL_INDICATORS_VERSION = "technical-indicators-1.0.0";

export type IndicatorSeries = readonly (number | null)[];

export type IndicatorFailure =
  | "non_positive_price"
  | "non_finite_value"
  | "negative_volume"
  | "invalid_period";

export type IndicatorResult<T = IndicatorSeries> =
  | { readonly ok: true; readonly values: T }
  | { readonly ok: false; readonly reason: IndicatorFailure };

export type IndicatorCandle = {
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  /** La sesión de la vela: el VWAP vuelve a empezar cuando cambia. */
  readonly session: string;
};

function checkPrices(values: readonly number[]): IndicatorFailure | null {
  for (const value of values) {
    if (!Number.isFinite(value)) return "non_finite_value";
    if (value <= 0) return "non_positive_price";
  }
  return null;
}

function checkPeriod(period: number): boolean {
  return Number.isInteger(period) && period >= 1;
}

export function sma(
  closes: readonly number[],
  period: number,
): IndicatorResult {
  if (!checkPeriod(period)) return { ok: false, reason: "invalid_period" };
  const failure = checkPrices(closes);
  if (failure !== null) return { ok: false, reason: failure };
  const values: (number | null)[] = [];
  let window = 0;
  for (const [index, close] of closes.entries()) {
    window += close;
    if (index >= period) window -= closes[index - period]!;
    values.push(index >= period - 1 ? window / period : null);
  }
  return { ok: true, values };
}

/** La EMA sobre valores ya validados, que pueden tener un tramo inicial nulo. */
function emaOf(values: IndicatorSeries, period: number): (number | null)[] {
  const alpha = 2 / (period + 1);
  const out: (number | null)[] = [];
  let seed: number[] = [];
  let previous: number | null = null;
  for (const value of values) {
    if (value === null) {
      out.push(null);
      continue;
    }
    if (previous === null) {
      seed.push(value);
      if (seed.length < period) {
        out.push(null);
        continue;
      }
      previous = seed.reduce((total, item) => total + item, 0) / period;
      seed = [];
      out.push(previous);
      continue;
    }
    previous = alpha * value + (1 - alpha) * previous;
    out.push(previous);
  }
  return out;
}

export function ema(
  closes: readonly number[],
  period: number,
): IndicatorResult {
  if (!checkPeriod(period)) return { ok: false, reason: "invalid_period" };
  const failure = checkPrices(closes);
  if (failure !== null) return { ok: false, reason: failure };
  return { ok: true, values: emaOf(closes, period) };
}

export function vwap(candles: readonly IndicatorCandle[]): IndicatorResult {
  const failure = checkPrices(
    candles.flatMap((candle) => [candle.high, candle.low, candle.close]),
  );
  if (failure !== null) return { ok: false, reason: failure };
  for (const candle of candles) {
    if (!Number.isFinite(candle.volume)) {
      return { ok: false, reason: "non_finite_value" };
    }
    if (candle.volume < 0) return { ok: false, reason: "negative_volume" };
  }
  const values: (number | null)[] = [];
  let session: string | null = null;
  let priceVolume = 0;
  let volume = 0;
  for (const candle of candles) {
    if (candle.session !== session) {
      session = candle.session;
      priceVolume = 0;
      volume = 0;
    }
    const typical = (candle.high + candle.low + candle.close) / 3;
    priceVolume += typical * candle.volume;
    volume += candle.volume;
    values.push(volume > 0 ? priceVolume / volume : null);
  }
  return { ok: true, values };
}

export function rsi(closes: readonly number[], period = 14): IndicatorResult {
  if (!checkPeriod(period)) return { ok: false, reason: "invalid_period" };
  const failure = checkPrices(closes);
  if (failure !== null) return { ok: false, reason: failure };
  const values: (number | null)[] = closes.map(() => null);
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index < closes.length; index += 1) {
    const change = closes[index]! - closes[index - 1]!;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (index <= period) {
      averageGain += gain / period;
      averageLoss += loss / period;
      if (index < period) continue;
    } else {
      averageGain = (averageGain * (period - 1) + gain) / period;
      averageLoss = (averageLoss * (period - 1) + loss) / period;
    }
    values[index] =
      averageLoss === 0
        ? averageGain === 0
          ? null
          : 100
        : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return { ok: true, values };
}

export type MacdValues = {
  readonly macd: IndicatorSeries;
  readonly signal: IndicatorSeries;
  readonly histogram: IndicatorSeries;
};

export function macd(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): IndicatorResult<MacdValues> {
  if (
    !checkPeriod(fast) ||
    !checkPeriod(slow) ||
    !checkPeriod(signalPeriod) ||
    fast >= slow
  ) {
    return { ok: false, reason: "invalid_period" };
  }
  const failure = checkPrices(closes);
  if (failure !== null) return { ok: false, reason: failure };
  const fastLine = emaOf(closes, fast);
  const slowLine = emaOf(closes, slow);
  const line = closes.map((_, index) => {
    const a = fastLine[index];
    const b = slowLine[index];
    return a == null || b == null ? null : a - b;
  });
  const signal = emaOf(line, signalPeriod);
  const histogram = line.map((value, index) => {
    const reference = signal[index];
    return value === null || reference == null ? null : value - reference;
  });
  return { ok: true, values: { macd: line, signal, histogram } };
}
