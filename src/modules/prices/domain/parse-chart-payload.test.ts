import { describe, expect, it } from "vitest";

import {
  FIXTURE_CHART_PAYLOAD,
  FIXTURE_CHART_PAYLOAD_UNKNOWN_SYMBOL,
  FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS,
} from "../infrastructure/fixture-chart-payload";

import { CHART_PARSER_VERSION, parseChartPayload } from "./parse-chart-payload";

function openingOfUtc(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T13:30:00.000Z`) / 1000);
}

function parsedOk(payload: unknown) {
  const result = parseChartPayload(payload);

  if (!result.ok) {
    throw new Error(`expected a parsed series, got ${result.code}`);
  }

  return result;
}

describe("parseChartPayload", () => {
  it("reads the series, its currency and its parser version", () => {
    const result = parsedOk(FIXTURE_CHART_PAYLOAD);

    expect(result.parserVersion).toBe(CHART_PARSER_VERSION);
    expect(result.currency).toBe("USD");
    expect(result.symbol).toBe("SYNTH");
  });

  it("dates each bar in the market's own timezone", () => {
    // El timestamp de una rueda es su apertura. Convertirlo en UTC sin el
    // desfase correría la fecha de cualquier mercado al oeste de Greenwich.
    const result = parsedOk(FIXTURE_CHART_PAYLOAD);

    expect(result.bars.map((bar) => bar.marketDate)).toEqual([
      "2024-06-05",
      "2024-06-06",
      "2024-06-10",
      "2024-06-11",
    ]);
  });

  it("drops a bar with no published close and counts it", () => {
    // Un hueco es un hueco: no se rellena con el cierre anterior ni con cero.
    const result = parsedOk(FIXTURE_CHART_PAYLOAD);

    expect(result.barsWithoutClose).toBe(1);
    expect(result.bars).toHaveLength(4);
    expect(result.bars.some((bar) => bar.marketDate === "2024-06-07")).toBe(
      false,
    );
  });

  it("turns a split into a decimal ratio dated in the market timezone", () => {
    const result = parsedOk(FIXTURE_CHART_PAYLOAD);

    expect(result.splits).toEqual([{ effectiveOn: "2024-06-10", ratio: "10" }]);
  });

  it("keeps dividends dated and unapplied", () => {
    // Aplicarlos acá decidiría la base de retorno de las matrices, que es un
    // parámetro abierto de `F7-04`.
    const result = parsedOk(FIXTURE_CHART_PAYLOAD);

    expect(result.dividends).toEqual([
      { effectiveOn: "2024-06-05", amount: "0.25" },
    ]);
    // El cierre del día del dividendo no cambia por el dividendo.
    expect(result.bars[0]!.close).toBe("100");
  });

  it("formats prices as canonical decimals, without float noise", () => {
    const result = parsedOk(FIXTURE_CHART_PAYLOAD);

    expect(result.bars.map((bar) => bar.close)).toEqual([
      "100",
      "102.5",
      "10.4",
      "10.55",
    ]);
  });

  it("recovers the quoted price from the source's float32 noise", () => {
    // La fuente transmite float32 ensanchado a double: 22,482 viaja como
    // 22.48200035095215 y 122,44 como 122.44000244140625. Guardar eso metería
    // ruido en la tabla más grande del proyecto, y un 10:1 lo multiplicaría
    // hasta 1.224,40002.
    const noisy = {
      chart: {
        result: [
          {
            meta: { currency: "USD", symbol: "X", gmtoffset: 0 },
            timestamp: [openingOfUtc("2024-01-02"), openingOfUtc("2024-01-03")],
            indicators: {
              quote: [{ close: [22.48200035095215, 122.44000244140625] }],
            },
            events: {
              dividends: {
                a: {
                  date: openingOfUtc("2024-01-02"),
                  amount: 0.004000000189989805,
                },
              },
            },
          },
        ],
        error: null,
      },
    };

    const result = parsedOk(noisy);

    expect(result.bars.map((bar) => bar.close)).toEqual(["22.482", "122.44"]);
    expect(result.dividends[0]!.amount).toBe("0.004");
  });

  it("reads a series with no events at all", () => {
    const result = parsedOk(FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS);

    expect(result.bars).toHaveLength(2);
    expect(result.splits).toEqual([]);
    expect(result.dividends).toEqual([]);
    expect(result.barsWithoutClose).toBe(0);
  });

  it("names the source's own error instead of returning an empty series", () => {
    const result = parseChartPayload(FIXTURE_CHART_PAYLOAD_UNKNOWN_SYMBOL);

    expect(result).toEqual({
      ok: false,
      parserVersion: CHART_PARSER_VERSION,
      code: "source_reported_error",
    });
  });

  it("rejects a body that is not the payload", () => {
    for (const body of [null, {}, { chart: {} }, "<html>", 42]) {
      const result = parseChartPayload(body);

      expect(result.ok).toBe(false);
    }
  });

  it("refuses to pair timestamps and closes of different lengths", () => {
    const broken = {
      chart: {
        result: [
          {
            meta: { currency: "USD", symbol: "X", gmtoffset: 0 },
            timestamp: [1, 2, 3],
            indicators: { quote: [{ close: [1, 2] }] },
          },
        ],
        error: null,
      },
    };

    expect(parseChartPayload(broken)).toMatchObject({
      ok: false,
      code: "series_length_mismatch",
    });
  });

  it("refuses a price without a currency", () => {
    const broken = {
      chart: {
        result: [
          {
            meta: { symbol: "X", gmtoffset: 0 },
            timestamp: [1],
            indicators: { quote: [{ close: [1] }] },
          },
        ],
        error: null,
      },
    };

    expect(parseChartPayload(broken)).toMatchObject({
      ok: false,
      code: "currency_missing",
    });
  });

  it("refuses a split whose ratio is not defined", () => {
    const broken = {
      chart: {
        result: [
          {
            meta: { currency: "USD", symbol: "X", gmtoffset: 0 },
            timestamp: [1],
            indicators: { quote: [{ close: [1] }] },
            events: {
              splits: { a: { date: 1, numerator: 1, denominator: 0 } },
            },
          },
        ],
        error: null,
      },
    };

    expect(parseChartPayload(broken)).toMatchObject({
      ok: false,
      code: "invalid_split",
    });
  });

  it("names an empty series instead of publishing nothing silently", () => {
    const broken = {
      chart: {
        result: [
          {
            meta: { currency: "USD", symbol: "X", gmtoffset: 0 },
            timestamp: [],
            indicators: { quote: [{ close: [] }] },
          },
        ],
        error: null,
      },
    };

    expect(parseChartPayload(broken)).toMatchObject({
      ok: false,
      code: "empty_series",
    });
  });

  it("does not leak the received value in a rejection", () => {
    const result = parseChartPayload({ secret: "do-not-echo-this" });

    expect(JSON.stringify(result)).not.toContain("do-not-echo-this");
  });
});
