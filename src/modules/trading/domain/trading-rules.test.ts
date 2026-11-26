import { describe, expect, it } from "vitest";

import { buildRoundTrips, type TradeFill } from "./trade-round-trips";
import {
  allocationOf,
  capitalLeft,
  DEFAULT_RISK_SETTINGS,
  evaluateTradingRules,
  riskPerTradeOf,
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
  it("counts only today's day trades: entries, realized exits, buys and the streak", () => {
    const trades = buildRoundTrips([
      // Yesterday's swing, sold today with a loss: not a day trade.
      ...closed(-5, at("15", "2026-11-13"), at("15"), "schwab:1"),
      ...closed(-3, at("15"), at("16"), "schwab:2"),
      ...closed(4, at("16"), at("17"), "schwab:3"),
      ...closed(-2, at("17"), at("18"), "schwab:4"),
      ...closed(-1, at("18"), `${TODAY}T18:30:00Z`, "schwab:5"),
      // Bought today and still open: a day trade until it spends the night.
      fill("buy", "-250.5", `${TODAY}T18:45:00Z`, "schwab:6"),
    ]);
    expect(sessionActivity(trades, NOW)).toEqual({
      session: TODAY,
      tradesOpened: 5,
      realized: "-2",
      // −3 (cut by +4), then −2, −1.
      lossStreak: 2,
      // Four closed entries at 100 plus the open one.
      dayBuys: "650.5",
    });
  });

  it("breaks the streak with a breakeven trade", () => {
    const trades = buildRoundTrips([
      ...closed(-3, at("15"), at("16"), "schwab:2"),
      ...closed(0, at("16"), at("17"), "schwab:3"),
    ]);
    expect(sessionActivity(trades, NOW).lossStreak).toBe(0);
  });

  it("leaves swings and exits without history out", () => {
    const trades = buildRoundTrips([
      fill("sell", "50", at("15"), "schwab:9"),
      fill("buy", "-100", at("15", "2026-11-13"), "schwab:8"),
    ]);
    expect(sessionActivity(trades, NOW)).toEqual({
      session: TODAY,
      tradesOpened: 0,
      realized: "0",
      lossStreak: 0,
      dayBuys: "0",
    });
  });
});

const QUIET: SessionActivity = {
  session: TODAY,
  tradesOpened: 0,
  realized: "0",
  lossStreak: 0,
  dayBuys: "0",
};

type EvaluateInput = Parameters<typeof evaluateTradingRules>[0];

function evaluate(
  overrides: Partial<EvaluateInput> & {
    readonly openRisk?: string | null;
    readonly exposure?: string;
    readonly openDayPnl?: string | null;
  } = {},
) {
  const {
    openRisk = "0",
    exposure = "0",
    openDayPnl = "0",
    ...rest
  } = overrides;
  const readings = evaluateTradingRules({
    settings: DEFAULT_RISK_SETTINGS,
    liquidationValue: "20000",
    liquidationValueAtOpen: "20000",
    day: { openDayPnl },
    swing: { openRisk, exposure },
    activity: QUIET,
    ...rest,
  });
  return Object.fromEntries(readings.map((reading) => [reading.rule, reading]));
}

describe("evaluateTradingRules", () => {
  it("is all ok on a quiet day, day rules first", () => {
    const readings = evaluate();
    expect(Object.keys(readings)).toEqual([
      "day_capital",
      "daily_loss",
      "trades",
      "loss_streak",
      "swing_exposure",
      "open_risk",
    ]);
    expect(Object.values(readings).map((reading) => reading.state)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    // 30 % and 70 % of 20.000; 1,5 % daily; 6 % open.
    expect(readings.day_capital).toMatchObject({ used: "0", limit: "6000" });
    expect(readings.daily_loss).toMatchObject({ used: "0", limit: "300" });
    expect(readings.swing_exposure).toMatchObject({
      used: "0",
      limit: "14000",
    });
    expect(readings.open_risk).toMatchObject({ used: "0", limit: "1200" });
  });

  it("measures the day capital by what was bought today, at the open", () => {
    expect(
      evaluate({ activity: { ...QUIET, dayBuys: "5999.99" } }).day_capital
        .state,
    ).toBe("ok");
    expect(
      evaluate({ activity: { ...QUIET, dayBuys: "6000" } }).day_capital.state,
    ).toBe("stop");
    expect(
      evaluate({ liquidationValueAtOpen: "10000" }).day_capital.limit,
    ).toBe("3000");
  });

  it("stops day trading when the whole account is swing", () => {
    expect(
      evaluate({
        settings: { ...DEFAULT_RISK_SETTINGS, swingAllocationPercent: "100" },
      }).day_capital,
    ).toMatchObject({ state: "stop", used: "0", limit: "0" });
  });

  it("caps the swing exposure without a warning step", () => {
    expect(evaluate({ exposure: "13999" }).swing_exposure.state).toBe("ok");
    expect(evaluate({ exposure: "14000" }).swing_exposure.state).toBe("stop");
  });

  it("warns when another full swing stop no longer fits the open-risk budget", () => {
    // 1200 − 801 = 399 < 400
    expect(evaluate({ openRisk: "801" }).open_risk.state).toBe("warning");
    expect(evaluate({ openRisk: "800" }).open_risk.state).toBe("ok");
    expect(evaluate({ openRisk: "1200" }).open_risk.state).toBe("stop");
  });

  it("measures the daily loss with day realized plus the day positions' P&L", () => {
    const day = evaluate({
      activity: { ...QUIET, realized: "-150" },
      openDayPnl: "-60",
    }).daily_loss;
    // 300 − 210 = 90 < 100 (one 0,5 % stop)
    expect(day).toMatchObject({ state: "warning", used: "210" });
    expect(
      evaluate({ activity: { ...QUIET, realized: "-300" } }).daily_loss.state,
    ).toBe("stop");
    // A green day uses nothing.
    expect(
      evaluate({ activity: { ...QUIET, realized: "500" } }).daily_loss,
    ).toMatchObject({ state: "ok", used: "0" });
  });

  it("uses the liquidation value at the open for the daily limit", () => {
    expect(evaluate({ liquidationValueAtOpen: "10000" }).daily_loss.limit).toBe(
      "150",
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
    const broke = evaluate({ liquidationValue: "0" });
    expect(broke.open_risk.reason).toBe("no_equity");
    expect(broke.swing_exposure.reason).toBe("no_equity");
    const brokeAtOpen = evaluate({ liquidationValueAtOpen: "0" });
    expect(brokeAtOpen.daily_loss.reason).toBe("no_equity");
    expect(brokeAtOpen.day_capital.reason).toBe("no_equity");
  });

  it("counts day trades and losses against their limits", () => {
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

describe("ruleUsage and capitalLeft", () => {
  it("is used over limit, null without both", () => {
    expect(ruleUsage(evaluate({ openRisk: "600" }).open_risk)).toBe(0.5);
    expect(ruleUsage(evaluate({ openRisk: null }).open_risk)).toBeNull();
  });

  it("leaves what is left of a cap, never below zero", () => {
    expect(capitalLeft(evaluate({ exposure: "4000" }).swing_exposure)).toBe(
      "10000",
    );
    expect(capitalLeft(evaluate({ exposure: "20000" }).swing_exposure)).toBe(
      "0",
    );
    expect(
      capitalLeft(evaluate({ liquidationValueAtOpen: "0" }).day_capital),
    ).toBeNull();
    expect(capitalLeft(undefined)).toBeNull();
  });
});

describe("books in the settings", () => {
  it("splits the account and picks each book's risk", () => {
    expect(allocationOf(DEFAULT_RISK_SETTINGS, "swing")).toBe("70");
    expect(allocationOf(DEFAULT_RISK_SETTINGS, "day")).toBe("30");
    expect(riskPerTradeOf(DEFAULT_RISK_SETTINGS, "day")).toBe("0.5");
    expect(riskPerTradeOf(DEFAULT_RISK_SETTINGS, "swing")).toBe("2");
  });
});

describe("risk settings", () => {
  const form = {
    swingAllocationPercent: "70",
    riskPerTradePercent: "2",
    openRiskPercent: "6",
    dayRiskPerTradePercent: "0,5",
    dailyLossPercent: "1,5",
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

  it("accepts a split of 0 and 100", () => {
    for (const swingAllocationPercent of ["0", "100"]) {
      expect(
        riskSettingsFormSchema.parse({ ...form, swingAllocationPercent })
          .swingAllocationPercent,
      ).toBe(swingAllocationPercent);
    }
  });

  it("rejects zero risk, over 100, three decimals, missing budgets and a trade above its limit", () => {
    for (const patch of [
      { riskPerTradePercent: "0" },
      { dayRiskPerTradePercent: "0" },
      { openRiskPercent: "101" },
      { swingAllocationPercent: "101" },
      { swingAllocationPercent: "" },
      { dailyLossPercent: "1.234" },
      { openRiskPercent: "" },
      { dayRiskPerTradePercent: "" },
      { riskPerTradePercent: "7" },
      { dayRiskPerTradePercent: "2" },
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

  it("lets the day risk exceed nothing when the daily loss is off", () => {
    expect(
      riskSettingsFormSchema.safeParse({
        ...form,
        dayRiskPerTradePercent: "2",
        dailyLossPercent: "",
      }).success,
    ).toBe(true);
  });

  it("compares settings field by field", () => {
    expect(
      sameRiskSettings(DEFAULT_RISK_SETTINGS, { ...DEFAULT_RISK_SETTINGS }),
    ).toBe(true);
    for (const patch of [
      { maxTradesPerSession: null },
      { swingAllocationPercent: "60" },
      { dayRiskPerTradePercent: "1" },
    ]) {
      expect(
        sameRiskSettings(DEFAULT_RISK_SETTINGS, {
          ...DEFAULT_RISK_SETTINGS,
          ...patch,
        }),
      ).toBe(false);
    }
  });
});
