import { describe, expect, it } from "vitest";

import { accountRisk, bookCapitalLeft } from "./account-risk";
import type { SchwabPosition } from "./schwab-account";
import { DEFAULT_RISK_SETTINGS, type SessionActivity } from "./trading-rules";

function position(
  symbol: string,
  marketValue: string,
  dayProfitLoss: string | null,
  previousSessionQuantity: string | null = null,
): SchwabPosition {
  return {
    symbol,
    assetType: "EQUITY",
    description: null,
    side: "long",
    quantity: "10",
    averagePrice: "100",
    marketValue,
    dayProfitLoss,
    dayProfitLossPercent: null,
    openProfitLoss: null,
    previousSessionQuantity,
    optionMultiplier: null,
  };
}

const ACTIVITY: SessionActivity = {
  session: "2026-11-25",
  tradesOpened: 1,
  realized: "0",
  lossStreak: 0,
  dayBuys: "1000",
};

const plan = (symbol: string, book: "day" | "swing", stop: string | null) => ({
  symbol,
  book,
  stop,
  target: null,
  tradeRef: `${symbol}-1`,
});

function read(positions: readonly SchwabPosition[]) {
  return accountRisk({
    positions,
    orders: [],
    priceOf: () => null,
    plans: [plan("SWG", "swing", "90"), plan("DAY", "day", null)],
    settings: DEFAULT_RISK_SETTINGS,
    liquidationValue: "20000",
    liquidationValueAtOpen: "20000",
    activity: ACTIVITY,
  });
}

describe("accountRisk", () => {
  it("measures each position in its own book", () => {
    const result = read([
      position("SWG", "1000", "-500"),
      position("DAY", "1000", "-20"),
    ]);
    expect(result.risks.map((risk) => [risk.symbol, risk.book])).toEqual([
      ["SWG", "swing"],
      ["DAY", "day"],
    ]);
    const rules = Object.fromEntries(
      result.rules.map((reading) => [reading.rule, reading]),
    );
    // The day position without a stop does not leave the 6 % unmeasured.
    expect(result.openRisk).toMatchObject({ value: "100", missing: [] });
    expect(rules.open_risk).toMatchObject({ state: "ok", used: "100" });
    expect(rules.swing_exposure).toMatchObject({ used: "1000" });
    // The swing's −500 gap stays out of the day's loss.
    expect(rules.daily_loss).toMatchObject({ used: "20" });
    expect(rules.day_capital).toMatchObject({ used: "1000", limit: "6000" });
    expect(bookCapitalLeft(result.rules, "day")).toBe("5000");
    expect(bookCapitalLeft(result.rules, "swing")).toBe("13000");
  });

  it("books a position the journal does not know by Schwab's previous quantity", () => {
    const result = read([position("NEW", "500", "5", "10")]);
    expect(result.risks[0]).toMatchObject({ symbol: "NEW", book: "swing" });
    expect(result.openRisk).toMatchObject({ value: null, missing: ["NEW"] });
  });
});
