import { describe, expect, it } from "vitest";

import type {
  AnnualFundamentals,
  LineItemId,
  LineItemValue,
} from "./annual-fundamentals";
import {
  assessFundamentalProfileSignals,
  FUNDAMENTAL_PROFILE_SIGNALS_VERSION,
  type FundamentalSignal,
} from "./fundamental-profile-signals";

const SUBJECT = "11111111-1111-4111-8111-111111111111";
let sequence = 0;

type YearSpec = Partial<Record<LineItemId, string | [string, string]>>;

/** `[valor, moneda]` cuando el caso necesita otra moneda que USD. */
function series(
  ...years: Array<{ end: string; items: YearSpec }>
): AnnualFundamentals {
  return {
    version: "annual-fundamentals-1.0.0",
    fiscalYears: years.map(({ end, items }) => ({
      fiscalYearEnd: end,
      items: Object.fromEntries(
        Object.entries(items).map(([item, spec]) => {
          sequence += 1;
          const [value, currency] = Array.isArray(spec) ? spec : [spec, "USD"];
          const year = Number.parseInt(end.slice(0, 4), 10);
          const entry: LineItemValue = {
            item: item as LineItemId,
            concept: `us-gaap:${item}`,
            value,
            unit: currency,
            currency,
            asOf: end,
            observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
            availableAt: `${year + 1}-02-01T21:00:00.000Z`,
            recordedAt: `${year + 1}-02-02T00:00:00.000Z`,
            sourceDocumentId: `0000000042-${year}-000001`,
          };
          return [item, entry];
        }),
      ),
    })),
  };
}

function signal(
  fundamentals: AnnualFundamentals,
  profile: FundamentalSignal["profile"],
): FundamentalSignal {
  return assessFundamentalProfileSignals(
    SUBJECT,
    fundamentals,
    "sec-edgar",
  ).signals.find((candidate) => candidate.profile === profile)!;
}

const HEALTHY = { revenue: "100", operating_income: "20", equity: "50" };

describe(`${FUNDAMENTAL_PROFILE_SIGNALS_VERSION}: distress`, () => {
  it("is present when coverage stays below 1.25 two years in a row", () => {
    const result = signal(
      series(
        {
          end: "2024-12-31",
          items: {
            operating_income: "12",
            interest_expense: "10",
            equity: "5",
          },
        },
        {
          end: "2023-12-31",
          items: { operating_income: "-5", interest_expense: "10" },
        },
      ),
      "distressed",
    );

    expect(result).toMatchObject({
      state: "present",
      basis: ["coverage_below_threshold_two_years"],
      measures: { coverageLatest: "1.2000", coveragePrior: "-0.5000" },
    });
  });

  it("is present with negative equity and an operating loss", () => {
    expect(
      signal(
        series({
          end: "2024-12-31",
          items: { operating_income: "-1", equity: "-3" },
        }),
        "distressed",
      ),
    ).toMatchObject({
      state: "present",
      basis: ["negative_equity_and_operating_loss"],
    });
  });

  it("is absent when one bad year follows a covered one", () => {
    const result = signal(
      series(
        {
          end: "2025-12-31",
          items: {
            operating_income: "-9",
            interest_expense: "1",
            equity: "40",
          },
        },
        {
          end: "2024-12-31",
          items: { operating_income: "5", interest_expense: "1" },
        },
      ),
      "distressed",
    );

    expect(result.state).toBe("absent");
  });

  it("proves absence without interest from two operating profits and positive equity", () => {
    expect(
      signal(
        series(
          { end: "2025-12-31", items: HEALTHY },
          { end: "2024-12-31", items: { operating_income: "18" } },
        ),
        "distressed",
      ),
    ).toMatchObject({
      state: "absent",
      basis: ["positive_equity_and_operating_income_two_years"],
    });
  });

  it("accepts net income as a declared alternative and says so", () => {
    const fundamentals = series(
      { end: "2025-12-31", items: { net_income: "3", equity: "40" } },
      { end: "2024-12-31", items: { net_income: "2" } },
    );
    const assessed = assessFundamentalProfileSignals(
      SUBJECT,
      fundamentals,
      "sec-edgar",
    );

    expect(assessed.signals[0]).toMatchObject({
      state: "absent",
      basis: ["positive_equity_and_net_income_two_years"],
    });
    expect(
      assessed.evidence.find((item) => item.profile === "distressed")
        ?.derivation,
    ).toBe("declared_alternative");
  });

  it("proves absence when cash covers every liability", () => {
    expect(
      signal(
        series({
          end: "2025-12-31",
          items: {
            operating_income: "-4",
            equity: "30",
            cash: "8",
            liquid_investments: "4",
            liabilities: "12",
          },
        }),
        "distressed",
      ),
    ).toMatchObject({
      state: "absent",
      basis: ["liquid_assets_cover_liabilities"],
    });
  });

  it("stays unknown and names what is missing instead of treating it as zero", () => {
    expect(
      signal(
        series({
          end: "2025-12-31",
          items: { operating_income: "-4", cash: "1", liabilities: "12" },
        }),
        "distressed",
      ),
    ).toMatchObject({
      state: "unknown",
      missing: ["interest_coverage", "equity_and_ebit"],
    });
  });

  it("does not divide by a zero or negative interest expense", () => {
    expect(
      signal(
        series(
          {
            end: "2025-12-31",
            items: { operating_income: "-4", interest_expense: "0" },
          },
          {
            end: "2024-12-31",
            items: { operating_income: "-4", interest_expense: "-1" },
          },
        ),
        "distressed",
      ).state,
    ).toBe("unknown");
  });

  it("does not compare amounts across currencies", () => {
    expect(
      signal(
        series(
          {
            end: "2025-12-31",
            items: { operating_income: "1", interest_expense: ["10", "JPY"] },
          },
          {
            end: "2024-12-31",
            items: { operating_income: "1", interest_expense: ["10", "JPY"] },
          },
        ),
        "distressed",
      ).state,
    ).toBe("unknown");
  });
});

describe(`${FUNDAMENTAL_PROFILE_SIGNALS_VERSION}: persistent losses`, () => {
  it("is present with operating losses in two of the last three years", () => {
    expect(
      signal(
        series(
          { end: "2025-12-31", items: { operating_income: "-1" } },
          { end: "2024-12-31", items: { operating_income: "3" } },
          { end: "2023-12-31", items: { operating_income: "-2" } },
        ),
        "loss_making",
      ),
    ).toMatchObject({ state: "present", measures: { lossYears: "2" } });
  });

  it("is absent with a single bad year, and a zero is not a loss", () => {
    expect(
      signal(
        series(
          { end: "2025-12-31", items: { operating_income: "-1" } },
          { end: "2024-12-31", items: { operating_income: "0" } },
          { end: "2023-12-31", items: { operating_income: "2" } },
        ),
        "loss_making",
      ).state,
    ).toBe("absent");
  });

  it("reconstructs EBIT from pretax income plus interest and marks it", () => {
    const fundamentals = series(
      {
        end: "2025-12-31",
        items: { pretax_income: "-5", interest_expense: "1" },
      },
      {
        end: "2024-12-31",
        items: { pretax_income: "-5", interest_expense: "1" },
      },
      { end: "2023-12-31", items: { operating_income: "2" } },
    );
    const assessed = assessFundamentalProfileSignals(
      SUBJECT,
      fundamentals,
      "sec-edgar",
    );

    expect(assessed.signals[1]?.basis).toContain("ebit_pretax_plus_interest");
    expect(
      assessed.evidence.find((item) => item.profile === "loss_making")
        ?.derivation,
    ).toBe("declared_alternative");
  });

  it("stays unknown with fewer than three known years", () => {
    expect(
      signal(
        series(
          { end: "2025-12-31", items: { operating_income: "1" } },
          { end: "2024-12-31", items: { revenue: "10" } },
          { end: "2023-12-31", items: { operating_income: "2" } },
        ),
        "loss_making",
      ),
    ).toMatchObject({
      state: "unknown",
      missing: ["ebit.last_3_fiscal_years"],
    });
  });
});

describe(`${FUNDAMENTAL_PROFILE_SIGNALS_VERSION}: high growth`, () => {
  const years = (latest: string, base: string, baseEnd = "2022-12-31") =>
    series(
      { end: "2025-12-31", items: { revenue: latest } },
      { end: "2024-12-31", items: { revenue: "1" } },
      { end: "2023-12-31", items: { revenue: "1" } },
      { end: baseEnd, items: { revenue: base } },
    );

  it("is present exactly at 15% compound growth over three years", () => {
    expect(signal(years("152.0875", "100"), "high_growth")).toMatchObject({
      state: "present",
      measures: { revenueRatio: "1.5209", thresholdRatio: "1.5209" },
    });
  });

  it("is absent just below the threshold and for shrinking revenue", () => {
    expect(signal(years("152.08", "100"), "high_growth").state).toBe("absent");
    expect(signal(years("50", "100"), "high_growth").state).toBe("absent");
  });

  it("stays unknown on a zero or negative base instead of dividing", () => {
    expect(signal(years("10", "0"), "high_growth")).toMatchObject({
      state: "unknown",
      missing: ["revenue.positive_base"],
    });
    expect(signal(years("10", "-5"), "high_growth").state).toBe("unknown");
  });

  it("stays unknown when the base year is not three years back", () => {
    expect(
      signal(years("200", "100", "2021-12-31"), "high_growth"),
    ).toMatchObject({
      state: "unknown",
      missing: ["revenue.consecutive_fiscal_years"],
    });
  });

  it("stays unknown across currencies", () => {
    const mixed = series(
      { end: "2025-12-31", items: { revenue: "200" } },
      { end: "2024-12-31", items: {} },
      { end: "2023-12-31", items: {} },
      { end: "2022-12-31", items: { revenue: ["100", "EUR"] } },
    );

    expect(signal(mixed, "high_growth").state).toBe("unknown");
  });
});

describe("evidence from fundamentals", () => {
  it("is dated by its latest input and never visible before its data", () => {
    const assessed = assessFundamentalProfileSignals(
      SUBJECT,
      series(
        { end: "2025-12-31", items: HEALTHY },
        { end: "2024-12-31", items: { operating_income: "18", revenue: "90" } },
        { end: "2023-12-31", items: { operating_income: "15", revenue: "80" } },
        { end: "2022-12-31", items: { revenue: "70" } },
      ),
      "sec-edgar",
    );

    expect(assessed.evidence.map((item) => item.profile).sort()).toEqual([
      "distressed",
      "high_growth",
      "loss_making",
    ]);
    for (const item of assessed.evidence) {
      expect(item).toMatchObject({
        validFrom: "2025-12-31T00:00:00.000Z",
        availableAt: "2026-02-01T21:00:00.000Z",
        present: false,
        rule: FUNDAMENTAL_PROFILE_SIGNALS_VERSION,
        derivation: "primary",
      });
    }
  });

  it("produces no evidence for an undecided signal", () => {
    expect(
      assessFundamentalProfileSignals(
        SUBJECT,
        { version: "annual-fundamentals-1.0.0", fiscalYears: [] },
        "sec-edgar",
      ).evidence,
    ).toEqual([]);
  });
});
