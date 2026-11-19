import { describe, expect, it } from "vitest";
import { candleWindowLayout } from "./candle-window-layout";

describe("ventana de velas", () => {
  it("sostiene el ancho mínimo en teléfono sin perder el índice global", () => {
    const view = candleWindowLayout(390, 200, 0, 390, 70);
    expect(view).toEqual({
      index: 200,
      start: 169,
      end: 201,
      size: 32,
      maxStart: 358,
    });
  });
  it("mantiene la selección al pasar de escritorio a teléfono", () => {
    const desktop = candleWindowLayout(390, 180, 140, 1440, 70);
    const mobile = candleWindowLayout(
      390,
      desktop.index,
      desktop.start,
      390,
      70,
    );
    expect(mobile.index).toBe(180);
    expect(mobile.start).toBeLessThanOrEqual(180);
    expect(mobile.end).toBeGreaterThan(180);
  });
  it("permite llegar a ambos extremos de cuarenta mil velas sin dibujarlas juntas", () => {
    const first = candleWindowLayout(40_000, 0, 39_999, 720, 70);
    const last = candleWindowLayout(40_000, 39_999, 0, 720, 70);
    expect(first.start).toBe(0);
    expect(last.end).toBe(40_000);
    expect(last.size).toBe(65);
  });
  it.each([0, 1, 8])("no inventa filas si sólo hay %i", (count) => {
    const view = candleWindowLayout(count, 100, -1, 390, 70);
    expect(view.size).toBe(count);
    expect(view.start).toBe(0);
    expect(view.end).toBe(count);
  });
  it("un ancho aún no medido o menor que los ejes mantiene índices válidos", () => {
    expect(candleWindowLayout(100, 10, 0, 0, 70).size).toBe(65);
    expect(candleWindowLayout(100, -20, 0, 30, 70)).toEqual({
      index: 0,
      start: 0,
      end: 1,
      size: 1,
      maxStart: 99,
    });
  });
  it("acerca y aleja sin perder la vela elegida", () => {
    const near = candleWindowLayout(390, 200, 0, 720, 70, 26);
    const far = candleWindowLayout(390, 200, 0, 720, 70, 6);
    expect(near.size).toBe(25);
    expect(far.size).toBe(108);
    for (const view of [near, far]) {
      expect(view.start).toBeLessThanOrEqual(200);
      expect(view.end).toBeGreaterThan(200);
    }
  });
});
