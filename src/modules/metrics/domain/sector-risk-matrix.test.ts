import { describe, expect, it } from "vitest";

import {
  buildSectorRiskMatrix,
  fitSector,
  MIN_FIT_POINTS,
  SECTOR_RISK_MATRIX_VERSION,
  type CedearMark,
  type SectorMemberSeries,
} from "./sector-risk-matrix";
import type { ReturnClose } from "./total-return";

const AS_OF = "2026-09-25";

function weekdays(from: string, to: string): string[] {
  const dates: string[] = [];

  for (
    let day = new Date(`${from}T00:00:00.000Z`);
    day.toISOString().slice(0, 10) <= to;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      dates.push(day.toISOString().slice(0, 10));
    }
  }

  return dates;
}

/** Serie que alterna `up` y `down` todos los días. */
function alternating(from: string, up: number, down: number): ReturnClose[] {
  let price = 100;

  return weekdays(from, AS_OF).map((marketDate, index) => {
    if (index > 0) {
      price *= 1 + (index % 2 === 1 ? up : down);
    }

    return { marketDate, close: price.toFixed(20), currency: "USD" };
  });
}

const NO_CEDEAR: CedearMark = {
  status: "none_known",
  reason: "no_program_recorded",
};

function member(
  securityId: string,
  ticker: string | null,
  closes: ReturnClose[],
  overrides: Partial<SectorMemberSeries> = {},
): SectorMemberSeries {
  return {
    securityId,
    issuerLegalEntityId: `issuer-${securityId}`,
    issuerName: null,
    ticker,
    mic: ticker === null ? null : "XNAS",
    cedear: NO_CEDEAR,
    closes,
    events: [],
    ...overrides,
  };
}

function matrix(members: readonly SectorMemberSeries[]) {
  return buildSectorRiskMatrix({
    asOf: AS_OF,
    sector: {
      code: "communication-services",
      label: "Communication Services",
      taxonomyId: "sp500-wikipedia-gics-sector",
      taxonomyVersion: "pin",
    },
    reference: {
      benchmarkId: "sp500-total-return",
      label: "S&P 500 Total Return",
      closes: alternating("2021-09-01", 0.015, -0.01),
    },
    members,
  });
}

describe("fitSector", () => {
  it("is ordinary least squares of the 5-year axis on the 2-year axis", () => {
    expect(
      fitSector([
        { x: "0", y: "1" },
        { x: "1", y: "3" },
        { x: "2", y: "5" },
      ]),
    ).toEqual({
      status: "computed",
      formulaVersion: "sector-fit-ols-1.0.0",
      n: 3,
      slope: "2",
      intercept: "1",
    });
  });

  it("does not draw a line through fewer than three points", () => {
    expect(MIN_FIT_POINTS).toBe(3);
    expect(
      fitSector([
        { x: "0", y: "1" },
        { x: "1", y: "3" },
      ]),
    ).toMatchObject({ status: "null", reason: "too_few_points", n: 2 });
  });

  it("names a vertical cloud instead of dividing by zero", () => {
    expect(
      fitSector([
        { x: "1", y: "1" },
        { x: "1", y: "2" },
        { x: "1", y: "3" },
      ]),
    ).toMatchObject({ status: "null", reason: "no_x_variance", n: 3 });
  });
});

describe("buildSectorRiskMatrix", () => {
  const strong = alternating("2021-09-01", 0.02, -0.01);
  const weak = alternating("2021-09-01", 0.01, -0.02);
  const young = alternating("2024-06-03", 0.02, -0.01);

  it("computes the reference in the same windows and places each point against it", () => {
    const result = matrix([
      member("a", "STRG", strong),
      member("b", "WEAK", weak),
    ]);

    expect(result.ruleVersion).toBe(SECTOR_RISK_MATRIX_VERSION);
    expect(result.reference.sortino2y.status).toBe("computed");
    expect(result.reference.sortino5y.status).toBe("computed");
    expect(
      result.points.map((point) => [point.ticker, point.quadrant]),
    ).toEqual([
      ["STRG", "beats_both"],
      ["WEAK", "beats_neither"],
    ]);

    const [strongPoint] = result.points;

    expect(Number(strongPoint!.distanceToReference.window2y)).toBeGreaterThan(
      0,
    );
  });

  it("keeps a point without a 5-year history out of the quadrants and the fit, with its reason", () => {
    const result = matrix([
      member("a", "STRG", strong),
      member("b", "WEAK", weak),
      member("c", "YNG", young),
    ]);
    const youngPoint = result.points.find((point) => point.ticker === "YNG")!;

    expect(youngPoint.sortino2y.status).toBe("computed");
    expect(youngPoint.sortino5y).toMatchObject({
      status: "null",
      reason: "insufficient_history",
    });
    expect(youngPoint.quadrant).toBeNull();
    expect(youngPoint.distanceToReference.window5y).toBeNull();
    // Dos puntos con las dos ventanas: no alcanza para una recta.
    expect(result.fit).toMatchObject({ status: "null", n: 2 });
  });

  it("draws two share classes of one issuer as two points", () => {
    const result = matrix([
      member("goog", "GOOG", strong, { issuerLegalEntityId: "alphabet" }),
      member("googl", "GOOGL", strong, { issuerLegalEntityId: "alphabet" }),
      member("b", "WEAK", weak),
    ]);

    expect(result.points.map((point) => point.ticker)).toEqual([
      "GOOG",
      "GOOGL",
      "WEAK",
    ]);
    expect(result.fit).toMatchObject({ status: "computed", n: 3 });
  });

  it("carries the CEDEAR mark through untouched", () => {
    const mark: CedearMark = {
      status: "program",
      ratio: { depositaryUnits: "58", underlyingUnits: "1" },
      programs: 1,
      programStatus: "active",
    };
    const result = matrix([member("a", "STRG", strong, { cedear: mark })]);

    expect(result.points[0]!.cedear).toEqual(mark);
  });

  it("orders by ticker and leaves a security without one at the end", () => {
    const result = matrix([
      member("z", null, weak),
      member("b", "BBB", weak),
      member("a", "AAA", strong),
    ]);

    expect(result.points.map((point) => point.securityId)).toEqual([
      "a",
      "b",
      "z",
    ]);
  });

  it("does not place anything when the reference has no value", () => {
    const result = buildSectorRiskMatrix({
      asOf: AS_OF,
      sector: {
        code: "energy",
        label: "Energy",
        taxonomyId: "sp500-wikipedia-gics-sector",
        taxonomyVersion: null,
      },
      reference: {
        benchmarkId: "sp500-total-return",
        label: "S&P 500 Total Return",
        closes: [],
      },
      members: [member("a", "STRG", strong)],
    });

    expect(result.reference.sortino2y).toMatchObject({
      status: "null",
      reason: "no_close_at_as_of",
    });
    expect(result.points[0]!.quadrant).toBeNull();
    expect(result.points[0]!.distanceToReference).toEqual({
      window2y: null,
      window5y: null,
    });
  });
});
