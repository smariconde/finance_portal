import { describe, expect, it } from "vitest";

import {
  computeThreeYearPayout,
  FINANCIAL_PAYOUT_VERSION,
  payoutOfBasis,
  type PayoutYear,
} from "./financial-payout";

const year = (
  fiscalYearEnd: string,
  commonIncome: string,
  commonDividends: string,
  netRepurchases: string,
): PayoutYear => ({
  fiscalYearEnd,
  commonIncome,
  commonDividends,
  netRepurchases,
});

// SCHW 2023–2025 en millones: 2025 devuelve el 110 %, el trienio el 85 %.
const SCHW = [
  year("2025-12-31", "8417", "1958", "7346"),
  year("2024-12-31", "5478", "1838", "0"),
  year("2023-12-31", "4649", "1838", "2842"),
];

describe(FINANCIAL_PAYOUT_VERSION, () => {
  it("divides three years of distributions by three years of common income", () => {
    const result = computeThreeYearPayout(SCHW);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.payout.toDecimalPlaces(4).toString()).toBe("0.8532");
    expect(result.basis.payoutCapped).toBe(false);
    expect(result.basis.ratio).toBe(result.payout.toString());
    expect(payoutOfBasis(result.basis)?.eq(result.payout)).toBe(true);
  });

  it("caps a payout above one and keeps the ratio it came from", () => {
    const result = computeThreeYearPayout([
      year("2025-12-31", "100", "60", "60"),
      year("2024-12-31", "100", "50", "40"),
      year("2023-12-31", "100", "50", "50"),
    ]);
    expect(result).toMatchObject({
      status: "ready",
      basis: { payoutCapped: true },
    });
    if (result.status !== "ready") return;
    expect(result.basis.ratio.startsWith("1.03333")).toBe(true);
    expect(result.payout.toString()).toBe("1");
  });

  it("lets a loss year count inside a positive three-year total", () => {
    // HOOD: −541 M en 2023 dentro de un trienio de 2.753 M.
    const result = computeThreeYearPayout([
      year("2025-12-31", "1883", "0", "653"),
      year("2024-12-31", "1411", "0", "257"),
      year("2023-12-31", "-541", "0", "608"),
    ]);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // 1.518 / 2.753
    expect(result.payout.toDecimalPlaces(4).toString()).toBe("0.5514");
  });

  it("has no payout without three years, a positive income total or non-negative distributions", () => {
    expect(computeThreeYearPayout(SCHW.slice(0, 2))).toEqual({
      status: "unavailable",
      reason: "payout_history_missing",
    });
    expect(
      computeThreeYearPayout([
        year("2025-12-31", "-10", "0", "0"),
        year("2024-12-31", "5", "0", "0"),
        year("2023-12-31", "5", "0", "0"),
      ]),
    ).toEqual({ status: "unavailable", reason: "non_positive_income" });
    expect(
      computeThreeYearPayout([
        year("2025-12-31", "10", "-1", "0"),
        ...SCHW.slice(1),
      ]),
    ).toEqual({ status: "unavailable", reason: "negative_distribution" });
  });

  it("refuses a frozen basis whose ratio or cap was written by hand", () => {
    const result = computeThreeYearPayout(SCHW);
    if (result.status !== "ready") throw new Error("expected ready");
    expect(payoutOfBasis({ ...result.basis, ratio: "0.5" })).toBeNull();
    expect(payoutOfBasis({ ...result.basis, payoutCapped: true })).toBeNull();
  });
});
