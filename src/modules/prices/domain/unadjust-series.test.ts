import { describe, expect, it } from "vitest";

import {
  PriceUnadjustError,
  PRICE_UNADJUST_RULE_VERSION,
  unadjustSeries,
} from "./unadjust-series";

const NVDA = "11111111-1111-4111-8111-111111111111";

describe("unadjustSeries", () => {
  it("reproduces what NVDA actually traded at before its 10:1", () => {
    // Oráculo real, medido contra la fuente el 2026-09-22: la serie devuelve
    // 122,44 para el 2024-06-05 porque está dividida por el split del 10 de
    // junio. Ese día NVDA cerró a 1.224,40.
    const result = unadjustSeries(
      [
        { marketDate: "2024-06-05", close: "122.44" },
        { marketDate: "2024-06-07", close: "120.89" },
        { marketDate: "2024-06-10", close: "121.79" },
        { marketDate: "2024-06-11", close: "120.91" },
      ],
      [{ effectiveOn: "2024-06-10", ratio: "10" }],
      NVDA,
    );

    expect(result[0]).toEqual({
      marketDate: "2024-06-05",
      close: "1224.4",
      appliedFactor: "10",
    });
    expect(result[1]!.close).toBe("1208.9");
  });

  it("leaves the split day itself and everything after it untouched", () => {
    // La acción abre el día del split ya en la base nueva, así que un split con
    // fecha efectiva igual a la rueda no se aplica a esa rueda.
    const result = unadjustSeries(
      [
        { marketDate: "2024-06-10", close: "121.79" },
        { marketDate: "2024-06-11", close: "120.91" },
      ],
      [{ effectiveOn: "2024-06-10", ratio: "10" }],
      NVDA,
    );

    expect(result.map((bar) => bar.appliedFactor)).toEqual(["1", "1"]);
    expect(result.map((bar) => bar.close)).toEqual(["121.79", "120.91"]);
  });

  it("compounds two splits for a bar that precedes both", () => {
    const result = unadjustSeries(
      [
        { marketDate: "2021-01-04", close: "10" },
        { marketDate: "2022-01-04", close: "10" },
        { marketDate: "2023-01-04", close: "10" },
      ],
      [
        { effectiveOn: "2021-07-20", ratio: "4" },
        { effectiveOn: "2022-06-10", ratio: "10" },
      ],
      NVDA,
    );

    // Antes de los dos: ×40. Entre ambos: ×10. Después: ×1.
    expect(result.map((bar) => bar.appliedFactor)).toEqual(["40", "10", "1"]);
    expect(result.map((bar) => bar.close)).toEqual(["400", "100", "10"]);
  });

  it("handles a reverse split, where the raw price is lower", () => {
    // Un 1:8 tiene ratio 0,125: antes del evento la acción valía menos, no más.
    const result = unadjustSeries(
      [{ marketDate: "2023-01-04", close: "80" }],
      [{ effectiveOn: "2023-06-01", ratio: "0.125" }],
      NVDA,
    );

    expect(result[0]!.close).toBe("10");
  });

  it("returns the series untouched when there is no split", () => {
    const bars = [
      { marketDate: "2026-09-18", close: "245.5" },
      { marketDate: "2026-09-21", close: "247.1" },
    ];

    const result = unadjustSeries(bars, [], NVDA);

    expect(result.map((bar) => bar.close)).toEqual(["245.5", "247.1"]);
    expect(result.every((bar) => bar.appliedFactor === "1")).toBe(true);
  });

  it("does not lose precision through a float", () => {
    // Un precio que pasa por un `double` es un valor inventado. 0.1 × 3 tiene
    // que dar 0.3 exacto y no 0.30000000000000004.
    const result = unadjustSeries(
      [{ marketDate: "2024-01-02", close: "0.1" }],
      [{ effectiveOn: "2024-06-01", ratio: "3" }],
      NVDA,
    );

    expect(result[0]!.close).toBe("0.3");
  });

  it("refuses a non-positive split ratio instead of producing a zero price", () => {
    expect(() =>
      unadjustSeries(
        [{ marketDate: "2024-01-02", close: "10" }],
        [{ effectiveOn: "2024-06-01", ratio: "0" }],
        NVDA,
      ),
    ).toThrow(PriceUnadjustError);

    try {
      unadjustSeries(
        [{ marketDate: "2024-01-02", close: "10" }],
        [{ effectiveOn: "2024-06-01", ratio: "0" }],
        NVDA,
      );
    } catch (error) {
      expect((error as PriceUnadjustError).code).toBe("invalid_split_ratio");
    }
  });

  it("refuses two closes for the same market date", () => {
    try {
      unadjustSeries(
        [
          { marketDate: "2024-01-02", close: "10" },
          { marketDate: "2024-01-02", close: "11" },
        ],
        [],
        NVDA,
      );
      throw new Error("expected a duplicate_market_date rejection");
    } catch (error) {
      expect((error as PriceUnadjustError).code).toBe("duplicate_market_date");
    }
  });

  it("refuses a close that is not a canonical decimal", () => {
    expect(() =>
      unadjustSeries([{ marketDate: "2024-01-02", close: "1e5" }], [], NVDA),
    ).toThrow(PriceUnadjustError);
  });

  it("declares its rule version", () => {
    expect(PRICE_UNADJUST_RULE_VERSION).toBe("price-unadjust-1.0.0");
  });
});
