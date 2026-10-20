import { describe, expect, it } from "vitest";

import {
  EQUITY_VOLATILITY_FORMULA_VERSION,
  equityVolatility,
} from "./equity-volatility";
import type { ReturnClose, ReturnEvent } from "./total-return";

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const AS_OF = "2026-06-30";

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

const DATES = weekdays("2021-06-28", AS_OF);

/** Un retorno determinista que alterna signo y tamaño. */
const returnAt = (index: number) =>
  ((index * 7919) % 13) / 400 - 0.015 + (index % 2 === 0 ? 0.002 : -0.001);

function series(dates: readonly string[] = DATES): ReturnClose[] {
  let price = 100;

  return dates.map((marketDate, index) => {
    if (index > 0) {
      price *= 1 + returnAt(index);
    }

    return { marketDate, close: price.toFixed(20), currency: "USD" };
  });
}

/** Oráculo independiente en punto flotante. */
function floatVolatility(closes: readonly ReturnClose[]): number {
  const logs = closes
    .slice(1)
    .map((close, index) =>
      Math.log(Number(close.close) / Number(closes[index]!.close)),
    );
  const mean = logs.reduce((total, value) => total + value, 0) / logs.length;
  const variance =
    logs.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (logs.length - 1);

  return Math.sqrt(variance) * Math.sqrt(252);
}

describe("equityVolatility", () => {
  it("annualizes the sample deviation of daily log price returns", () => {
    const closes = series();
    const result = equityVolatility({
      subjectId: SUBJECT,
      asOf: AS_OF,
      closes,
      events: [],
    });

    expect(result).toMatchObject({
      status: "computed",
      formulaVersion: EQUITY_VOLATILITY_FORMULA_VERSION,
      windowStart: "2021-06-30",
      baseDate: "2021-06-30",
    });

    if (result.status !== "computed") {
      throw new Error("expected a computed volatility");
    }

    const inWindow = closes.filter((close) => close.marketDate >= "2021-06-30");

    expect(result.returns).toBe(inWindow.length - 1);
    expect(Number(result.value)).toBeCloseTo(floatVolatility(inWindow), 10);
  });

  it("carries a split into the base instead of reading it as a crash", () => {
    const closes = series();
    const splitOn = "2024-06-10";
    // La serie cruda: antes del split, el precio es diez veces el ajustado.
    const raw = closes.map((close) =>
      close.marketDate < splitOn
        ? { ...close, close: (Number(close.close) * 10).toFixed(20) }
        : close,
    );
    const events: ReturnEvent[] = [
      { eventType: "split", effectiveOn: splitOn, value: "10", currency: null },
    ];

    const adjusted = equityVolatility({
      subjectId: SUBJECT,
      asOf: AS_OF,
      closes,
      events: [],
    });
    const fromRaw = equityVolatility({
      subjectId: SUBJECT,
      asOf: AS_OF,
      closes: raw,
      events,
    });

    expect(fromRaw.status).toBe("computed");
    expect(
      Number(fromRaw.status === "computed" ? fromRaw.value : NaN),
    ).toBeCloseTo(
      Number(adjusted.status === "computed" ? adjusted.value : NaN),
      12,
    );
  });

  it("ignores dividends: Black-Scholes takes them as a yield", () => {
    const closes = series();
    const withDividends = equityVolatility({
      subjectId: SUBJECT,
      asOf: AS_OF,
      closes,
      events: [
        {
          eventType: "dividend",
          effectiveOn: "2025-03-03",
          value: "5",
          currency: "USD",
        },
      ],
    });
    const without = equityVolatility({
      subjectId: SUBJECT,
      asOf: AS_OF,
      closes,
      events: [],
    });

    expect(withDividends).toStrictEqual(without);
  });

  it("ignores everything after the as_of", () => {
    const closes = series();
    const later = [
      ...closes,
      { marketDate: "2026-07-01", close: "1", currency: "USD" },
    ];

    expect(
      equityVolatility({
        subjectId: SUBJECT,
        asOf: AS_OF,
        closes: later,
        events: [
          {
            eventType: "split",
            effectiveOn: "2026-07-01",
            value: "4",
            currency: null,
          },
        ],
      }),
    ).toStrictEqual(
      equityVolatility({ subjectId: SUBJECT, asOf: AS_OF, closes, events: [] }),
    );
  });

  it("is zero for a constant price, not null", () => {
    const flat = DATES.map((marketDate) => ({
      marketDate,
      close: "50",
      currency: "USD",
    }));
    const result = equityVolatility({
      subjectId: SUBJECT,
      asOf: AS_OF,
      closes: flat,
      events: [],
    });

    expect(result).toMatchObject({ status: "computed", value: "0" });
  });

  it("names why it cannot answer, never a shortened window", () => {
    const closes = series();

    expect(
      equityVolatility({
        subjectId: SUBJECT,
        asOf: AS_OF,
        closes: closes.filter((close) => close.marketDate >= "2022-01-03"),
        events: [],
      }),
    ).toMatchObject({ status: "null", reason: "insufficient_history" });
    expect(
      equityVolatility({
        subjectId: SUBJECT,
        asOf: "2026-07-01",
        closes,
        events: [],
      }),
    ).toMatchObject({ status: "null", reason: "no_close_at_as_of" });
    expect(
      equityVolatility({
        subjectId: SUBJECT,
        asOf: AS_OF,
        closes: closes.filter(
          (close) =>
            close.marketDate < "2024-02-01" || close.marketDate > "2024-02-12",
        ),
        events: [],
      }),
    ).toMatchObject({
      status: "null",
      reason: "missing_period",
      marketDate: "2024-02-13",
    });
    expect(
      equityVolatility({
        subjectId: SUBJECT,
        asOf: AS_OF,
        closes: closes.map((close, index) =>
          index === 100 ? { ...close, currency: "ARS" } : close,
        ),
        events: [],
      }),
    ).toMatchObject({ status: "null", reason: "currency_mismatch" });
  });
});
