import { describe, expect, it } from "vitest";

import {
  markOf,
  openRisk,
  planByAmount,
  planPosition,
  positionRisk,
  type RiskOrderInput,
  type RiskPositionInput,
} from "./position-size-risk";

const LONG: RiskPositionInput = {
  symbol: "SYN",
  assetType: "EQUITY",
  side: "long",
  quantity: "100",
  averagePrice: "50",
  marketValue: "5500",
};

function stopOrder(
  stopPrice: string,
  quantity = "100",
  extra: Partial<RiskOrderInput> = {},
): RiskOrderInput {
  return {
    orderType: "STOP",
    legs: [{ symbol: "SYN", instruction: "SELL", quantity }],
    price: null,
    stopPrice,
    ...extra,
  };
}

const plan = (stop: string | null, target: string | null = null) => ({
  stop,
  target,
  tradeRef: "1-2",
});

describe("markOf", () => {
  it("is Schwab's market value over the quantity", () => {
    expect(markOf(LONG)).toBe("55");
  });
});

describe("positionRisk", () => {
  it("measures the open risk from the price, not from the entry", () => {
    const risk = positionRisk({
      position: LONG,
      price: "55",
      plan: plan("48", "65"),
      orders: [],
    });
    expect(risk).toMatchObject({
      stop: "48",
      stopSource: "plan",
      target: "65",
      targetSource: "plan",
      lockedIn: false,
      // (55 − 50) / (50 − 48)
      priceInR: "2.5",
      risk: { value: "700", reason: null },
    });
  });

  it("keeps a trailing stop above the entry at risk between price and stop", () => {
    const risk = positionRisk({
      position: LONG,
      price: "55",
      plan: plan("52"),
      orders: [],
    });
    expect(risk.lockedIn).toBe(true);
    expect(risk.priceInR).toBeNull();
    expect(risk.risk).toEqual({ value: "300", reason: null });
  });

  it("never reads a price through the stop as zero risk", () => {
    const risk = positionRisk({
      position: LONG,
      price: "47",
      plan: plan("48"),
      orders: [],
    });
    expect(risk.risk).toEqual({ value: null, reason: "price_through_stop" });
  });

  it("uses a live stop order without a plan, only when it covers the position", () => {
    expect(
      positionRisk({
        position: LONG,
        price: "55",
        plan: null,
        orders: [stopOrder("49")],
      }),
    ).toMatchObject({
      stop: "49",
      stopSource: "order",
      risk: { value: "600", reason: null },
    });
    expect(
      positionRisk({
        position: LONG,
        price: "55",
        plan: null,
        orders: [stopOrder("49", "60")],
      }).risk,
    ).toEqual({ value: null, reason: "stop_order_partial" });
  });

  it("takes the lowest of several stop orders and adds their quantities", () => {
    const risk = positionRisk({
      position: LONG,
      price: "55",
      plan: null,
      orders: [stopOrder("49", "50"), stopOrder("47", "50")],
    });
    expect(risk.stop).toBe("47");
    expect(risk.risk).toEqual({ value: "800", reason: null });
  });

  it("prefers the plan and flags an order that disagrees", () => {
    const risk = positionRisk({
      position: LONG,
      price: "55",
      plan: plan("48"),
      orders: [stopOrder("49")],
    });
    expect(risk).toMatchObject({
      stop: "48",
      stopSource: "plan",
      orderStop: "49",
      stopMismatch: true,
    });
    expect(
      positionRisk({
        position: LONG,
        price: "55",
        plan: plan("49"),
        orders: [stopOrder("49.00")],
      }).stopMismatch,
    ).toBe(false);
  });

  it("reads a resting limit sell above the price as the target", () => {
    const orders: RiskOrderInput[] = [
      { ...stopOrder("49"), orderType: "LIMIT", price: "60", stopPrice: null },
      { ...stopOrder("49"), orderType: "LIMIT", price: "54", stopPrice: null },
    ];
    expect(
      positionRisk({ position: LONG, price: "55", plan: null, orders }),
    ).toMatchObject({ target: "60", targetSource: "order" });
  });

  it("ignores orders on other symbols or buying", () => {
    const risk = positionRisk({
      position: LONG,
      price: "55",
      plan: null,
      orders: [
        stopOrder("49", "100", {
          legs: [{ symbol: "OTHER", instruction: "SELL", quantity: "100" }],
        }),
        stopOrder("49", "100", {
          legs: [{ symbol: "SYN", instruction: "BUY", quantity: "100" }],
        }),
      ],
    });
    expect(risk.risk).toEqual({ value: null, reason: "no_stop" });
  });

  it("does not call a position stopless when its orders were not read", () => {
    const unread = positionRisk({
      position: LONG,
      price: "55",
      plan: null,
      orders: null,
    });
    expect(unread.risk).toEqual({ value: null, reason: "orders_unread" });
    expect(unread.orderStop).toBeNull();

    const planned = positionRisk({
      position: LONG,
      price: "55",
      plan: plan("48", "65"),
      orders: null,
    });
    expect(planned).toMatchObject({
      stop: "48",
      stopSource: "plan",
      stopMismatch: false,
    });
    expect(planned.risk.value).not.toBeNull();
  });

  it("names what it does not measure", () => {
    expect(
      positionRisk({
        position: { ...LONG, assetType: "OPTION" },
        price: "1",
        plan: plan("0.5"),
        orders: [],
      }).risk.reason,
    ).toBe("asset_not_measured");
    expect(
      positionRisk({
        position: { ...LONG, side: "short" },
        price: "55",
        plan: plan("60"),
        orders: [],
      }).risk.reason,
    ).toBe("short_not_measured");
  });
});

describe("openRisk", () => {
  const measured = positionRisk({
    position: LONG,
    price: "55",
    plan: plan("48"),
    orders: [],
  });
  const missing = positionRisk({
    position: { ...LONG, symbol: "NOSTOP" },
    price: "55",
    plan: null,
    orders: [],
  });

  it("adds the measured risks against the declared share of equity", () => {
    expect(openRisk([measured], "20000", "6")).toEqual({
      value: "700",
      known: "700",
      missing: [],
      limit: "1200",
      percent: "3.5",
    });
  });

  it("is null when any position has no measured risk, naming it", () => {
    expect(openRisk([measured, missing], "20000", "6")).toMatchObject({
      value: null,
      known: "700",
      missing: ["NOSTOP"],
      percent: null,
    });
  });

  it("is zero, not null, without positions", () => {
    expect(openRisk([], "20000", "6").value).toBe("0");
  });

  it("has no limit without equity", () => {
    expect(openRisk([measured], "0", "6")).toMatchObject({
      limit: null,
      percent: null,
    });
  });
});

describe("planPosition", () => {
  const base = {
    liquidationValue: "20000",
    buyingPower: "20000",
    riskPerTradePercent: "2",
    openRiskPercent: "6",
    openRisk: "0",
    entry: "50",
    stop: "48",
    target: "56",
  };

  it("sizes by 2 % of liquidation value over the stop distance", () => {
    expect(planPosition(base)).toEqual({
      state: "planned",
      // 400 / 2
      shares: "200",
      binding: "risk_per_trade",
      caps: { riskPerTrade: "200", buyingPower: "400", openRisk: "600" },
      riskPerShare: "2",
      riskBudget: "400",
      riskAmount: "400",
      riskPercent: "2",
      positionValue: "10000",
      positionPercent: "50",
      rewardRisk: { value: "3", reason: null },
      openRiskAfterPercent: "2",
    });
  });

  it("rounds shares down, never up", () => {
    const plan = planPosition({ ...base, stop: "47" });
    // 400 / 3 = 133.33
    expect(plan).toMatchObject({ shares: "133", riskAmount: "399" });
  });

  it("is capped by buying power", () => {
    expect(planPosition({ ...base, buyingPower: "5025" })).toMatchObject({
      shares: "100",
      binding: "buying_power",
    });
  });

  it("is capped by what is left of the open-risk budget", () => {
    // 1200 − 1000 = 200 → 100 shares
    expect(planPosition({ ...base, openRisk: "1000" })).toMatchObject({
      shares: "100",
      binding: "open_risk",
      openRiskAfterPercent: "6",
    });
    expect(planPosition({ ...base, openRisk: "1300" })).toMatchObject({
      shares: "0",
      binding: "open_risk",
      riskAmount: "0",
    });
  });

  it("leaves the open-risk cap out when the open risk is unknown", () => {
    expect(planPosition({ ...base, openRisk: null })).toMatchObject({
      shares: "200",
      binding: "risk_per_trade",
      caps: { openRisk: null },
      openRiskAfterPercent: null,
    });
  });

  it("names a target on the wrong side or missing", () => {
    expect(planPosition({ ...base, target: "49" })).toMatchObject({
      rewardRisk: { value: null, reason: "target_on_wrong_side" },
    });
    expect(planPosition({ ...base, target: null })).toMatchObject({
      rewardRisk: { value: null, reason: "no_target" },
    });
  });

  it("refuses a stop at or above the entry and an account without equity", () => {
    expect(planPosition({ ...base, stop: "50" })).toEqual({
      state: "invalid",
      reason: "zero_risk",
    });
    expect(planPosition({ ...base, stop: "51" })).toEqual({
      state: "invalid",
      reason: "stop_on_wrong_side",
    });
    expect(planPosition({ ...base, liquidationValue: "0" })).toEqual({
      state: "invalid",
      reason: "no_equity",
    });
    expect(planPosition({ ...base, liquidationValue: "-10" })).toEqual({
      state: "invalid",
      reason: "no_equity",
    });
  });

  it("gives zero shares when the budget is below one share", () => {
    expect(
      planPosition({ ...base, liquidationValue: "50", buyingPower: "50" }),
    ).toMatchObject({ shares: "0", riskAmount: "0" });
  });
});

describe("planByAmount", () => {
  const base = {
    liquidationValue: "10000",
    buyingPower: "4000",
    riskPerTradePercent: "2",
    amount: "1000",
    entry: "62.15",
    stop: null,
    target: null,
  } as const;

  it("turns an amount into whole shares, rounding down", () => {
    const plan = planByAmount(base);
    expect(plan).toMatchObject({
      state: "planned",
      shares: "16",
      positionValue: "994.4",
      positionPercent: "9.944",
      leftover: "5.6",
      overBuyingPower: false,
      risk: null,
      rewardRisk: { value: null, reason: "no_stop" },
    });
  });

  it("measures the risk of that quantity against the per-trade budget", () => {
    const plan = planByAmount({ ...base, amount: "3000", stop: "54.67" });
    // 48 acciones × 7,48 = 359,04 contra 200 de presupuesto: 26 permitidas.
    expect(plan).toMatchObject({
      shares: "48",
      risk: {
        amount: "359.04",
        percent: "3.5904",
        budget: "200",
        maxShares: "26",
        overBudget: true,
      },
    });
  });

  it("keeps a risk inside the budget unflagged and reads reward/risk", () => {
    const plan = planByAmount({ ...base, stop: "54.67", target: "80" });
    expect(plan).toMatchObject({
      shares: "16",
      risk: { amount: "119.68", overBudget: false },
      rewardRisk: { reason: null },
    });
    if (plan.state === "planned" && plan.rewardRisk.value !== null)
      expect(Number(plan.rewardRisk.value)).toBeCloseTo(17.85 / 7.48, 10);
  });

  it("flags an amount above buying power without trimming it", () => {
    expect(planByAmount({ ...base, amount: "5000" })).toMatchObject({
      shares: "80",
      overBuyingPower: true,
    });
  });

  it("gives zero shares when the amount is below one share", () => {
    expect(planByAmount({ ...base, amount: "50" })).toMatchObject({
      shares: "0",
      leftover: "50",
    });
  });

  it("refuses a stop at or above the entry and an account without equity", () => {
    expect(planByAmount({ ...base, stop: "62.15" })).toEqual({
      state: "invalid",
      reason: "zero_risk",
    });
    expect(planByAmount({ ...base, stop: "70" })).toEqual({
      state: "invalid",
      reason: "stop_on_wrong_side",
    });
    expect(planByAmount({ ...base, liquidationValue: "0" })).toEqual({
      state: "invalid",
      reason: "no_equity",
    });
  });

  it("names a target on the wrong side", () => {
    expect(
      planByAmount({ ...base, stop: "54.67", target: "60" }),
    ).toMatchObject({ rewardRisk: { reason: "target_on_wrong_side" } });
  });
});
