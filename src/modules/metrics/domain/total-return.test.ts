import { describe, expect, it } from "vitest";

import { MetricInputError } from "./metric-input-error";
import {
  TOTAL_RETURN_FORMULA_VERSION,
  totalReturns,
  type ReturnEvent,
} from "./total-return";

const SUBJECT = "11111111-1111-4111-8111-111111111111";

const close = (marketDate: string, value: string, currency = "USD") => ({
  marketDate,
  close: value,
  currency,
});

const dividend = (
  effectiveOn: string,
  value: string,
  currency = "USD",
): ReturnEvent => ({ eventType: "dividend", effectiveOn, value, currency });

const split = (effectiveOn: string, value: string): ReturnEvent => ({
  eventType: "split",
  effectiveOn,
  value,
  currency: null,
});

function computed(result: ReturnType<typeof totalReturns>) {
  if (result.status !== "computed") {
    throw new Error(`expected returns, got ${result.reason}`);
  }

  return result.returns.map((entry) => [entry.marketDate, entry.value]);
}

describe("totalReturns", () => {
  it("is the price change when nothing happened in between", () => {
    expect(
      computed(
        totalReturns(
          [close("2024-01-02", "100"), close("2024-01-03", "101.5")],
          [],
          SUBJECT,
        ),
      ),
    ).toEqual([["2024-01-03", "0.015"]]);
  });

  it("reinvests the dividend at the close of its ex-date", () => {
    // Cae 1 y paga 2: quien reinvierte gana un 1 %, no pierde un 1 %.
    expect(
      computed(
        totalReturns(
          [close("2024-02-08", "100"), close("2024-02-09", "99")],
          [dividend("2024-02-09", "2")],
          SUBJECT,
        ),
      ),
    ).toEqual([["2024-02-09", "0.01"]]);
  });

  it("carries a split into the holding, so the split day is not a -90 % day", () => {
    // Cierres crudos reales de NVDA alrededor de su 10:1.
    const [[, value]] = computed(
      totalReturns(
        [close("2024-06-07", "1208.88"), close("2024-06-10", "121.79")],
        [split("2024-06-10", "10")],
        SUBJECT,
      ),
    ) as [[string, string]];

    expect(Number(value)).toBeCloseTo(1217.9 / 1208.88 - 1, 15);
  });

  it("pays a dividend on the split day on the new shares", () => {
    // `price-unadjust-1.1.0`: ese dividendo ya está en la base nueva, así que
    // quien tenía una acción cobra diez veces el importe.
    expect(
      computed(
        totalReturns(
          [close("2024-06-07", "100"), close("2024-06-10", "10")],
          [dividend("2024-06-10", "0.1"), split("2024-06-10", "10")],
          SUBJECT,
        ),
      ),
    ).toEqual([["2024-06-10", "0.01"]]);
  });

  it("brings an event dated on a day without a close into the next close", () => {
    expect(
      computed(
        totalReturns(
          [close("2024-07-03", "100"), close("2024-07-05", "99")],
          [dividend("2024-07-04", "1")],
          SUBJECT,
        ),
      ),
    ).toEqual([["2024-07-05", "0"]]);
  });

  it("leaves out events before the base and after the last close", () => {
    expect(
      computed(
        totalReturns(
          [close("2024-01-02", "100"), close("2024-01-03", "100")],
          [
            dividend("2024-01-02", "5"),
            split("2023-12-29", "2"),
            dividend("2024-01-04", "5"),
          ],
          SUBJECT,
        ),
      ),
    ).toEqual([["2024-01-03", "0"]]);
  });

  it("keeps negative returns as they are", () => {
    expect(
      computed(
        totalReturns(
          [close("2024-01-02", "100"), close("2024-01-03", "80")],
          [],
          SUBJECT,
        ),
      ),
    ).toEqual([["2024-01-03", "-0.2"]]);
  });

  it("sorts its input instead of trusting it", () => {
    expect(
      computed(
        totalReturns(
          [close("2024-01-03", "110"), close("2024-01-02", "100")],
          [],
          SUBJECT,
        ),
      ),
    ).toEqual([["2024-01-03", "0.1"]]);
  });

  it("names a dividend in another currency instead of adding it", () => {
    expect(
      totalReturns(
        [close("2024-01-02", "100"), close("2024-01-03", "100")],
        [dividend("2024-01-03", "1", "EUR")],
        SUBJECT,
      ),
    ).toEqual({
      status: "unavailable",
      reason: "currency_mismatch",
      marketDate: "2024-01-03",
    });
  });

  it("names a series that changes currency", () => {
    expect(
      totalReturns(
        [close("2024-01-02", "100"), close("2024-01-03", "100", "EUR")],
        [],
        SUBJECT,
      ),
    ).toMatchObject({ status: "unavailable", reason: "currency_mismatch" });
  });

  it("names a zero close instead of dividing by it", () => {
    expect(
      totalReturns(
        [close("2024-01-02", "0"), close("2024-01-03", "1")],
        [],
        SUBJECT,
      ),
    ).toEqual({
      status: "unavailable",
      reason: "non_positive_close",
      marketDate: "2024-01-02",
    });
  });

  it("returns no periods for a single close", () => {
    expect(
      computed(totalReturns([close("2024-01-02", "100")], [], SUBJECT)),
    ).toEqual([]);
  });

  it("refuses two closes for the same day", () => {
    expect(() =>
      totalReturns(
        [close("2024-01-02", "100"), close("2024-01-02", "101")],
        [],
        SUBJECT,
      ),
    ).toThrow(MetricInputError);
  });

  it("refuses a non-positive split ratio and a non-canonical number", () => {
    expect(() =>
      totalReturns(
        [close("2024-01-02", "100"), close("2024-01-03", "100")],
        [split("2024-01-03", "0")],
        SUBJECT,
      ),
    ).toThrow(MetricInputError);
    expect(() =>
      totalReturns(
        [close("2024-01-02", "100"), close("2024-01-03", "Infinity")],
        [],
        SUBJECT,
      ),
    ).toThrow(MetricInputError);
  });

  it("declares its formula version", () => {
    expect(TOTAL_RETURN_FORMULA_VERSION).toBe("total-return-1.0.0");
  });
});
