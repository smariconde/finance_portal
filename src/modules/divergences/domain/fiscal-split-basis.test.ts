import { describe, expect, it } from "vitest";

import { corporateActionSchema } from "@/modules/corporate-actions/domain/reporting-succession";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import type { FundamentalRow } from "@/modules/valuation/domain/annual-fundamentals";

import { reconcileFiscalSplitBasis } from "./fiscal-split-basis";

const subjectId = "11111111-1111-4111-8111-111111111111";
const securityId = "22222222-2222-4222-8222-222222222222";
const query = pointInTimeQuerySchema.parse({
  effectiveAt: "2026-02-01T00:00:00.000Z",
  knownAt: "2026-02-01T00:00:00.000Z",
  revisionPolicy: "as_known",
  sourcePolicyVersion: "source-policy-1.0.0",
});

function row(
  concept: string,
  value: string,
  availableAt = "2021-02-01T10:00:00.000Z",
): FundamentalRow {
  return {
    observationId: `${concept}-${availableAt}`,
    subjectId,
    concept: `us-gaap:${concept}`,
    periodType:
      concept === "CommonStockSharesOutstanding" ? "instant" : "annual",
    asOf: "2020-12-31",
    periodStart: "2020-01-01",
    unit: concept.includes("EarningsPerShare") ? "USD/shares" : "shares",
    currency: concept.includes("EarningsPerShare") ? "USD" : null,
    value,
    availableAt,
    recordedAt: availableAt,
    sourceDocumentId: availableAt.startsWith("2022")
      ? "later-filing"
      : "early-filing",
  };
}

function action(ratio = "4", availableAt = "2022-03-01T10:00:00.000Z") {
  return corporateActionSchema.parse({
    corporateActionId: "33333333-3333-4333-8333-333333333333",
    actionType: Number(ratio) > 1 ? "split" : "reverse_split",
    subjectType: "legal_entity",
    subjectId,
    announcedAt: null,
    // SEC's date is the first period reported in the new basis, not the trade date.
    effectiveOn: "2022-02-28",
    availableAt,
    sourceId: "sec-edgar",
    sourceDocumentId: "split-filing",
    terms: { ratio },
    contentHash: "a".repeat(64),
    recordedAt: availableAt,
  });
}

function input(ratio = "4") {
  return {
    price: { marketDate: "2020-12-30", close: "20" },
    fiscalYearEnd: "2020-12-31",
    events: [
      {
        securityId,
        eventType: "split" as const,
        effectiveOn: "2022-01-10",
        value: ratio,
        currency: null,
      },
    ],
    actions: [action(ratio)],
    query,
    eps: row("EarningsPerShareDiluted", "8"),
    dilutedShares: row(
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "120",
    ),
    sharesOutstanding: row("CommonStockSharesOutstanding", "100"),
  };
}

describe("reconcileFiscalSplitBasis", () => {
  it("carries raw price and pre-split SEC facts into the verified new basis", () => {
    const result = reconcileFiscalSplitBasis(input());
    expect(result).toMatchObject({
      version: "fiscal-split-basis-1.0.0",
      reason: null,
      priceFactor: "4",
      adjustedPrice: "5",
      adjustedEps: "2",
      adjustedDilutedShares: "480",
      adjustedSharesOutstanding: "400",
      actionIds: ["33333333-3333-4333-8333-333333333333"],
    });
  });

  it("does not adjust a fact already published in the split basis", () => {
    const later = "2022-04-01T10:00:00.000Z";
    const result = reconcileFiscalSplitBasis({
      ...input(),
      eps: row("EarningsPerShareDiluted", "2", later),
      dilutedShares: row(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "480",
        later,
      ),
      sharesOutstanding: row("CommonStockSharesOutstanding", "400", later),
    });
    expect(result.reason).toBeNull();
    expect(result.adjustedEps).toBe("2");
    expect(result.adjustedSharesOutstanding).toBe("400");

    const sameFiling = reconcileFiscalSplitBasis({
      ...input(),
      sharesOutstanding: {
        ...row("CommonStockSharesOutstanding", "400", action().availableAt),
        sourceDocumentId: "split-filing",
      },
    });
    expect(sameFiling.reason).toBeNull();
    expect(sameFiling.adjustedSharesOutstanding).toBe("400");
  });

  it("handles a reverse split and preserves the market capitalization product", () => {
    const result = reconcileFiscalSplitBasis(input("0.125"));
    expect(result.reason).toBeNull();
    expect(result.adjustedPrice).toBe("160");
    expect(result.adjustedSharesOutstanding).toBe("12.5");
    expect(result.adjustedEps).toBe("64");
  });

  it("refuses a missing, disagreeing or future SEC confirmation", () => {
    expect(reconcileFiscalSplitBasis({ ...input(), actions: [] }).reason).toBe(
      "split_evidence_missing_or_ambiguous",
    );
    expect(
      reconcileFiscalSplitBasis({ ...input(), actions: [action("2")] }).reason,
    ).toBe("split_evidence_missing_or_ambiguous");
    expect(
      reconcileFiscalSplitBasis({
        ...input(),
        actions: [{ ...action(), effectiveOn: "2021-12-31" }],
      }).reason,
    ).toBe("split_evidence_missing_or_ambiguous");
    expect(
      reconcileFiscalSplitBasis({
        ...input(),
        sharesOutstanding: row(
          "CommonStockSharesOutstanding",
          "400",
          action().availableAt,
        ),
      }).reason,
    ).toBe("split_evidence_missing_or_ambiguous");
    expect(reconcileFiscalSplitBasis({ ...input(), events: [] }).reason).toBe(
      "split_evidence_missing_or_ambiguous",
    );
    expect(
      reconcileFiscalSplitBasis({
        ...input(),
        actions: [
          action(),
          {
            ...action("4", "2022-06-01T10:00:00.000Z"),
            corporateActionId: "55555555-5555-4555-8555-555555555555",
          },
        ],
      }).reason,
    ).toBe("split_evidence_missing_or_ambiguous");
    expect(
      reconcileFiscalSplitBasis({
        ...input(),
        query: pointInTimeQuerySchema.parse({
          ...query,
          knownAt: "2022-02-01T00:00:00.000Z",
        }),
      }).reason,
    ).toBe("split_evidence_missing_or_ambiguous");
  });

  it("preserves nulls and negative earnings while rejecting invalid split ratios", () => {
    const withNulls = reconcileFiscalSplitBasis({
      ...input(),
      eps: { ...row("EarningsPerShareDiluted", "-8"), value: "-8" },
      dilutedShares: null,
    });
    expect(withNulls.reason).toBeNull();
    expect(withNulls.adjustedEps).toBe("-2");
    expect(withNulls.adjustedDilutedShares).toBeNull();
    expect(() =>
      reconcileFiscalSplitBasis({
        ...input(),
        events: [{ ...input().events[0]!, value: "0" }],
      }),
    ).toThrow();
    expect(() =>
      reconcileFiscalSplitBasis({
        ...input(),
        events: [{ ...input().events[0]!, value: "NaN" }],
      }),
    ).toThrow();
  });
});
