import { describe, expect, it } from "vitest";

import { corporateActionSchema } from "@/modules/corporate-actions/domain/reporting-succession";
import type { DailyClose } from "@/modules/prices/domain/daily-close";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import {
  ANNUAL_FUNDAMENTALS_VERSION,
  type AnnualFundamentals,
  type FundamentalRow,
  type LineItemValue,
} from "@/modules/valuation/domain/annual-fundamentals";

import { selectFiscalEndpoints } from "./fiscal-endpoints";

const securityId = "11111111-1111-4111-8111-111111111111";
const query = pointInTimeQuerySchema.parse({
  effectiveAt: "2026-02-01T00:00:00.000Z",
  revisionPolicy: "as_known",
  knownAt: "2026-02-01T00:00:00.000Z",
  sourcePolicyVersion: "source-policy-1.0.0",
});

function item(
  itemId: LineItemValue["item"],
  end: string,
  value: string,
  unit = "shares",
): LineItemValue {
  return {
    item: itemId,
    concept: `us-gaap:${itemId}`,
    value,
    unit,
    currency: unit === "USD" ? "USD" : null,
    asOf: end,
    observationId: `${itemId}-${end}`,
    availableAt: "2026-01-01T00:00:00.000Z",
    recordedAt: "2026-01-02T00:00:00.000Z",
    sourceDocumentId: null,
  };
}

function series(): AnnualFundamentals {
  return {
    version: ANNUAL_FUNDAMENTALS_VERSION,
    fiscalYears: ["2025-12-31", "2023-12-31", "2020-12-31"].map((end) => ({
      fiscalYearEnd: end,
      items: {
        net_income: item("net_income", end, "1000", "USD"),
        diluted_shares: item("diluted_shares", end, "120"),
        shares_outstanding: item("shares_outstanding", end, "100"),
      },
    })),
  };
}

function eps(
  end: string,
  value: string,
  availableAt = "2026-01-01T00:00:00.000Z",
): FundamentalRow {
  return {
    observationId: `eps-${end}-${value}`,
    subjectId: securityId,
    concept: "us-gaap:EarningsPerShareDiluted",
    periodType: "annual",
    periodStart: `${Number(end.slice(0, 4))}-01-01`,
    asOf: end,
    unit: "USD/shares",
    currency: "USD",
    value,
    availableAt,
    recordedAt: availableAt,
    sourceDocumentId: null,
  };
}

function close(
  marketDate: string,
  value: string,
  currency = "USD",
): DailyClose {
  return { securityId, marketDate, close: value, currency };
}

describe("selectFiscalEndpoints", () => {
  it("aligns both horizons to fiscal closes and uses instant shares for market cap", () => {
    const input = {
      series: series(),
      epsRows: [
        eps("2025-12-31", "10"),
        eps("2023-12-31", "8"),
        eps("2020-12-31", "4"),
      ],
      closes: [
        close("2025-12-30", "50"),
        close("2023-12-29", "30"),
        close("2020-12-30", "20"),
      ],
      events: [],
      actions: [],
      query,
    };
    const two = selectFiscalEndpoints({ ...input, horizonYears: 2 });
    const five = selectFiscalEndpoints({ ...input, horizonYears: 5 });

    expect(two.earlier?.fiscalYearEnd).toBe("2023-12-31");
    expect(five.earlier?.fiscalYearEnd).toBe("2020-12-31");
    expect(two.latest?.marketCap).toBe("5000");
    expect(two.latest?.dilutedShares?.value).toBe("120");
    expect(two.latest?.priceLagDays).toBe(1);
    expect(two.actualYears).toBeGreaterThan(1.99);
  });

  it("keeps unavailable values named, including a distant close and mismatched currency", () => {
    const result = selectFiscalEndpoints({
      series: series(),
      epsRows: [],
      closes: [close("2025-12-20", "50"), close("2023-12-29", "30", "ARS")],
      events: [],
      actions: [],
      query,
      horizonYears: 2,
    });
    expect(result.latest?.marketCap).toBeNull();
    expect(result.latest?.missing).toContain("price_near_fiscal_close");
    expect(result.latest?.missing).toContain("diluted_eps");
    expect(result.earlier?.marketCap).toBeNull();
    expect(result.earlier?.missing).toContain(
      "market_cap_unit_or_currency_mismatch",
    );
  });

  it("does not use an EPS restatement first known after the cutoff", () => {
    const result = selectFiscalEndpoints({
      series: series(),
      epsRows: [
        eps("2025-12-31", "10"),
        eps("2025-12-31", "11", "2026-03-01T00:00:00.000Z"),
      ],
      closes: [close("2025-12-31", "50")],
      events: [],
      actions: [],
      query,
      horizonYears: 2,
    });
    expect(result.latest?.dilutedEps?.value).toBe("10");
  });

  it("refuses a historical raw price times share figures reexpressed after a split", () => {
    const result = selectFiscalEndpoints({
      series: series(),
      epsRows: [eps("2020-12-31", "4")],
      closes: [close("2020-12-30", "20")],
      events: [
        {
          securityId,
          eventType: "split",
          effectiveOn: "2022-01-01",
          value: "4",
          currency: null,
        },
      ],
      actions: [],
      query,
      horizonYears: 5,
    });
    expect(result.earlier?.price?.close).toBe("20");
    expect(result.earlier?.marketCap).toBeNull();
    expect(result.earlier?.missing).toContain(
      "market_cap_split_basis_unreconciled",
    );
    expect(result.earlier?.missing).toContain(
      "split_evidence_missing_or_ambiguous",
    );
    expect(result.latest?.missing).not.toContain(
      "market_cap_split_basis_unreconciled",
    );
  });

  it("calculates a historical market cap only after SEC and market split evidence agree", () => {
    const original = series();
    const old = "2020-12-31";
    const published = "2021-02-01T10:00:00.000Z";
    const earlier = original.fiscalYears.find(
      (year) => year.fiscalYearEnd === old,
    )!;
    const shares = earlier.items.shares_outstanding!;
    const diluted = earlier.items.diluted_shares!;
    const selectedRows: FundamentalRow[] = [
      eps(old, "8", published),
      ...[shares, diluted].map((item) => ({
        observationId: item.observationId,
        subjectId: securityId,
        concept: item.concept,
        periodType: item.item === "shares_outstanding" ? "instant" : "annual",
        periodStart: item.item === "shares_outstanding" ? null : "2020-01-01",
        asOf: old,
        unit: "shares",
        currency: null,
        value: item.value,
        availableAt: published,
        recordedAt: published,
        sourceDocumentId: "original-filing",
      })),
    ];
    const result = selectFiscalEndpoints({
      series: {
        ...original,
        fiscalYears: original.fiscalYears.map((year) =>
          year.fiscalYearEnd === old
            ? {
                ...year,
                items: {
                  ...year.items,
                  shares_outstanding: { ...shares, availableAt: published },
                  diluted_shares: { ...diluted, availableAt: published },
                },
              }
            : year,
        ),
      },
      epsRows: selectedRows,
      closes: [close("2020-12-30", "20")],
      events: [
        {
          securityId,
          eventType: "split",
          effectiveOn: "2022-01-10",
          value: "4",
          currency: null,
        },
      ],
      actions: [
        corporateActionSchema.parse({
          corporateActionId: "44444444-4444-4444-8444-444444444444",
          actionType: "split",
          subjectType: "legal_entity",
          subjectId: securityId,
          announcedAt: null,
          effectiveOn: "2022-02-28",
          availableAt: "2022-03-01T10:00:00.000Z",
          sourceId: "sec-edgar",
          sourceDocumentId: "split-filing",
          terms: { ratio: "4" },
          contentHash: "a".repeat(64),
          recordedAt: "2022-03-01T10:00:00.000Z",
        }),
      ],
      query,
      horizonYears: 5,
    });
    expect(result.earlier?.price?.close).toBe("20");
    expect(result.earlier?.sharesOutstanding?.value).toBe("100");
    expect(result.earlier?.splitBasis.adjustedPrice).toBe("5");
    expect(result.earlier?.splitBasis.adjustedSharesOutstanding).toBe("400");
    expect(result.earlier?.splitBasis.adjustedEps).toBe("2");
    expect(result.earlier?.marketCap).toBe("2000");
  });

  it("does not claim a raw close was known earlier on its market date", () => {
    const sameDay = pointInTimeQuerySchema.parse({
      effectiveAt: "2025-12-31T00:00:00.000Z",
      revisionPolicy: "as_known",
      knownAt: "2025-12-31T00:00:00.000Z",
      sourcePolicyVersion: "source-policy-1.0.0",
    });
    const result = selectFiscalEndpoints({
      series: series(),
      epsRows: [],
      closes: [close("2025-12-31", "50")],
      events: [],
      actions: [],
      query: sameDay,
      horizonYears: 2,
    });
    expect(result.latest?.price).toBeNull();
  });

  it("refuses zero shares instead of fabricating a market cap", () => {
    const broken = series();
    const result = selectFiscalEndpoints({
      series: {
        ...broken,
        fiscalYears: broken.fiscalYears.map((year, index) =>
          index === 0
            ? {
                ...year,
                items: {
                  ...year.items,
                  shares_outstanding: item(
                    "shares_outstanding",
                    year.fiscalYearEnd,
                    "0",
                  ),
                },
              }
            : year,
        ),
      },
      epsRows: [],
      closes: [close("2025-12-31", "50")],
      events: [],
      actions: [],
      query,
      horizonYears: 2,
    });
    expect(result.latest?.marketCap).toBeNull();
    expect(result.latest?.missing).toContain("market_cap_non_positive_input");
  });

  it("refuses negative shares and non-finite text", () => {
    const original = series();
    const withShares = (value: string): AnnualFundamentals => ({
      ...original,
      fiscalYears: original.fiscalYears.map((year, index) =>
        index === 0
          ? {
              ...year,
              items: {
                ...year.items,
                shares_outstanding: item(
                  "shares_outstanding",
                  year.fiscalYearEnd,
                  value,
                ),
              },
            }
          : year,
      ),
    });
    const input = {
      epsRows: [],
      closes: [close("2025-12-31", "50")],
      events: [],
      actions: [],
      query,
      horizonYears: 2 as const,
    };
    expect(
      selectFiscalEndpoints({ ...input, series: withShares("-1") }).latest
        ?.missing,
    ).toContain("market_cap_non_positive_input");
    expect(() =>
      selectFiscalEndpoints({ ...input, series: withShares("NaN") }),
    ).toThrow();
  });

  it("names an absent comparison year", () => {
    const original = series();
    const result = selectFiscalEndpoints({
      series: { ...original, fiscalYears: original.fiscalYears.slice(0, 1) },
      epsRows: [],
      closes: [],
      events: [],
      actions: [],
      query,
      horizonYears: 5,
    });
    expect(result.reason).toBe("no_comparable_year");
    expect(result.earlier).toBeNull();
  });
});
