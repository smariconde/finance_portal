/**
 * Velas esquemáticas de las lecciones (`schematic-candles-1.0.0`, `F11-10`).
 *
 * Decisión del owner: el patrón de cada lección se dibuja con velas declaradas
 * en el repo, que no caducan ni gastan cuota de Schwab; los ejemplos reales son
 * sus propios trades etiquetados con el setup. Estas velas no son de ningún
 * ticker ni de ninguna fecha, y la página lo dice.
 *
 * Una serie se declara por tramos: cada uno lleva el cierre a un precio en un
 * número de velas, con un zigzag de amplitud dada, y puede abrir con un gap o
 * tener techo y piso para que ninguna mecha cruce un nivel. El ruido sale de un
 * generador con semilla, así que la misma declaración da siempre las mismas
 * velas, y las velas que enseñan una forma (un martillo, una envolvente) se
 * declaran enteras. Los tests de cada lección comprueban que el dibujo muestra
 * lo que dicen sus reglas.
 */
export const SCHEMATIC_CANDLES_VERSION = "schematic-candles-1.0.0";

export type SchematicCandle = {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
};

export type SchematicLeg = {
  readonly bars: number;
  /** El cierre de la última vela del tramo, exacto. */
  readonly to: number;
  /** Amplitud del zigzag de los cierres intermedios, en precio. */
  readonly swing?: number;
  /** Volumen relativo al de base. */
  readonly volume?: number;
  /** La primera vela abre a esta distancia del cierre anterior. */
  readonly gap?: number;
  /** Ninguna mecha del tramo sobre este precio. */
  readonly ceiling?: number;
  /** Ninguna mecha del tramo bajo este precio. */
  readonly floor?: number;
};

export type SchematicSpec = {
  readonly start: number;
  readonly seed: number;
  /** Largo máximo de una mecha, en precio. */
  readonly wick: number;
  readonly baseVolume: number;
  readonly legs: readonly SchematicLeg[];
  /** Velas declaradas enteras o en parte, por índice. */
  readonly overrides?: Readonly<Record<number, Partial<SchematicCandle>>>;
};

/** Mulberry32: chico, determinista y suficiente para ruido de dibujo. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const cents = (value: number) => Math.round(value * 100) / 100;

export function schematicCandles(spec: SchematicSpec): SchematicCandle[] {
  const next = random(spec.seed);
  const candles: SchematicCandle[] = [];
  let close = spec.start;
  for (const leg of spec.legs) {
    if (!Number.isInteger(leg.bars) || leg.bars < 1) {
      throw new Error("A schematic leg needs at least one bar.");
    }
    const from = close;
    for (let step = 1; step <= leg.bars; step += 1) {
      const open = cents(step === 1 ? close + (leg.gap ?? 0) : close);
      const linear = from + ((leg.to - from) * step) / leg.bars;
      const zig = step % 2 === 1 ? 1 : -1;
      const swing =
        step === leg.bars ? 0 : zig * (leg.swing ?? 0) * (0.4 + 0.6 * next());
      close = cents(step === leg.bars ? leg.to : linear + swing);
      let high = Math.max(open, close) + spec.wick * next();
      let low = Math.min(open, close) - spec.wick * next();
      if (leg.ceiling !== undefined) high = Math.min(high, leg.ceiling);
      if (leg.floor !== undefined) low = Math.max(low, leg.floor);
      candles.push({
        open,
        high: cents(Math.max(high, open, close)),
        low: cents(Math.min(low, open, close)),
        close,
        volume: Math.round(
          spec.baseVolume * (leg.volume ?? 1) * (0.75 + 0.5 * next()),
        ),
      });
    }
  }
  for (const [key, override] of Object.entries(spec.overrides ?? {})) {
    const index = Number(key);
    const base = candles[index];
    if (base === undefined) {
      throw new Error(`Schematic override outside the series: ${index}`);
    }
    candles[index] = { ...base, ...override };
    // La vela siguiente abre donde cerró la declarada, salvo que también lo esté.
    const following = candles[index + 1];
    if (
      following !== undefined &&
      override.close !== undefined &&
      spec.overrides?.[index + 1]?.open === undefined
    ) {
      candles[index + 1] = {
        ...following,
        open: override.close,
        high: Math.max(following.high, override.close),
        low: Math.min(following.low, override.close),
      };
    }
  }
  for (const [index, candle] of candles.entries()) {
    const { open, high, low, close, volume } = candle;
    if (
      !(low > 0) ||
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      !(volume >= 0)
    ) {
      throw new Error(`Schematic candle ${index} is inconsistent.`);
    }
  }
  return candles;
}
