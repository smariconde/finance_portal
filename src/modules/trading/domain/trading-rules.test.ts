import { describe, expect, it } from "vitest";

import { buildRoundTrips, type TradeFill } from "./trade-round-trips";
import {
  DEFAULT_RISK_SETTINGS,
  evaluateTradingRules,
  riskSettingsFormSchema,
  riskSettingsSchema,
  ruleUsage,
  sameRiskSettings,
  sessionActivity,
  type SessionActivity,
} from "./trading-rules";

let sequence = 0;

function fill(
  side: "buy" | "sell",
  netAmount: string,
  executedAt: string,
  instrumentKey = "schwab:1",
  extra: Partial<TradeFill> = {},
): TradeFill {
  sequence += 1;
  return {
    fillId: String(sequence),
    accountKey: "acct",
    instrumentKey,
    symbol: instrumentKey,
    assetType: "EQUITY",
    multiplier: "1",
    currency: "USD",
    side,
    quantity: "1",
    price: "10",
    netAmount,
    fees: "0",
    executedAt,
    positionEffect: side === "buy" ? "opening" : "closing",
    ...extra,
  };
}

// 15:00Z is 10:00 in New York (EST).
const TODAY = "2026-11-16";
const at = (hour: string, session = TODAY) => `${session}T${hour}:00:00Z`;
const NOW = at("19");

/** A closed round trip with a given P&L, in its own instrument. */
function closed(pnl: number, open: string, close: string, key: string) {
  return [
    fill("buy", "-100", open, key),
    fill("sell", String(100 + pnl), close, key),
  ];
}

describe("sessionActivity", () => {
  it("counts today's entries, realized exits and the ending loss streak", () => {
    const trades = buildRoundTrips([
      // Yesterday's swing, sold today with a loss.
      ...closed(-5, at("15", "2026-11-13"), at("15"), "schwab:1"),
      ...closed(-3, at("15"), at("16"), "schwab:2"),
      ...closed(4, at("16"), at("17"), "schwab:3"),
      ...closed(-2, at("17"), at("18"), "schwab:4"),
      ...closed(-1, at("18"), `${TODAY}T18:30:00Z`, "schwab:5"),
    ]);
    expect(sessionActivity(trades, NOW)).toEqual({
      session: TODAY,
      tradesOpened: 4,
      realized: "-7",
      unknownExits: 0,
      // −3 (cut by +4), then −2, −1.
      lossStreak: 2,
    });
  });

  it("breaks the streak with a breakeven trade", () => {
    const trades = buildRoundTrips([
      ...closed(-3, at("15"), at("16"), "schwab:2"),
      ...closed(0, at("16"), at("17"), "schwab:3"),
    ]);
    expect(sessionActivity(trades, NOW).lossStreak).toBe(0);
  });

  it("does not count exits without history in the realized total", () => {
    const trades = buildRoundTrips([fill("sell", "50", at("15"), "schwab:9")]);
    expect(sessionActivity(trades, NOW)).toMatchObject({
      tradesOpened: 0,
      realized: "0",
      unknownExits: 1,
      lossStreak: 0,
    });
  });
});

const QUIET: SessionActivity = {
  session: TODAY,
  tradesOpened: 0,
  realized: "0",
  unknownExits: 0,
  lossStreak: 0,
};

function evaluate(
  overrides: Partial<Parameters<typeof evaluateTradingRules>[0]> = {},
) {
  const readings = evaluateTradingRules({
    settings: DEFAULT_RISK_SETTINGS,
    liquidationValue: "20000",
    liquidationValueAtOpen: "20000",
    openRisk: "0",
    openDayPnl: "0",
    activity: QUIET,
    ...overrides,
  });
  return Object.fromEntries(readings.map((reading) => [reading.rule, reading]));
}

describe("evaluateTradingRules", () => {
  it("is all ok on a quiet day", () => {
    const readings = evaluate();
    expect(Object.values(readings).map((reading) => reading.state)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    expect(readings.open_risk).toMatchObject({ used: "0", limit: "1200" });
    expect(readings.daily_loss).toMatchObject({ used: "0", limit: "800" });
  });

  it("warns when another full stop no longer fits the open-risk budget", () => {
    // 1200 − 801 = 399 < 400
    expect(evaluate({ openRisk: "801" }).open_risk.state).toBe("warning");
    expect(evaluate({ openRisk: "800" }).open_risk.state).toBe("ok");
    expect(evaluate({ openRisk: "1200" }).open_risk.state).toBe("stop");
  });

  it("measures the daily loss with realized plus Schwab's open day P&L", () => {
    const day = evaluate({
      activity: { ...QUIET, realized: "-300" },
      openDayPnl: "-150",
    }).daily_loss;
    // 800 − 450 = 350 < 400
    expect(day).toMatchObject({ state: "warning", used: "450" });
    expect(
      evaluate({ activity: { ...QUIET, realized: "-900" } }).daily_loss.state,
    ).toBe("stop");
    // A green day uses nothing.
    expect(
      evaluate({ activity: { ...QUIET, realized: "500" } }).daily_loss,
    ).toMatchObject({ state: "ok", used: "0" });
  });

  it("uses the liquidation value at the open for the daily limit", () => {
    expect(evaluate({ liquidationValueAtOpen: "10000" }).daily_loss.limit).toBe(
      "400",
    );
  });

  it("is unknown, never ok, without the data it needs", () => {
    expect(evaluate({ openRisk: null }).open_risk).toMatchObject({
      state: "unknown",
      reason: "open_risk_incomplete",
      limit: "1200",
    });
    expect(evaluate({ openDayPnl: null }).daily_loss).toMatchObject({
      state: "unknown",
      reason: "open_day_pnl_unknown",
    });
    expect(evaluate({ liquidationValue: "0" }).open_risk.reason).toBe(
      "no_equity",
    );
    expect(evaluate({ liquidationValueAtOpen: "0" }).daily_loss.reason).toBe(
      "no_equity",
    );
  });

  it("counts trades and losses against their limits", () => {
    const at2 = evaluate({
      activity: { ...QUIET, tradesOpened: 2, lossStreak: 2 },
    });
    expect(at2.trades.state).toBe("warning");
    expect(at2.loss_streak.state).toBe("warning");
    const at3 = evaluate({
      activity: { ...QUIET, tradesOpened: 3, lossStreak: 3 },
    });
    expect(at3.trades).toMatchObject({ state: "stop", used: "3", limit: "3" });
    expect(at3.loss_streak.state).toBe("stop");
    expect(
      evaluate({ activity: { ...QUIET, tradesOpened: 5 } }).trades.state,
    ).toBe("stop");
  });

  it("turns a rule off with null", () => {
    const readings = evaluate({
      settings: {
        ...DEFAULT_RISK_SETTINGS,
        dailyLossPercent: null,
        maxTradesPerSession: null,
        maxConsecutiveLosses: null,
      },
      activity: { ...QUIET, tradesOpened: 9, lossStreak: 9 },
    });
    expect(readings.daily_loss.state).toBe("off");
    expect(readings.trades.state).toBe("off");
    expect(readings.loss_streak.state).toBe("off");
  });
});

describe("ruleUsage", () => {
  it("is used over limit, null without both", () => {
    expect(ruleUsage(evaluate({ openRisk: "600" }).open_risk)).toBe(0.5);
    expect(ruleUsage(evaluate({ openRisk: null }).open_risk)).toBeNull();
  });
});

describe("risk settings", () => {
  const form = {
    riskPerTradePercent: "2",
    openRiskPercent: "6",
    dailyLossPercent: "4",
    maxTradesPerSession: "3",
    maxConsecutiveLosses: "3",
  };

  it("declares defaults that pass their own schema", () => {
    expect(riskSettingsSchema.safeParse(DEFAULT_RISK_SETTINGS).success).toBe(
      true,
    );
    expect(riskSettingsFormSchema.parse(form)).toEqual(DEFAULT_RISK_SETTINGS);
  });

  it("reads commas, a trailing percent and empty fields as off", () => {
    expect(
      riskSettingsFormSchema.parse({
        ...form,
        riskPerTradePercent: "1,5 %",
        dailyLossPercent: "",
        maxTradesPerSession: " ",
        maxConsecutiveLosses: "",
      }),
    ).toEqual({
      ...DEFAULT_RISK_SETTINGS,
      riskPerTradePercent: "1.5",
      dailyLossPercent: null,
      maxTradesPerSession: null,
      maxConsecutiveLosses: null,
    });
  });

  it("rejects zero, over 100, three decimals, a missing budget and a trade above the portfolio", () => {
    for (const patch of [
      { riskPerTradePercent: "0" },
      { openRiskPercent: "101" },
      { dailyLossPercent: "1.234" },
      { openRiskPercent: "" },
      { riskPerTradePercent: "7" },
      { maxTradesPerSession: "0" },
      { maxConsecutiveLosses: "21" },
      { maxTradesPerSession: "2.5" },
    ]) {
      expect(
        riskSettingsFormSchema.safeParse({ ...form, ...patch }).success,
        JSON.stringify(patch),
      ).toBe(false);
    }
  });

  it("compares settings field by field", () => {
    expect(
      sameRiskSettings(DEFAULT_RISK_SETTINGS, { ...DEFAULT_RISK_SETTINGS }),
    ).toBe(true);
    expect(
      sameRiskSettings(DEFAULT_RISK_SETTINGS, {
        ...DEFAULT_RISK_SETTINGS,
        maxTradesPerSession: null,
      }),
    ).toBe(false);
  });
});
