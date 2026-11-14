import { describe, expect, it } from "vitest";

import {
  DECLARED_SETUPS,
  isDeclaredSetup,
  ownSetupCodeOf,
  ownSetupLabelSchema,
  setupCatalog,
  setupCodeSchema,
} from "./trading-setups";

describe("trading-setups-1.0.0", () => {
  it("declares unique, well-formed codes", () => {
    const codes = DECLARED_SETUPS.map((setup) => setup.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(setupCodeSchema.safeParse(code).success, code).toBe(true);
      expect(code.startsWith("own-"), code).toBe(false);
    }
  });

  it("derives an own code that can never be a declared one", () => {
    expect(ownSetupCodeOf("Bandera alcista")).toBe("own-bandera-alcista");
    expect(ownSetupCodeOf("Rebote en EMA 9 (5m)")).toBe(
      "own-rebote-en-ema-9-5m",
    );
    expect(ownSetupCodeOf("Breakout")).toBe("own-breakout");
    expect(isDeclaredSetup("own-breakout")).toBe(false);
    expect(ownSetupCodeOf("¿¿??")).toBeNull();
  });

  it("cleans the label and refuses markup or control characters", () => {
    expect(ownSetupLabelSchema.parse("  Bandera   alcista ")).toBe(
      "Bandera alcista",
    );
    expect(ownSetupLabelSchema.safeParse("<b>x</b>").success).toBe(false);
    expect(ownSetupLabelSchema.safeParse("a").success).toBe(false);
    expect(ownSetupLabelSchema.safeParse("x".repeat(41)).success).toBe(false);
    expect(ownSetupLabelSchema.safeParse("ok‮evil").success).toBe(false);
  });

  it("lists declared setups first, then the owner's by name", () => {
    const catalog = setupCatalog([
      { code: "own-wedge", label: "Wedge" },
      { code: "own-bandera", label: "Bandera" },
    ]);
    expect(catalog.slice(0, DECLARED_SETUPS.length)).toEqual(DECLARED_SETUPS);
    expect(catalog.slice(DECLARED_SETUPS.length).map((s) => s.code)).toEqual([
      "own-bandera",
      "own-wedge",
    ]);
  });
});
