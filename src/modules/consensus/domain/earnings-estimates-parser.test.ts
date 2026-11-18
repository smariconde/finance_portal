import { describe, expect, it } from "vitest";

import {
  fixtureEstimateRow,
  fixtureEstimatesBody,
  fixtureTwoFiscalYearsBody,
} from "../infrastructure/fixture-earnings-estimates";
import {
  earningsEstimatesUrl,
  parseEarningsEstimates,
} from "./earnings-estimates-parser";

describe("parseEarningsEstimates", () => {
  it("keeps the fiscal years in order and counts the quarters it drops", () => {
    const result = parseEarningsEstimates(fixtureTwoFiscalYearsBody(), "FIXT");

    expect(result).toMatchObject({ ok: true, symbol: "FIXT" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.quartersDropped).toBe(2);
    expect(result.fiscalYears.map((year) => year.periodEnd)).toEqual([
      "2026-12-31",
      "2027-12-31",
    ]);
    expect(result.fiscalYears[0]).toEqual({
      periodEnd: "2026-12-31",
      epsAverage: "5",
      epsHigh: "5.5",
      epsLow: "4.5",
      epsAnalystCount: 12,
      epsAverage7DaysAgo: "5",
      epsAverage30DaysAgo: "4.9",
      epsAverage60DaysAgo: "4.8",
      epsAverage90DaysAgo: "4.7",
      epsRevisionsUp7Days: 0,
      epsRevisionsDown7Days: null,
      epsRevisionsUp30Days: 3,
      epsRevisionsDown30Days: null,
      revenueAverage: "1000000000",
      revenueHigh: "1100000000",
      revenueLow: "900000000",
      revenueAnalystCount: 10,
    });
  });

  it("reads every amount from its text, never through a double", () => {
    const result = parseEarningsEstimates(
      fixtureEstimatesBody("FIXT", [
        fixtureEstimateRow({
          date: "2026-12-31",
          eps_estimate_average: "0.1000",
          eps_estimate_low: "0.0300",
          eps_estimate_high: "0.2000",
          revenue_estimate_average: "123456789012345678.01",
          revenue_estimate_high: "123456789012345679.00",
        }),
      ]),
      "FIXT",
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.fiscalYears[0]!.epsAverage).toBe("0.1");
    expect(result.fiscalYears[0]!.revenueAverage).toBe("123456789012345678.01");
  });

  it("keeps a negative consensus, which is a loss, not an error", () => {
    const result = parseEarningsEstimates(
      fixtureEstimatesBody("FIXT", [
        fixtureEstimateRow({
          date: "2026-12-31",
          eps_estimate_average: "-1.2500",
          eps_estimate_low: "-2.0000",
          eps_estimate_high: "-0.5000",
        }),
      ]),
      "FIXT",
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.fiscalYears[0]!.epsAverage).toBe("-1.25");
  });

  it("names the API's own errors, which arrive with a 200", () => {
    expect(
      parseEarningsEstimates(
        JSON.stringify({ Information: "rate limit" }),
        "FIXT",
      ),
    ).toEqual({ ok: false, reason: "api_rate_limited" });
    expect(
      parseEarningsEstimates(JSON.stringify({ Note: "slow down" }), "FIXT"),
    ).toEqual({ ok: false, reason: "api_rate_limited" });
    expect(
      parseEarningsEstimates(
        JSON.stringify({ "Error Message": "Invalid API call" }),
        "FIXT",
      ),
    ).toEqual({ ok: false, reason: "api_error" });
  });

  it.each([
    ["not json", "invalid_json"],
    ["[]", "layout_changed"],
    ["{}", "layout_changed"],
    [JSON.stringify({ symbol: "FIXT", estimates: {} }), "layout_changed"],
    [
      JSON.stringify({ symbol: "FIXT", estimates: [], extra: 1 }),
      "layout_changed",
    ],
    [JSON.stringify({ symbol: "FIXT", estimates: [] }), "no_fiscal_years"],
  ] as const)("rejects %s as %s", (body, reason) => {
    expect(parseEarningsEstimates(body, "FIXT")).toEqual({ ok: false, reason });
  });

  it("refuses an answer about another symbol", () => {
    expect(
      parseEarningsEstimates(fixtureTwoFiscalYearsBody("OTHR"), "FIXT"),
    ).toEqual({ ok: false, reason: "symbol_mismatch" });
  });

  it("closes each row's key set and horizon", () => {
    const row = fixtureEstimateRow({ date: "2026-12-31" });
    const missing = Object.fromEntries(
      Object.entries(row).filter(([key]) => key !== "revenue_estimate_low"),
    );
    for (const rows of [
      [{ ...row, surprise: "1" }],
      [missing],
      [fixtureEstimateRow({ date: "2026-12-31", horizon: "fiscal half" })],
    ]) {
      expect(
        parseEarningsEstimates(fixtureEstimatesBody("FIXT", rows), "FIXT"),
      ).toEqual({ ok: false, reason: "layout_changed" });
    }
  });

  it("rejects an impossible date, a malformed number and an inverted range", () => {
    expect(
      parseEarningsEstimates(
        fixtureEstimatesBody("FIXT", [
          fixtureEstimateRow({ date: "2026-02-30" }),
        ]),
        "FIXT",
      ),
    ).toEqual({ ok: false, reason: "invalid_date" });
    for (const value of ["1,5", "1e3", " 5", "", "NaN"]) {
      expect(
        parseEarningsEstimates(
          fixtureEstimatesBody("FIXT", [
            fixtureEstimateRow({
              date: "2026-12-31",
              eps_estimate_average: value,
            }),
          ]),
          "FIXT",
        ),
      ).toEqual({ ok: false, reason: "invalid_value" });
    }
    expect(
      parseEarningsEstimates(
        fixtureEstimatesBody("FIXT", [
          fixtureEstimateRow({
            date: "2026-12-31",
            eps_estimate_average: null,
          }),
        ]),
        "FIXT",
      ),
    ).toEqual({ ok: false, reason: "invalid_value" });
    expect(
      parseEarningsEstimates(
        fixtureEstimatesBody("FIXT", [
          fixtureEstimateRow({
            date: "2026-12-31",
            eps_estimate_analyst_count: "12.5000",
          }),
        ]),
        "FIXT",
      ),
    ).toEqual({ ok: false, reason: "invalid_value" });
    expect(
      parseEarningsEstimates(
        fixtureEstimatesBody("FIXT", [
          fixtureEstimateRow({
            date: "2026-12-31",
            eps_estimate_low: "5.1000",
          }),
        ]),
        "FIXT",
      ),
    ).toEqual({ ok: false, reason: "range_inverted" });
  });

  it("rejects two rows for the same fiscal year instead of picking one", () => {
    expect(
      parseEarningsEstimates(
        fixtureEstimatesBody("FIXT", [
          fixtureEstimateRow({ date: "2026-12-31" }),
          fixtureEstimateRow({
            date: "2026-12-31",
            eps_estimate_average: "5.1000",
          }),
        ]),
        "FIXT",
      ),
    ).toEqual({ ok: false, reason: "duplicate_period" });
  });
});

describe("earningsEstimatesUrl", () => {
  it("names the one function and never the key", () => {
    expect(earningsEstimatesUrl("AAPL")).toBe(
      "https://www.alphavantage.co/query?function=EARNINGS_ESTIMATES&symbol=AAPL",
    );
    expect(earningsEstimatesUrl("BRK.B")).toContain("symbol=BRK.B");
  });

  it("refuses a symbol that could carry another parameter", () => {
    for (const symbol of ["aapl", "AAPL&apikey=x", "", "A B"]) {
      expect(() => earningsEstimatesUrl(symbol)).toThrow(
        "invalid_estimates_symbol",
      );
    }
  });
});
