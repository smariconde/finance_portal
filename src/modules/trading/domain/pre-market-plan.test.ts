import { describe, expect, it } from "vitest";

import { ideaFormSchema, ideaLevels, purchaseTotal } from "./pre-market-plan";

const base = {
  entry: "100",
  quantity: "50",
  manualStop: "95",
  manualTarget: "110",
  stopMode: "automatic" as const,
  targetMode: "one_to_two" as const,
  liquidationValue: "10000",
  riskPercent: "2",
};

describe("Stop Loss Calc. y targets", () => {
  it("arriesga exactamente 2 % del capital con la cantidad elegida", () => {
    expect(ideaLevels(base)).toEqual({
      state: "valid",
      stop: "96",
      target: "108",
      chosenRisk: "200",
      autoStop: "96",
      targetTwo: "108",
      targetThree: "112",
      riskPerShare: "4",
      chosenValue: "5000",
      chosenPercent: "50",
      chosenRiskPercent: "2",
      targetR: "2",
    });
  });

  it("el monto de la compra y su peso no dependen del stop", () => {
    // El stop manual cambia el riesgo y el target, no lo que se paga.
    expect(
      ideaLevels({ ...base, stopMode: "manual", targetMode: "manual" }),
    ).toMatchObject({
      chosenValue: "5000",
      chosenPercent: "50",
      riskPerShare: "5",
      chosenRisk: "250",
      chosenRiskPercent: "2.5",
      targetR: "2",
    });
    // Un target manual mide su propia distancia en R.
    expect(
      ideaLevels({ ...base, targetMode: "manual", manualTarget: "120" }),
    ).toMatchObject({ target: "120", targetR: "5" });
  });

  it("una cantidad mayor compra más y no cambia el porcentaje de riesgo automático", () => {
    expect(ideaLevels({ ...base, quantity: "75" })).toMatchObject({
      chosenValue: "7500",
      chosenPercent: "75",
      riskPerShare: "2.666666",
      chosenRisk: "199.99995",
      chosenRiskPercent: "1.9999995",
      targetR: "2",
    });
  });

  it("redondea el stop hacia arriba para no exceder el presupuesto", () => {
    expect(ideaLevels({ ...base, quantity: "75" })).toMatchObject({
      state: "valid",
      stop: "97.333334",
      chosenRisk: "199.99995",
      targetTwo: "105.333332",
    });
  });

  it("el stop manual mueve los TP y el target manual se conserva", () => {
    expect(
      ideaLevels({ ...base, stopMode: "manual", targetMode: "manual" }),
    ).toMatchObject({
      state: "valid",
      stop: "95",
      target: "110",
      targetTwo: "110",
      targetThree: "115",
    });
  });

  it("nombra capital ausente, stop a cero y niveles del lado incorrecto", () => {
    expect(ideaLevels({ ...base, liquidationValue: "0" })).toEqual({
      state: "invalid",
      reason: "no_equity",
    });
    expect(ideaLevels({ ...base, liquidationValue: "1000000" })).toEqual({
      state: "invalid",
      reason: "auto_stop_non_positive",
    });
    expect(
      ideaLevels({ ...base, stopMode: "manual", manualStop: "100" }),
    ).toEqual({ state: "invalid", reason: "stop_on_wrong_side" });
    expect(
      ideaLevels({ ...base, targetMode: "manual", manualTarget: "99" }),
    ).toEqual({ state: "invalid", reason: "target_on_wrong_side" });
  });

  it("rechaza cantidad fraccionaria, cero, negativo, no finito o nulo en la frontera", () => {
    const form = {
      ideaId: null,
      baseRevision: null,
      symbol: "AAPL",
      setupCode: null,
      entry: "100",
      quantity: "50",
      manualStop: "",
      manualTarget: "",
      stopMode: "automatic",
      targetMode: "one_to_two",
      notes: "",
      status: "active",
    };
    for (const quantity of ["1.5", "0", "-1", "Infinity", null])
      expect(ideaFormSchema.safeParse({ ...form, quantity }).success).toBe(
        false,
      );
    expect(
      ideaFormSchema.safeParse({ ...form, symbol: "<script>" }).success,
    ).toBe(false);
  });

  it("la fórmula no convierte null, negativos ni no finitos en cero", () => {
    for (const entry of ["Infinity", "NaN", null]) {
      expect(() => ideaLevels({ ...base, entry: entry as string })).toThrow();
    }
    for (const quantity of ["Infinity", null]) {
      expect(() =>
        ideaLevels({ ...base, quantity: quantity as string }),
      ).toThrow();
    }
    for (const entry of ["0", "-100"])
      expect(ideaLevels({ ...base, entry })).toEqual({
        state: "invalid",
        reason: "non_positive_input",
      });
    for (const quantity of ["0", "-1"])
      expect(ideaLevels({ ...base, quantity })).toEqual({
        state: "invalid",
        reason: "non_positive_input",
      });
  });
});

describe("monto de la compra de la watchlist", () => {
  it("suma entrada por cantidad y no redondea a número", () => {
    expect(purchaseTotal([])).toBe("0");
    expect(
      purchaseTotal([
        { entry: "100", quantity: "50" },
        { entry: "12.34", quantity: "3" },
      ]),
    ).toBe("5037.02");
    expect(purchaseTotal([{ entry: "0.1", quantity: "3" }])).toBe("0.3");
  });

  it("falla ante una entrada que no es un decimal", () => {
    expect(() => purchaseTotal([{ entry: "NaN", quantity: "3" }])).toThrow();
  });
});
