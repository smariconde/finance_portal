import { describe, expect, it } from "vitest";

import {
  assessFiscalPriceHistory,
  fiscalPriceHistoryStart,
} from "./fiscal-price-history";

const base = {
  fiscalYearEnd: "2020-12-31",
  maxLagDays: 7,
  priceFound: false,
  requestedFrom: null,
  today: "2026-10-30",
};

describe("fiscal-price-history-1.0.0", () => {
  it("siete años y dos semanas antes de hoy", () => {
    expect(fiscalPriceHistoryStart("2026-10-30")).toBe("2019-10-16");
    // Un 29 de febrero cae al 28 del año sin bisiesto.
    expect(fiscalPriceHistoryStart("2028-02-29")).toBe("2021-02-14");
  });

  it("con el precio a la vista no pide nada", () => {
    expect(assessFiscalPriceHistory({ ...base, priceFound: true })).toEqual({
      status: "covered",
    });
  });

  it("sin corrida anclada pide desde el cierre menos la tolerancia", () => {
    expect(assessFiscalPriceHistory(base)).toEqual({
      status: "needed",
      from: "2020-12-24",
    });
  });

  it("una corrida de cinco años no cuenta como pedida tan atrás", () => {
    expect(
      assessFiscalPriceHistory({ ...base, requestedFrom: "2021-10-16" }),
    ).toEqual({ status: "needed", from: "2020-12-24" });
  });

  it("ya pedida desde antes: la fuente no lo tiene y no se repite", () => {
    for (const requestedFrom of ["2019-10-16", "2020-12-24"]) {
      expect(assessFiscalPriceHistory({ ...base, requestedFrom })).toEqual({
        status: "already_requested",
        from: "2020-12-24",
      });
    }
  });

  it("un cierre que siete años no alcanzan no se pide", () => {
    expect(
      assessFiscalPriceHistory({ ...base, fiscalYearEnd: "2019-10-20" }),
    ).toEqual({ status: "beyond_history_window", from: "2019-10-13" });
  });
});
