/**
 * Synthetic `EARNINGS_ESTIMATES` payloads (ADR 0083): the shape measured on
 * 2026-11-18 with invented numbers. No captured response enters the repo.
 */
export type FixtureEstimateRow = Record<string, string | null>;

export function fixtureEstimateRow(
  overrides: Partial<FixtureEstimateRow> & {
    readonly date: string;
    readonly horizon?: string;
  },
): FixtureEstimateRow {
  return {
    horizon: "fiscal year",
    eps_estimate_average: "5.0000",
    eps_estimate_high: "5.5000",
    eps_estimate_low: "4.5000",
    eps_estimate_analyst_count: "12.0000",
    eps_estimate_average_7_days_ago: "5.0000",
    eps_estimate_average_30_days_ago: "4.9000",
    eps_estimate_average_60_days_ago: "4.8000",
    eps_estimate_average_90_days_ago: "4.7000",
    eps_estimate_revision_up_trailing_7_days: "0.0000",
    eps_estimate_revision_down_trailing_7_days: null,
    eps_estimate_revision_up_trailing_30_days: "3.0000",
    eps_estimate_revision_down_trailing_30_days: null,
    revenue_estimate_average: "1000000000.00",
    revenue_estimate_high: "1100000000.00",
    revenue_estimate_low: "900000000.00",
    revenue_estimate_analyst_count: "10.00",
    ...overrides,
  };
}

export function fixtureEstimatesBody(
  symbol: string,
  rows: readonly FixtureEstimateRow[],
): string {
  return JSON.stringify({ symbol, estimates: rows });
}

/** FY1 2026-12-31 at 5.00, FY2 2027-12-31 at 6.00, two quarters dropped. */
export function fixtureTwoFiscalYearsBody(symbol = "FIXT"): string {
  return fixtureEstimatesBody(symbol, [
    fixtureEstimateRow({
      date: "2027-12-31",
      eps_estimate_average: "6.0000",
      eps_estimate_high: "6.6000",
      eps_estimate_low: "5.4000",
    }),
    fixtureEstimateRow({ date: "2026-12-31" }),
    fixtureEstimateRow({ date: "2027-03-31", horizon: "fiscal quarter" }),
    fixtureEstimateRow({ date: "2026-09-30", horizon: "fiscal quarter" }),
  ]);
}
