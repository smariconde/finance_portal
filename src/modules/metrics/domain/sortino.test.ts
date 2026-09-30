import { describe, expect, it } from "vitest";

import { MetricInputError } from "./metric-input-error";
import {
  SORTINO_FORMULA_VERSION,
  SORTINO_PARAMETERS,
  sortino,
  type SortinoInput,
  type SortinoResult,
} from "./sortino";
import type { ReturnClose, ReturnEvent } from "./total-return";

const SUBJECT = "11111111-1111-4111-8111-111111111111";

/** Ruedas de lunes a viernes entre dos fechas, ambas incluidas. */
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

/**
 * Serie cuyos retornos son exactamente `returnAt(i)`. Los cierres se escriben
 * con precisión de sobra para que el oráculo no dependa del redondeo.
 */
function seriesWithReturns(
  dates: readonly string[],
  returnAt: (index: number) => number,
): ReturnClose[] {
  let price = 100;

  return dates.map((marketDate, index) => {
    if (index > 0) {
      price *= 1 + returnAt(index);
    }

    return { marketDate, close: price.toFixed(20), currency: "USD" };
  });
}

/** El Sortino calculado en punto flotante: un oráculo independiente. */
function floatSortino(returns: readonly number[]): number {
  const mean =
    returns.reduce((total, value) => total + value, 0) / returns.length;
  const downside = Math.sqrt(
    returns.reduce((total, value) => total + Math.min(0, value) ** 2, 0) /
      returns.length,
  );

  return (mean / downside) * Math.sqrt(252);
}

function input(overrides: Partial<SortinoInput>): SortinoInput {
  return {
    subjectId: SUBJECT,
    asOf: "2026-09-25",
    windowYears: 2,
    closes: [],
    events: [],
    ...overrides,
  };
}

function valueOf(result: SortinoResult): number {
  if (result.status !== "computed") {
    throw new Error(`expected a value, got ${result.reason}`);
  }

  return Number(result.value);
}

const alternating = (index: number) => (index % 2 === 1 ? 0.02 : -0.01);

describe("sortino", () => {
  it("matches the closed form on alternating +2 % / −1 % days", () => {
    // Con N par, media 0,005 y desviación a la baja √0,00005: el cociente es
    // √0,5, y por √252 da exactamente √126.
    const dates = weekdays("2024-09-24", "2026-09-25");
    const result = sortino(
      input({ closes: seriesWithReturns(dates, alternating) }),
    );

    expect(result.status).toBe("computed");
    expect(result.status === "computed" && result.returns % 2).toBe(0);
    expect(valueOf(result)).toBeCloseTo(Math.sqrt(126), 12);
  });

  it("agrees with a floating-point oracle on an irregular series", () => {
    // Congruencial lineal: determinista, sin azar del runtime.
    let seed = 42;
    const returns: number[] = [];
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;

      return (seed / 2 ** 31 - 0.5) * 0.06;
    };
    const dates = weekdays("2021-09-20", "2026-09-25");
    const closes = seriesWithReturns(dates, () => {
      const value = next();

      returns.push(value);

      return value;
    });
    const result = sortino(input({ windowYears: 5, closes }));

    if (result.status !== "computed") {
      throw new Error(result.reason);
    }

    // La ventana arranca en el último cierre en o antes del 2021-09-25.
    const baseIndex = dates.findLastIndex((date) => date <= "2021-09-25");

    expect(result.baseDate).toBe(dates[baseIndex]);
    expect(result.returns).toBe(dates.length - 1 - baseIndex);
    expect(Number(result.value)).toBeCloseTo(
      floatSortino(returns.slice(baseIndex)),
      9,
    );
  });

  it("is negative when the window lost money on average", () => {
    const dates = weekdays("2024-09-24", "2026-09-25");
    const result = sortino(
      input({
        closes: seriesWithReturns(dates, (index) =>
          index % 2 === 1 ? 0.01 : -0.02,
        ),
      }),
    );

    expect(valueOf(result)).toBeLessThan(0);
  });

  it("counts a reinvested dividend, which a price-only return would miss", () => {
    const dates = weekdays("2024-09-24", "2026-09-25");
    const closes = seriesWithReturns(dates, alternating);
    const withoutDividends = valueOf(sortino(input({ closes })));
    const withDividends = valueOf(
      sortino(
        input({
          closes,
          events: [
            {
              eventType: "dividend",
              effectiveOn: dates[100]!,
              value: "1",
              currency: "USD",
            },
          ],
        }),
      ),
    );

    expect(withDividends).toBeGreaterThan(withoutDividends);
  });

  it("uses the last close on or before the window start as its base", () => {
    // As_of lunes 2026-09-28: dos años antes es sábado, sin rueda.
    const dates = weekdays("2024-09-02", "2026-09-28");
    const result = sortino(
      input({
        asOf: "2026-09-28",
        closes: seriesWithReturns(dates, alternating),
      }),
    );

    // 2024-09-28 es sábado: la base es el viernes 2024-09-27.
    expect(result.windowStart).toBe("2024-09-28");
    expect(result.status === "computed" && result.baseDate).toBe("2024-09-27");
  });

  it("clamps a leap-day as_of to the 28th of February", () => {
    const dates = weekdays("2026-02-01", "2028-02-29");
    const result = sortino(
      input({
        asOf: "2028-02-29",
        closes: seriesWithReturns(dates, alternating),
      }),
    );

    expect(result.windowStart).toBe("2026-02-28");
    expect(result.status === "computed" && result.baseDate).toBe("2026-02-27");
  });

  it("ignores every close and event after the as_of", () => {
    const dates = weekdays("2024-09-24", "2026-09-25");
    const closes = seriesWithReturns(dates, alternating);
    const base = sortino(input({ closes }));
    const withFuture = sortino(
      input({
        closes: [
          ...closes,
          { marketDate: "2026-09-28", close: "1", currency: "USD" },
        ],
        events: [
          {
            eventType: "split",
            effectiveOn: "2026-09-28",
            value: "100",
            currency: null,
          },
          {
            eventType: "dividend",
            effectiveOn: "2026-09-29",
            value: "50",
            currency: "USD",
          },
        ],
      }),
    );

    expect(withFuture).toEqual(base);
  });

  describe("null with a reason, never a number", () => {
    it("insufficient_history: the series starts inside the window", () => {
      const dates = weekdays("2025-01-02", "2026-09-25");

      expect(
        sortino(input({ closes: seriesWithReturns(dates, alternating) })),
      ).toMatchObject({
        status: "null",
        reason: "insufficient_history",
        marketDate: "2025-01-02",
        formulaVersion: SORTINO_FORMULA_VERSION,
      });
    });

    it("no_close_at_as_of: an empty series", () => {
      expect(sortino(input({ closes: [] }))).toMatchObject({
        status: "null",
        reason: "no_close_at_as_of",
        marketDate: null,
      });
    });

    it("no_close_at_as_of: the security did not trade on the as_of", () => {
      const dates = weekdays("2024-09-24", "2026-09-24");

      expect(
        sortino(input({ closes: seriesWithReturns(dates, alternating) })),
      ).toMatchObject({
        status: "null",
        reason: "no_close_at_as_of",
        marketDate: "2026-09-24",
      });
    });

    it("missing_period: a week without closes is not one long return", () => {
      const dates = weekdays("2024-09-24", "2026-09-25").filter(
        (date) => date < "2025-03-03" || date > "2025-03-07",
      );

      expect(
        sortino(input({ closes: seriesWithReturns(dates, alternating) })),
      ).toMatchObject({
        status: "null",
        reason: "missing_period",
        marketDate: "2025-03-10",
      });
    });

    it("missing_period: a long weekend with a holiday is not a gap", () => {
      // Viernes a martes son 4 días; la tolerancia es 5.
      const dates = weekdays("2024-09-24", "2026-09-25").filter(
        (date) => date !== "2025-09-01",
      );

      expect(
        sortino(input({ closes: seriesWithReturns(dates, alternating) }))
          .status,
      ).toBe("computed");
      expect(SORTINO_PARAMETERS.maxGapCalendarDays).toBe(5);
    });

    it("missing_period: a base far before the window start", () => {
      const dates = ["2024-09-10", ...weekdays("2024-09-30", "2026-09-25")];

      expect(
        sortino(input({ closes: seriesWithReturns(dates, alternating) })),
      ).toMatchObject({ status: "null", reason: "missing_period" });
    });

    it("no_downside_observations: no negative excess, no infinity", () => {
      const dates = weekdays("2024-09-24", "2026-09-25");

      expect(
        sortino(input({ closes: seriesWithReturns(dates, () => 0.001) })),
      ).toMatchObject({ status: "null", reason: "no_downside_observations" });
    });

    it("no_downside_observations: a flat series is not a zero ratio", () => {
      const dates = weekdays("2024-09-24", "2026-09-25");

      expect(
        sortino(input({ closes: seriesWithReturns(dates, () => 0) })),
      ).toMatchObject({ status: "null", reason: "no_downside_observations" });
    });

    it("currency_mismatch: a dividend in another currency", () => {
      const dates = weekdays("2024-09-24", "2026-09-25");
      const events: ReturnEvent[] = [
        {
          eventType: "dividend",
          effectiveOn: dates[200]!,
          value: "1",
          currency: "EUR",
        },
      ];

      expect(
        sortino(
          input({ closes: seriesWithReturns(dates, alternating), events }),
        ),
      ).toMatchObject({ status: "null", reason: "currency_mismatch" });
    });

    it("non_positive_close: a zero close inside the window", () => {
      const dates = weekdays("2024-09-24", "2026-09-25");
      const closes = seriesWithReturns(dates, alternating).map(
        (close, index) => (index === 300 ? { ...close, close: "0" } : close),
      );

      expect(sortino(input({ closes }))).toMatchObject({
        status: "null",
        reason: "non_positive_close",
        marketDate: dates[300],
      });
    });
  });

  it("refuses a close that is not a finite canonical decimal", () => {
    const dates = weekdays("2024-09-24", "2026-09-25");
    const closes = seriesWithReturns(dates, alternating).map((close, index) =>
      index === 10 ? { ...close, close: "NaN" } : close,
    );

    expect(() => sortino(input({ closes }))).toThrow(MetricInputError);
  });

  it("reports the audit trail next to the value", () => {
    const dates = weekdays("2024-09-24", "2026-09-25");
    const result = sortino(
      input({ closes: seriesWithReturns(dates, alternating) }),
    );

    expect(result).toMatchObject({
      status: "computed",
      formulaVersion: "sortino-1.0.0",
      windowYears: 2,
      asOf: "2026-09-25",
      windowStart: "2024-09-25",
      baseDate: "2024-09-25",
    });

    if (result.status === "computed") {
      expect(result.downsideReturns).toBe(result.returns / 2);
      expect(Number(result.meanExcessReturn)).toBeCloseTo(0.005, 12);
      expect(Number(result.downsideDeviation)).toBeCloseTo(
        Math.sqrt(0.00005),
        12,
      );
    }
  });

  it("declares the parameters the owner decided", () => {
    expect(SORTINO_PARAMETERS).toEqual({
      minimumAcceptableReturn: "0",
      frequency: "daily",
      periodsPerYear: 252,
      returnBasis: "total-return-1.0.0",
      numerator: "arithmetic_mean",
      windowBoundary: "calendar",
      maxGapCalendarDays: 5,
    });
  });
});
