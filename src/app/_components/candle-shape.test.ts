import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandleShape } from "./candle-shape";
import { CandleDirection } from "./candle-direction";

describe("geometría OHLC", () => {
  it.each([
    { open: 12, close: 17, direction: "up" },
    { open: 17, close: 12, direction: "down" },
  ])(
    "rellena el cuerpo $direction sin mover máximo ni mínimo",
    ({ open, close, direction }) => {
      const markup = renderToStaticMarkup(
        createElement(CandleShape, {
          x: 10,
          y: 20,
          width: 8,
          height: 100,
          payload: { range: [10, 20], open, close },
        }),
      );
      expect(markup).toContain(`data-candle-direction="${direction}"`);
      expect(markup).toContain('x1="14" x2="14" y1="20" y2="120"');
      expect(markup).toContain('<rect x="10" y="50" width="8" height="50"');
      expect(markup).toContain('fill="currentColor"');
    },
  );
  it("conserva las proporciones con valores negativos", () => {
    const markup = renderToStaticMarkup(
      createElement(CandleShape, {
        y: 20,
        width: 8,
        height: 100,
        payload: { range: [-20, -10], open: -18, close: -13 },
      }),
    );
    expect(markup).toContain('y="50" width="8" height="50"');
    expect(markup).not.toMatch(/NaN|Infinity/);
  });
  it("un doji sin rango, incluso en cero, es un trazo y nunca un cuerpo inventado", () => {
    const markup = renderToStaticMarkup(
      createElement(CandleShape, {
        y: 20,
        width: 8,
        height: 0,
        payload: { range: [0, 0], open: 0, close: 0 },
      }),
    );
    expect(markup).toContain('data-candle-direction="flat"');
    expect(markup).not.toContain("<rect");
    expect(markup).not.toMatch(/NaN|Infinity/);
  });
  it("no dibuja una fila ausente", () => {
    expect(renderToStaticMarkup(createElement(CandleShape, { width: 8 }))).toBe(
      "",
    );
  });
  it.each([
    [0, 1, "Alcista"],
    [1, 0, "Bajista"],
    [0, 0, "Sin cambio"],
  ])(
    "la dirección %s → %s se escribe sin depender del color",
    (open, close, label) => {
      expect(
        renderToStaticMarkup(
          createElement(CandleDirection, {
            open: Number(open),
            close: Number(close),
          }),
        ),
      ).toContain(label);
    },
  );
});
