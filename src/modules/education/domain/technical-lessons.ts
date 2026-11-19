import {
  DECLARED_SETUPS,
  TRADING_SETUPS_VERSION,
} from "@/modules/trading/domain/trading-setups";
import {
  ema,
  macd,
  rsi,
  sma,
  vwap,
  type IndicatorSeries,
} from "@/modules/trading/domain/technical-indicators";

import { LESSON_CATALOG } from "./lesson-catalog";
import {
  schematicCandles,
  type SchematicCandle,
  type SchematicSpec,
} from "./schematic-candles";
import { TRADING_GLOSSARY } from "./trading-glossary";

/**
 * Las lecciones de análisis técnico (`technical-lessons-1.1.0`, `F11-10`).
 *
 * Decisiones del owner (2026-11-15): cada lección es un gráfico anotado y unas
 * pocas reglas de una línea, con los errores comunes plegados y, en los setups,
 * el historial propio del diario; nada de prosa de curso. Cada setup declarado
 * en `trading-setups-1.0.0` tiene exactamente una lección, atada por su código,
 * y un setup nuevo sin lección rompe el test.
 *
 * Las reglas numeran las marcas del gráfico (①, ②…) para que el texto y el
 * dibujo se lean juntos. El contenido es estático, versionado en el repo y
 * escrito por el agente a partir de las fuentes del glosario; el owner lo
 * revisa antes de cerrar el slice.
 */
export const TECHNICAL_LESSONS_VERSION = "technical-lessons-1.1.0";

export type LessonTimeframe = "5m" | "1d";
export type LessonOverlay = "ema9" | "ema20" | "sma20" | "sma50" | "vwap";
export type LessonPanel = "rsi" | "macd";
export type LessonTone = "long" | "short" | "neutral";
export type LevelTone =
  "support" | "resistance" | "entry" | "stop" | "target" | "neutral";

export type LessonLevel = {
  readonly label: string;
  readonly price: number;
  readonly tone: LevelTone;
};

export type LessonMark = {
  /** El número que la regla cita: ①, ②… */
  readonly n: number;
  readonly index: number;
  readonly label: string;
  readonly tone: LessonTone;
  /** Sobre el máximo o bajo el mínimo de la vela. */
  readonly at: "high" | "low";
};

export type LessonZone = {
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly low: number;
  readonly high: number;
};

export type LessonChartSpec = {
  readonly timeframe: LessonTimeframe;
  readonly candles: SchematicSpec;
  readonly overlays: readonly LessonOverlay[];
  readonly panels: readonly LessonPanel[];
  readonly levels: readonly LessonLevel[];
  readonly marks: readonly LessonMark[];
  readonly zones: readonly LessonZone[];
};

export type RuleKind =
  "read" | "context" | "entry" | "stop" | "target" | "invalidation";

export type LessonRule = {
  readonly kind: RuleKind;
  readonly text: string;
  /** La marca del gráfico que la regla señala. */
  readonly mark?: number;
};

/** El ejemplo de tamaño de la lección de riesgo, calculado con el planner. */
export type SizingExample = {
  readonly liquidationValue: string;
  readonly riskPerTradePercent: string;
  readonly entry: string;
  readonly stop: string;
  readonly target: string;
};

export type LessonSpec = {
  readonly slug: string;
  readonly kind: "concept" | "setup";
  /** El nombre en inglés: el del setup o el del concepto. */
  readonly title: string;
  readonly es: string;
  /** Una línea: la idea entera de la lección. */
  readonly idea: string;
  /** El código de `trading-setups-1.0.0`; sólo en un setup. */
  readonly setupCode: string | null;
  readonly chart: LessonChartSpec;
  readonly rules: readonly LessonRule[];
  readonly mistakes: readonly string[];
  readonly terms: readonly string[];
  /** Lecciones que conviene leer al lado, por slug. */
  readonly related: readonly string[];
  readonly sizing?: SizingExample;
};

export type Lesson = LessonSpec & {
  readonly candles: readonly SchematicCandle[];
};

export const RULE_LABELS: Readonly<Record<RuleKind, string>> = {
  read: "Lectura",
  context: "Contexto",
  entry: "Entrada",
  stop: "Stop",
  target: "Target",
  invalidation: "Invalida",
};

function buildLessons(specs: readonly LessonSpec[]): readonly Lesson[] {
  const slugs = new Set<string>();
  const setupCodes = new Set<string>();
  const declared = new Set(DECLARED_SETUPS.map((setup) => setup.code));
  for (const spec of specs) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(spec.slug)) {
      throw new Error(`Lesson slug malformed: ${spec.slug}`);
    }
    if (slugs.has(spec.slug)) throw new Error(`Lesson repeated: ${spec.slug}`);
    slugs.add(spec.slug);
    if ((spec.kind === "setup") !== (spec.setupCode !== null)) {
      throw new Error(`Lesson ${spec.slug}: only a setup has a setup code`);
    }
    if (spec.setupCode !== null) {
      if (!declared.has(spec.setupCode)) {
        throw new Error(
          `Lesson ${spec.slug}: ${spec.setupCode} is not in ${TRADING_SETUPS_VERSION}`,
        );
      }
      if (setupCodes.has(spec.setupCode)) {
        throw new Error(`Setup with two lessons: ${spec.setupCode}`);
      }
      setupCodes.add(spec.setupCode);
    }
    for (const term of spec.terms) {
      if (!TRADING_GLOSSARY.entries.has(term)) {
        throw new Error(
          `Lesson ${spec.slug} uses ${term}, not in the glossary`,
        );
      }
    }
  }
  for (const spec of specs) {
    for (const related of spec.related) {
      if (!slugs.has(related) || related === spec.slug) {
        throw new Error(`Lesson ${spec.slug} relates to ${related}`);
      }
    }
  }
  return Object.freeze(
    specs.map((spec) => {
      const candles = schematicCandles(spec.chart.candles);
      for (const mark of spec.chart.marks) {
        if (candles[mark.index] === undefined) {
          throw new Error(`Lesson ${spec.slug}: mark ${mark.n} outside`);
        }
      }
      for (const rule of spec.rules) {
        if (
          rule.mark !== undefined &&
          !spec.chart.marks.some((mark) => mark.n === rule.mark)
        ) {
          throw new Error(`Lesson ${spec.slug}: rule cites mark ${rule.mark}`);
        }
      }
      return { ...spec, candles };
    }),
  );
}

export const TECHNICAL_LESSONS: readonly Lesson[] =
  buildLessons(LESSON_CATALOG);

export function lessonOf(slug: string): Lesson | null {
  return TECHNICAL_LESSONS.find((lesson) => lesson.slug === slug) ?? null;
}

/** La lección de un setup declarado; uno propio (`own-*`) no tiene. */
export function lessonOfSetup(code: string | null): Lesson | null {
  if (code === null) return null;
  return TECHNICAL_LESSONS.find((lesson) => lesson.setupCode === code) ?? null;
}

/** Por código de setup declarado, el slug de su lección. */
export const SETUP_LESSON_SLUGS: Readonly<Record<string, string>> =
  Object.freeze(
    Object.fromEntries(
      TECHNICAL_LESSONS.filter((lesson) => lesson.setupCode !== null).map(
        (lesson) => [lesson.setupCode!, lesson.slug],
      ),
    ),
  );

export type LessonChartRow = {
  readonly index: number;
  /** `09:35` en una sesión de 5 minutos; `null` en velas diarias sin fecha. */
  readonly clock: string | null;
  readonly candle: SchematicCandle;
  readonly overlays: Readonly<Partial<Record<LessonOverlay, number | null>>>;
  readonly rsi: number | null;
  readonly macd: number | null;
  readonly signal: number | null;
  readonly histogram: number | null;
};

function seriesOf(result: { ok: boolean; values?: IndicatorSeries }) {
  if (!result.ok || result.values === undefined) {
    throw new Error("A schematic series cannot fail an indicator.");
  }
  return result.values;
}

/** Las filas del gráfico de una lección con sus indicadores calculados. */
export function lessonChartRows(lesson: Lesson): LessonChartRow[] {
  const closes = lesson.candles.map((candle) => candle.close);
  const overlays: Partial<Record<LessonOverlay, IndicatorSeries>> = {};
  for (const overlay of lesson.chart.overlays) {
    overlays[overlay] =
      overlay === "vwap"
        ? seriesOf(
            vwap(lesson.candles.map((candle) => ({ ...candle, session: "s" }))),
          )
        : overlay === "ema9"
          ? seriesOf(ema(closes, 9))
          : overlay === "ema20"
            ? seriesOf(ema(closes, 20))
            : overlay === "sma20"
              ? seriesOf(sma(closes, 20))
              : seriesOf(sma(closes, 50));
  }
  const rsiValues = lesson.chart.panels.includes("rsi")
    ? seriesOf(rsi(closes))
    : null;
  const macdResult = lesson.chart.panels.includes("macd") ? macd(closes) : null;
  if (macdResult !== null && !macdResult.ok) {
    throw new Error("A schematic series cannot fail MACD.");
  }
  const macdValues = macdResult?.ok === true ? macdResult.values : null;
  return lesson.candles.map((candle, index) => {
    const minutes = 9 * 60 + 30 + index * 5;
    return {
      index,
      clock:
        lesson.chart.timeframe === "5m"
          ? `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
          : null,
      candle,
      overlays: Object.fromEntries(
        Object.entries(overlays).map(([key, values]) => [
          key,
          values[index] ?? null,
        ]),
      ),
      rsi: rsiValues?.[index] ?? null,
      macd: macdValues?.macd[index] ?? null,
      signal: macdValues?.signal[index] ?? null,
      histogram: macdValues?.histogram[index] ?? null,
    };
  });
}
