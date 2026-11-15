import { describe, expect, it } from "vitest";

import { planPosition } from "@/modules/trading/domain/position-size-risk";
import { DECLARED_SETUPS } from "@/modules/trading/domain/trading-setups";

import {
  SETUP_LESSON_SLUGS,
  TECHNICAL_LESSONS,
  lessonChartRows,
  lessonOf,
  lessonOfSetup,
  type Lesson,
  type LessonChartRow,
} from "./technical-lessons";
import { TRADING_GLOSSARY } from "./trading-glossary";

function lesson(slug: string): Lesson {
  const found = lessonOf(slug);
  if (found === null) throw new Error(`No lesson ${slug}`);
  return found;
}

function markIndex(of: Lesson, n: number): number {
  const mark = of.chart.marks.find((item) => item.n === n);
  if (mark === undefined) throw new Error(`${of.slug} has no mark ${n}`);
  return mark.index;
}

function level(of: Lesson, tone: string): number {
  const found = of.chart.levels.find((item) => item.tone === tone);
  if (found === undefined) throw new Error(`${of.slug} has no ${tone} level`);
  return found.price;
}

function ruleMark(of: Lesson, kind: string): number {
  const rule = of.rules.find((item) => item.kind === kind && item.mark);
  if (rule?.mark === undefined) throw new Error(`${of.slug}: no ${kind} mark`);
  return markIndex(of, rule.mark);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

const body = (row: LessonChartRow) =>
  Math.abs(row.candle.close - row.candle.open);
const upperWick = (row: LessonChartRow) =>
  row.candle.high - Math.max(row.candle.open, row.candle.close);
const lowerWick = (row: LessonChartRow) =>
  Math.min(row.candle.open, row.candle.close) - row.candle.low;
const green = (row: LessonChartRow) => row.candle.close > row.candle.open;

describe("technical-lessons-1.0.0", () => {
  it("gives every declared setup exactly one lesson, tied by its code", () => {
    for (const setup of DECLARED_SETUPS) {
      const found = lessonOfSetup(setup.code);
      expect(found?.kind, setup.code).toBe("setup");
      expect(found?.title, setup.code).toBe(setup.label);
    }
    expect(Object.keys(SETUP_LESSON_SLUGS).sort()).toEqual(
      DECLARED_SETUPS.map((setup) => setup.code).sort(),
    );
    const setups = TECHNICAL_LESSONS.filter((item) => item.kind === "setup");
    expect(setups).toHaveLength(DECLARED_SETUPS.length);
    expect(lessonOfSetup("own-wedge")).toBeNull();
    expect(lessonOfSetup(null)).toBeNull();
  });

  it("uses only glossary terms and keeps rules to one line", () => {
    for (const item of TECHNICAL_LESSONS) {
      for (const term of item.terms) {
        expect(TRADING_GLOSSARY.entries.has(term), `${item.slug}:${term}`).toBe(
          true,
        );
      }
      expect(item.idea.length, item.slug).toBeLessThanOrEqual(100);
      for (const rule of item.rules) {
        expect(
          rule.text.length,
          `${item.slug}: ${rule.text}`,
        ).toBeLessThanOrEqual(80);
      }
      expect(item.mistakes.length, item.slug).toBeGreaterThanOrEqual(2);
      for (const mark of item.chart.marks) {
        expect(
          item.rules.some((rule) => rule.mark === mark.n),
          `${item.slug}: mark ${mark.n} has no rule`,
        ).toBe(true);
      }
    }
  });

  it("draws every trade lesson as a winner whose stop is never touched first", () => {
    const trades = TECHNICAL_LESSONS.filter(
      (item) => item.kind === "setup" || item.slug === "gestion-de-riesgo",
    );
    for (const item of trades) {
      const rows = lessonChartRows(item);
      const entryAt = ruleMark(item, "entry");
      const targetAt = ruleMark(item, "target");
      const entry = level(item, "entry");
      const stop = level(item, "stop");
      const target = level(item, "target");
      const entryCandle = rows[entryAt]!.candle;
      expect(
        entry,
        `${item.slug}: entry inside its candle`,
      ).toBeGreaterThanOrEqual(entryCandle.low);
      expect(
        entry,
        `${item.slug}: entry inside its candle`,
      ).toBeLessThanOrEqual(entryCandle.high);
      expect(stop, item.slug).toBeLessThan(entry);
      expect(target, item.slug).toBeGreaterThan(entry);
      expect(
        (target - entry) / (entry - stop),
        `${item.slug}: reward/risk`,
      ).toBeGreaterThanOrEqual(1.5);
      expect(targetAt, item.slug).toBeGreaterThan(entryAt);
      const between = rows.slice(entryAt + 1, targetAt + 1);
      expect(
        Math.min(...between.map((row) => row.candle.low)),
        `${item.slug}: stop untouched`,
      ).toBeGreaterThan(stop);
      expect(rows[targetAt]!.candle.high, item.slug).toBeGreaterThanOrEqual(
        target,
      );
      expect(
        rows
          .slice(entryAt + 1, targetAt)
          .every((row) => row.candle.high < target),
        `${item.slug}: the target mark is the first touch`,
      ).toBe(true);
    }
  });

  it("draws the candle shapes the candlestick lesson names", () => {
    const item = lesson("velas");
    const rows = lessonChartRows(item);
    const hammer = rows[markIndex(item, 1)]!;
    expect(lowerWick(hammer)).toBeGreaterThanOrEqual(2 * body(hammer));
    expect(upperWick(hammer)).toBeLessThanOrEqual(body(hammer));
    const bullish = rows[markIndex(item, 2)]!;
    const beforeBullish = rows[markIndex(item, 2) - 1]!;
    expect(green(bullish) && !green(beforeBullish)).toBe(true);
    expect(bullish.candle.open).toBeLessThanOrEqual(beforeBullish.candle.close);
    expect(bullish.candle.close).toBeGreaterThanOrEqual(
      beforeBullish.candle.open,
    );
    const doji = rows[markIndex(item, 3)]!;
    expect(body(doji)).toBeLessThanOrEqual(
      0.1 * (doji.candle.high - doji.candle.low),
    );
    const star = rows[markIndex(item, 4)]!;
    expect(upperWick(star)).toBeGreaterThanOrEqual(2 * body(star));
    expect(lowerWick(star)).toBeLessThanOrEqual(body(star));
    const bearish = rows[markIndex(item, 5)]!;
    const beforeBearish = rows[markIndex(item, 5) - 1]!;
    expect(!green(bearish) && green(beforeBearish)).toBe(true);
    expect(bearish.candle.open).toBeGreaterThanOrEqual(
      beforeBearish.candle.close,
    );
    expect(bearish.candle.close).toBeLessThanOrEqual(beforeBearish.candle.open);
    // El martillo llega al final de una baja y la estrella al de una suba.
    expect(rows[0]!.candle.close).toBeGreaterThan(hammer.candle.close);
    expect(star.candle.close).toBeGreaterThan(rows[11]!.candle.close);
  });

  it("draws the swing sequence the trend lesson reads", () => {
    const item = lesson("tendencia");
    const rows = lessonChartRows(item);
    const low = (n: number) => rows[markIndex(item, n)]!.candle.low;
    const high = (n: number) => rows[markIndex(item, n)]!.candle.high;
    const lastHigherLow = level(item, "support");
    expect(low(3)).toBeGreaterThan(low(1));
    expect(high(2)).toBeGreaterThan(
      Math.max(...rows.slice(0, markIndex(item, 1)).map((r) => r.candle.high)),
    );
    const peak = Math.max(...rows.map((row) => row.candle.high));
    expect(high(4)).toBeLessThan(peak);
    expect(low(5)).toBeLessThan(lastHigherLow);
    // Hasta el lower high, ningún mínimo perforó al higher low anterior.
    expect(
      Math.min(
        ...rows
          .slice(markIndex(item, 3), markIndex(item, 4) + 1)
          .map((row) => row.candle.low),
      ),
    ).toBe(low(3));
  });

  it("keeps the range inside its levels until a close breaks it", () => {
    const item = lesson("soportes-y-resistencias");
    const rows = lessonChartRows(item);
    const breakAt = markIndex(item, 3);
    const resistance = level(item, "resistance");
    const support = level(item, "support");
    for (const row of rows.slice(0, breakAt)) {
      expect(row.candle.high).toBeLessThanOrEqual(resistance);
      expect(row.candle.low).toBeGreaterThanOrEqual(support);
    }
    expect(rows[breakAt]!.candle.close).toBeGreaterThan(resistance);
    expect(rows[breakAt]!.candle.volume).toBeGreaterThanOrEqual(
      2 * median(rows.slice(0, breakAt).map((row) => row.candle.volume)),
    );
    for (const row of rows.slice(breakAt + 1)) {
      expect(row.candle.low).toBeGreaterThan(resistance);
    }
  });

  it("holds above VWAP on quiet pullbacks and rises with volume", () => {
    const item = lesson("volumen-y-vwap");
    const rows = lessonChartRows(item);
    const volumes = rows.map((row) => row.candle.volume);
    expect(rows[markIndex(item, 1)]!.candle.volume).toBeGreaterThanOrEqual(
      2 * median(volumes),
    );
    for (const row of rows.slice(3)) {
      expect(row.candle.close).toBeGreaterThan(row.overlays.vwap!);
    }
    const touch = rows[markIndex(item, 2)]!;
    expect(touch.candle.low - touch.overlays.vwap!).toBeLessThanOrEqual(0.1);
    expect(rows[markIndex(item, 3)]!.candle.volume).toBeGreaterThan(
      1.5 * touch.candle.volume,
    );
  });

  it("marks the moving-average cross, the touch and the break where they happen", () => {
    const item = lesson("medias-moviles");
    const rows = lessonChartRows(item);
    const above = (row: LessonChartRow) =>
      row.overlays.sma20 != null &&
      row.overlays.sma50 != null &&
      row.overlays.sma20 > row.overlays.sma50;
    const cross = rows.findIndex(
      (row, index) => above(row) && index > 0 && !above(rows[index - 1]!),
    );
    expect(markIndex(item, 1)).toBe(cross);
    const touch = rows[markIndex(item, 2)]!;
    expect(touch.candle.low).toBeLessThanOrEqual(touch.overlays.sma20! * 1.005);
    expect(touch.candle.close).toBeGreaterThan(touch.overlays.sma20!);
    const peak = rows.reduce(
      (best, row) => (row.candle.high > best.candle.high ? row : best),
      rows[0]!,
    ).index;
    const breakdown = rows.findIndex(
      (row) => row.index > peak && row.candle.close < row.overlays.sma50!,
    );
    expect(markIndex(item, 3)).toBe(breakdown);
  });

  it("draws a bearish divergence and the MACD cross that follows it", () => {
    const item = lesson("rsi-y-macd");
    const rows = lessonChartRows(item);
    expect(rows[markIndex(item, 1)]!.rsi!).toBeGreaterThan(70);
    const first = rows[markIndex(item, 2)]!;
    const second = rows[markIndex(item, 3)]!;
    expect(second.candle.high).toBeGreaterThan(first.candle.high);
    expect(second.rsi!).toBeLessThan(first.rsi!);
    const below = (row: LessonChartRow) =>
      row.macd != null && row.signal != null && row.macd < row.signal;
    const cross = rows.findIndex(
      (row, index) =>
        index > second.index && below(row) && !below(rows[index - 1]!),
    );
    expect(markIndex(item, 4)).toBe(cross);
  });

  it("sizes the risk example with the planner and reaches 2R", () => {
    const item = lesson("gestion-de-riesgo");
    const sizing = item.sizing!;
    const plan = planPosition({
      liquidationValue: sizing.liquidationValue,
      buyingPower: sizing.liquidationValue,
      riskPerTradePercent: sizing.riskPerTradePercent,
      openRiskPercent: "6",
      openRisk: "0",
      entry: sizing.entry,
      stop: sizing.stop,
      target: sizing.target,
    });
    expect(plan.state).toBe("planned");
    if (plan.state !== "planned") return;
    expect(plan.shares).toBe("100");
    expect(plan.binding).toBe("risk_per_trade");
    expect(Number(sizing.entry)).toBe(level(item, "entry"));
    expect(Number(sizing.stop)).toBe(level(item, "stop"));
    expect(Number(sizing.target)).toBe(level(item, "target"));
  });

  it("breaks out of a tightening base on volume", () => {
    const item = lesson("breakout");
    const rows = lessonChartRows(item);
    const zone = item.chart.zones[0]!;
    const base = rows.slice(zone.from, zone.to + 1);
    for (const row of base) {
      expect(row.candle.high).toBeLessThanOrEqual(zone.high);
      expect(row.candle.low).toBeGreaterThanOrEqual(zone.low);
    }
    const breakout = rows[ruleMark(item, "entry")]!;
    expect(breakout.index).toBe(zone.to + 1);
    expect(breakout.candle.close).toBeGreaterThan(level(item, "resistance"));
    expect(breakout.candle.volume).toBeGreaterThanOrEqual(
      2 * median(base.map((row) => row.candle.volume)),
    );
    // Mínimos más altos dentro de la base: el rango se aprieta.
    const lows = [19, 29, markIndex(item, 1)].map((i) => rows[i]!.candle.low);
    expect(lows[1]).toBeGreaterThan(lows[0]!);
    expect(lows[2]).toBeGreaterThan(lows[1]!);
    expect(level(item, "target")).toBe(zone.high + (zone.high - zone.low));
  });

  it("pulls back to the EMA 20 on low volume inside an uptrend", () => {
    const item = lesson("pullback");
    const rows = lessonChartRows(item);
    const quiet = rows[markIndex(item, 1)]!;
    expect(quiet.candle.low).toBeLessThanOrEqual(quiet.overlays.ema20! * 1.01);
    expect(quiet.candle.close).toBeGreaterThan(quiet.overlays.ema20! * 0.99);
    const turn = rows[ruleMark(item, "entry")]!;
    expect(green(turn)).toBe(true);
    expect(turn.candle.close).toBeGreaterThan(quiet.candle.high);
    const trendVolume = median(
      rows.slice(15, 30).map((row) => row.candle.volume),
    );
    expect(quiet.candle.volume).toBeLessThan(trendVolume);
    expect(level(item, "stop")).toBeLessThan(quiet.candle.low);
  });

  it("breaks the opening range with a close and volume", () => {
    const item = lesson("opening-range-breakout");
    const rows = lessonChartRows(item);
    const zone = item.chart.zones[0]!;
    const opening = rows.slice(0, 3);
    expect(Math.max(...opening.map((row) => row.candle.high))).toBe(zone.high);
    expect(Math.min(...opening.map((row) => row.candle.low))).toBe(zone.low);
    const breakAt = ruleMark(item, "entry");
    for (const row of rows.slice(3, breakAt)) {
      expect(row.candle.high).toBeLessThanOrEqual(zone.high);
      expect(row.candle.low).toBeGreaterThanOrEqual(zone.low);
    }
    expect(rows[breakAt]!.candle.close).toBeGreaterThan(zone.high);
    expect(rows[breakAt]!.candle.volume).toBeGreaterThanOrEqual(
      2 * median(rows.slice(3, breakAt).map((row) => row.candle.volume)),
    );
    expect(level(item, "stop")).toBeCloseTo((zone.high + zone.low) / 2, 9);
  });

  it("reclaims VWAP after a base below it", () => {
    const item = lesson("vwap-reclaim");
    const rows = lessonChartRows(item);
    const reclaim = ruleMark(item, "entry");
    for (const row of rows.slice(3, reclaim)) {
      expect(row.candle.close).toBeLessThan(row.overlays.vwap!);
    }
    expect(rows[reclaim]!.candle.close).toBeGreaterThan(
      rows[reclaim]!.overlays.vwap!,
    );
    expect(level(item, "resistance")).toBe(
      Math.max(...rows.slice(0, reclaim).map((row) => row.candle.high)),
    );
    expect(level(item, "stop")).toBeLessThan(
      Math.min(...rows.slice(0, reclaim).map((row) => row.candle.low)),
    );
  });

  it("gaps more than 4 % and breaks the first candle's high", () => {
    const item = lesson("gap-and-go");
    const rows = lessonChartRows(item);
    const previousClose = level(item, "neutral");
    expect(rows[0]!.candle.open / previousClose - 1).toBeGreaterThan(0.04);
    expect(level(item, "entry")).toBeGreaterThan(rows[0]!.candle.high);
    expect(level(item, "stop")).toBeLessThan(rows[0]!.candle.low);
    for (const row of rows.slice(0, 12)) {
      expect(row.candle.close).toBeGreaterThan(row.overlays.vwap!);
    }
  });

  it("bounces on a third touch with a rejection candle", () => {
    const item = lesson("support-bounce");
    const rows = lessonChartRows(item);
    const support = level(item, "support");
    const touches = rows.filter((row) => row.candle.low <= support + 0.05);
    expect(touches.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.candle.low).toBeGreaterThanOrEqual(support);
    }
    const hammer = rows[markIndex(item, 2)]!;
    expect(lowerWick(hammer)).toBeGreaterThanOrEqual(2 * body(hammer));
    expect(level(item, "entry")).toBeGreaterThan(hammer.candle.high);
  });

  it("bounces on a rising SMA 50 without closing below it", () => {
    const item = lesson("moving-average-bounce");
    const rows = lessonChartRows(item);
    const touch = rows[markIndex(item, 1)]!;
    expect(touch.candle.low).toBeLessThanOrEqual(touch.overlays.sma50! * 1.005);
    const sma50 = (index: number) => rows[index]!.overlays.sma50!;
    expect(sma50(touch.index)).toBeGreaterThan(sma50(touch.index - 10));
    for (const row of rows.slice(50)) {
      expect(row.candle.close).toBeGreaterThan(row.overlays.sma50!);
    }
    expect(green(rows[ruleMark(item, "entry")]!)).toBe(true);
  });

  it("draws a bullish RSI divergence before the reversal breaks", () => {
    const item = lesson("reversal");
    const rows = lessonChartRows(item);
    const climax = rows[markIndex(item, 1)]!;
    const retest = rows[markIndex(item, 2)]!;
    expect(climax.candle.volume).toBeGreaterThanOrEqual(
      2 * median(rows.map((row) => row.candle.volume)),
    );
    expect(retest.candle.low).toBeLessThanOrEqual(climax.candle.low + 0.8);
    expect(retest.rsi!).toBeGreaterThan(climax.rsi!);
    const breakAt = ruleMark(item, "entry");
    const lowerHigh = Math.max(
      ...rows.slice(climax.index, breakAt).map((row) => row.candle.high),
    );
    expect(level(item, "entry")).toBeGreaterThan(lowerHigh);
    expect(level(item, "stop")).toBeLessThan(
      Math.min(...rows.map((row) => row.candle.low)),
    );
  });

  it("holds the earnings gap and breaks the consolidation above it", () => {
    const item = lesson("earnings");
    const rows = lessonChartRows(item);
    const gapAt = markIndex(item, 1);
    const gap = rows[gapAt]!;
    const before = rows[gapAt - 1]!;
    expect(gap.candle.open / before.candle.close - 1).toBeGreaterThan(0.05);
    expect(gap.candle.volume).toBeGreaterThanOrEqual(
      3 * median(rows.slice(0, gapAt).map((row) => row.candle.volume)),
    );
    const breakAt = ruleMark(item, "entry");
    const consolidation = rows.slice(gapAt + 1, breakAt);
    for (const row of consolidation) {
      expect(row.candle.low).toBeGreaterThan(before.candle.high);
      expect(row.candle.high).toBeLessThan(level(item, "entry"));
    }
    expect(level(item, "stop")).toBeLessThan(
      Math.min(...consolidation.map((row) => row.candle.low)),
    );
  });
});
