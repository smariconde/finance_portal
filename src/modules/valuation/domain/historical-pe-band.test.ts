import { describe, expect, it } from "vitest";

import {
  ANNUAL_FUNDAMENTALS_VERSION,
  type AnnualFundamentals,
  type LineItemValue,
} from "./annual-fundamentals";
import {
  historicalPeBand,
  HISTORICAL_PE_BAND_VERSION,
} from "./historical-pe-band";

const SECURITY = "11111111-1111-4111-8111-111111111111";

function fact(
  item: "net_income" | "shares_outstanding",
  asOf: string,
  value: string,
  currency: string | null = item === "net_income" ? "USD" : null,
): LineItemValue {
  return {
    item,
    concept: `us-gaap:${item}`,
    value,
    unit: item === "net_income" ? "monetary" : "shares",
    currency,
    asOf,
    observationId: "22222222-2222-4222-8222-222222222222",
    availableAt: "2026-02-01T12:00:00Z",
    recordedAt: "2026-02-01T12:00:00Z",
    sourceDocumentId: "filing",
  };
}

function series(years: readonly string[]): AnnualFundamentals {
  return {
    version: ANNUAL_FUNDAMENTALS_VERSION,
    fiscalYears: years.map((fiscalYearEnd) => ({
      fiscalYearEnd,
      items: {
        net_income: fact("net_income", fiscalYearEnd, "10"),
        shares_outstanding: fact("shares_outstanding", fiscalYearEnd, "10"),
      },
    })),
  };
}

function close(marketDate: string, price: string, currency = "USD") {
  return { securityId: SECURITY, marketDate, close: price, currency };
}

describe(HISTORICAL_PE_BAND_VERSION, () => {
  it("aligns five fiscal closes and reports min, median and max", () => {
    const years = [
      "2025-12-31",
      "2024-12-31",
      "2023-12-31",
      "2022-12-31",
      "2021-12-31",
    ];
    const result = historicalPeBand({
      series: series(years),
      closes: years.map((date, index) => close(date, String(10 + index * 2))),
      events: [],
      asOf: "2026-10-30",
      knownAt: "2026-10-30T12:00:00Z",
      currency: "USD",
      commonShareClasses: 1,
    });
    expect(result.n).toBe(5);
    expect([result.minimum, result.median, result.maximum]).toEqual([
      "10",
      "14",
      "18",
    ]);
  });

  it("refuses a split affected year and more than one common share class", () => {
    const base = {
      series: series(["2025-12-31", "2024-12-31"]),
      closes: [close("2025-12-30", "20"), close("2024-12-30", "15")],
      events: [
        {
          securityId: SECURITY,
          eventType: "split" as const,
          effectiveOn: "2025-06-01",
          value: "2",
          currency: null,
        },
      ],
      asOf: "2026-10-30",
      knownAt: "2026-10-30T12:00:00Z",
      currency: "USD",
      commonShareClasses: 1,
    };
    expect(historicalPeBand(base).points[1]).toMatchObject({
      value: null,
      reason: "split_basis_unreconciled",
    });
    expect(historicalPeBand({ ...base, commonShareClasses: 2 })).toMatchObject({
      unavailableReason: "multiple_share_classes",
      n: 0,
    });
  });

  it("names absent, non-positive and mismatched inputs", () => {
    const years = series(["2025-12-31", "2024-12-31", "2023-12-31"]);
    const result = historicalPeBand({
      series: {
        ...years,
        fiscalYears: [
          years.fiscalYears[0]!,
          {
            ...years.fiscalYears[1]!,
            items: {
              net_income: fact("net_income", "2024-12-31", "0"),
              shares_outstanding: fact(
                "shares_outstanding",
                "2024-12-31",
                "10",
              ),
            },
          },
          years.fiscalYears[2]!,
        ],
      },
      closes: [close("2025-12-31", "10", "EUR"), close("2024-12-31", "10")],
      events: [],
      asOf: "2026-10-30",
      knownAt: "2026-10-30T12:00:00Z",
      currency: "USD",
      commonShareClasses: 1,
    });
    expect(result.points.map((point) => point.reason)).toEqual([
      "currency_mismatch",
      "non_positive_input",
      "no_close",
    ]);
  });
});
