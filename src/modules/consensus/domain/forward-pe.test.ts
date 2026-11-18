import { describe, expect, it } from "vitest";

import { fiscalYearsAhead, forwardPe, type ConsensusYear } from "./forward-pe";

const YEARS: readonly ConsensusYear[] = [
  { periodEnd: "2026-12-31", epsAverage: "5" },
  { periodEnd: "2027-12-31", epsAverage: "6" },
];

function reading(
  overrides: Partial<Parameters<typeof forwardPe>[0]> = {},
): ReturnType<typeof forwardPe> {
  return forwardPe({
    years: YEARS,
    capturedOn: "2026-11-18",
    close: { marketDate: "2026-11-18", close: "100", currency: "USD" },
    consensusCurrency: "USD",
    ...overrides,
  });
}

describe("forwardPe", () => {
  it("weights FY1 by the share of it still ahead, as the market's NTM does", () => {
    // Expected values computed outside the code with Python's Decimal at 34
    // digits: w = 43/365, NTM = 5w + 6(1 − w) = 2147/365, P/E = 36500/2147.
    const result = reading();

    expect(result.weightFy1).toBe("0.1178082191780821917808219178082192");
    expect(Number(result.ntmEps)).toBeCloseTo(5.882191780821918, 14);
    expect(Number(result.forwardPe)).toBeCloseTo(17.00046576618537, 12);
    expect(result.fy1Pe).toBe("20");
    expect(Number(result.fy2Pe)).toBeCloseTo(16.666666666666667, 12);
    expect(result.growth).toBe("0.2");
    expect(Number(result.peg)).toBeCloseTo(0.8500232883092687, 12);
    expect(result.forwardPeReason).toBeNull();
    expect(result.pegReason).toBeNull();
  });

  it("uses all of FY1's EPS a year before its end and moves to FY2 as it closes", () => {
    const yearAhead = reading({
      close: { marketDate: "2025-12-31", close: "100", currency: "USD" },
      capturedOn: "2025-12-31",
      years: [
        { periodEnd: "2026-12-31", epsAverage: "5" },
        { periodEnd: "2027-12-31", epsAverage: "6" },
      ],
    });
    expect(yearAhead.weightFy1).toBe("1");
    expect(yearAhead.ntmEps).toBe("5");

    const lastDay = reading({
      close: { marketDate: "2026-12-30", close: "100", currency: "USD" },
      capturedOn: "2026-12-30",
    });
    expect(Number(lastDay.weightFy1)).toBeCloseTo(1 / 365, 14);
  });

  it("does not take a fiscal year that ended before the close as FY1", () => {
    const result = reading({
      close: { marketDate: "2027-01-15", close: "100", currency: "USD" },
      capturedOn: "2027-01-15",
    });
    // FY2026 ended and is not reported yet; only FY2027 is ahead.
    expect(result.forwardPe).toBeNull();
    expect(result.forwardPeReason).toBe("insufficient_horizons");
  });

  it("refuses two fiscal years that are not consecutive", () => {
    expect(
      fiscalYearsAhead(
        [
          { periodEnd: "2026-12-31", epsAverage: "5" },
          { periodEnd: "2028-12-31", epsAverage: "6" },
        ],
        "2026-11-18",
      ),
    ).toBeNull();
    // A fiscal year end that moves from September to the same month next year
    // keeps the pair, whatever the day the source prints.
    expect(
      fiscalYearsAhead(
        [
          { periodEnd: "2027-09-30", epsAverage: "9" },
          { periodEnd: "2028-09-30", epsAverage: "10" },
        ],
        "2026-11-18",
      ),
    ).not.toBeNull();
  });

  it("names a missing consensus and a capture a week away from the close", () => {
    expect(reading({ capturedOn: null }).forwardPeReason).toBe("no_consensus");
    expect(reading({ years: [] }).forwardPeReason).toBe("no_consensus");
    expect(reading({ capturedOn: "2026-11-10" }).forwardPeReason).toBe(
      "stale_consensus",
    );
    expect(reading({ capturedOn: "2026-11-11" }).forwardPeReason).toBeNull();
    // Today's capture against yesterday's close is the current reading.
    expect(reading({ capturedOn: "2026-11-19" }).forwardPeReason).toBeNull();
    expect(reading({ capturedOn: "2026-11-26" }).forwardPeReason).toBe(
      "stale_consensus",
    );
  });

  it("names a missing close, another currency and a non-positive close", () => {
    expect(reading({ close: null }).forwardPeReason).toBe("no_close");
    expect(
      reading({
        close: { marketDate: "2026-11-18", close: "100", currency: "EUR" },
      }).forwardPeReason,
    ).toBe("currency_mismatch");
    expect(
      reading({
        close: { marketDate: "2026-11-18", close: "0", currency: "USD" },
      }).forwardPeReason,
    ).toBe("non_positive_close");
  });

  it("gives no P/E on a zero or negative NTM EPS, never a negative multiple", () => {
    const losses = reading({
      years: [
        { periodEnd: "2026-12-31", epsAverage: "-2" },
        { periodEnd: "2027-12-31", epsAverage: "-1" },
      ],
    });
    expect(losses.forwardPe).toBeNull();
    expect(losses.forwardPeReason).toBe("non_positive_eps");
    expect(losses.fy1Pe).toBeNull();
    expect(losses.pegReason).toBe("non_positive_eps");

    const zero = reading({
      years: [
        { periodEnd: "2026-12-31", epsAverage: "0" },
        { periodEnd: "2027-12-31", epsAverage: "0" },
      ],
    });
    expect(zero.forwardPe).toBeNull();
  });

  it("gives no PEG on falling or flat consensus growth, nor from a loss", () => {
    const falling = reading({
      years: [
        { periodEnd: "2026-12-31", epsAverage: "12.8038" },
        { periodEnd: "2027-12-31", epsAverage: "10.6826" },
      ],
    });
    expect(falling.forwardPe).not.toBeNull();
    expect(falling.peg).toBeNull();
    expect(falling.pegReason).toBe("non_positive_growth");

    const flat = reading({
      years: [
        { periodEnd: "2026-12-31", epsAverage: "5" },
        { periodEnd: "2027-12-31", epsAverage: "5" },
      ],
    });
    expect(flat.pegReason).toBe("non_positive_growth");

    const fromLoss = reading({
      years: [
        { periodEnd: "2026-12-31", epsAverage: "-0.5" },
        { periodEnd: "2027-12-31", epsAverage: "6" },
      ],
    });
    expect(fromLoss.forwardPe).not.toBeNull();
    expect(fromLoss.growth).toBeNull();
    expect(fromLoss.pegReason).toBe("non_positive_base");
  });

  it("ignores the order the years come in", () => {
    expect(reading({ years: [...YEARS].reverse() }).forwardPe).toBe(
      reading().forwardPe,
    );
  });
});
