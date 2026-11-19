import { describe, expect, it } from "vitest";

import { candlePriceScale, candleVolumeDomain } from "./candle-scale";

describe("escala de velas", () => {
  it("ajusta el precio a los datos y lo deja sobre la franja de volumen", () => {
    const { domain, ticks, price } = candlePriceScale([25.2, 34.8]);
    expect(price[0]).toBeLessThan(25.2);
    expect(price[0]).toBeGreaterThan(24);
    expect(price[1]).toBeGreaterThan(34.8);
    expect(price[1]).toBeLessThan(36);
    expect(domain[1]).toBe(price[1]);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(price[0]);
      expect(tick).toBeLessThanOrEqual(price[1]);
    }
    // El precio ocupa el 80 % de arriba.
    expect((price[0] - domain[0]) / (domain[1] - domain[0])).toBeCloseTo(0.2);
  });

  it("no rompe con un solo precio ni sin precios", () => {
    const flat = candlePriceScale([10, 10]);
    expect(flat.price[0]).toBeLessThan(10);
    expect(flat.price[1]).toBeGreaterThan(10);
    expect(candlePriceScale([])).toEqual({
      domain: [0, 1],
      ticks: [],
      price: [0, 1],
    });
  });

  it("hace que la barra más alta llene casi toda su franja", () => {
    const [, max] = candleVolumeDomain([100, 400]);
    expect(400 / max).toBeCloseTo(0.17);
    expect(candleVolumeDomain([])).toEqual([0, 1 / 0.17]);
  });
});
