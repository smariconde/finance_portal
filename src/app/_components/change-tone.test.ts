import { describe, expect, it } from "vitest";

import { changeTone, decimalSign } from "./change-tone";

describe("decimalSign", () => {
  it("lee el signo de un decimal en texto", () => {
    expect(decimalSign("1.5")).toBe(1);
    expect(decimalSign("+0.01")).toBe(1);
    expect(decimalSign("-0.2")).toBe(-1);
  });

  it("trata cualquier cero como cero", () => {
    for (const zero of ["0", "-0", "0.000", "+0", "-0.0", ".0"]) {
      expect(decimalSign(zero)).toBe(0);
    }
  });
});

describe("changeTone", () => {
  it("pinta de favorable la suba de una métrica que mejora al subir", () => {
    expect(changeTone("0.4", "higher_is_better")).toBe("favorable");
    expect(changeTone("-0.4", "higher_is_better")).toBe("unfavorable");
  });

  it("invierte el sentido cuando subir es peor", () => {
    expect(changeTone("0.4", "lower_is_better")).toBe("unfavorable");
    expect(changeTone("-0.4", "lower_is_better")).toBe("favorable");
  });

  it("no colorea una métrica neutral ni un cambio nulo", () => {
    expect(changeTone("3", "neutral")).toBe("neutral");
    expect(changeTone("0", "higher_is_better")).toBe("flat");
    expect(changeTone("-0.00", "lower_is_better")).toBe("flat");
  });
});
