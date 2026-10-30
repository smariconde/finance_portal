import { describe, expect, it } from "vitest";

import { requirementScale } from "./requirement-scale";

describe("requirementScale", () => {
  it("places every mark from zero with headroom on the right", () => {
    const scale = requirementScale({
      shown: "0.0868",
      model: "0.0665",
      required: "0.1798",
    });

    expect(scale.zero).toBe(0);
    expect(scale.required).toBeCloseTo(100 / 1.12, 6);
    expect(scale.shown).toBeLessThan(scale.required!);
    expect(scale.model).toBeLessThan(scale.shown!);
  });

  it("moves zero inside the bar when a value is negative", () => {
    const scale = requirementScale({
      shown: "-0.05",
      model: "0.02",
      required: "0.10",
    });

    expect(scale.shown).toBe(0);
    expect(scale.zero).toBeGreaterThan(0);
    expect(scale.zero).toBeLessThan(scale.model!);
  });

  it("keeps a missing mark missing, never at zero", () => {
    const scale = requirementScale({
      shown: null,
      model: "0.0975",
      required: "0.0645",
    });

    expect(scale.shown).toBeNull();
    expect(scale.model).toBeCloseTo(100 / 1.12, 6);
  });

  it("collapses to the origin when every value is zero or missing", () => {
    expect(
      requirementScale({ shown: "0", model: null, required: "0" }),
    ).toEqual({ shown: 0, model: null, required: 0, zero: 0 });
  });

  it("ignores a value that is not a finite number", () => {
    expect(
      requirementScale({ shown: "NaN", model: "0.1", required: null }).shown,
    ).toBeNull();
  });
});
