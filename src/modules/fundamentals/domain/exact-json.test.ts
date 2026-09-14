import { describe, expect, it } from "vitest";

import {
  canonicalDecimalFromJsonNumber,
  ExactJsonNumber,
  parseJsonWithExactNumbers,
} from "./exact-json";

describe("parseJsonWithExactNumbers", () => {
  it("keeps the source text of a value a double would have rounded", () => {
    const parsed = parseJsonWithExactNumbers(
      '{"val": 12345678901234567890, "fy": 2024}',
      new Set(["val"]),
    ) as { val: ExactJsonNumber; fy: number };

    expect(parsed.val).toBeInstanceOf(ExactJsonNumber);
    expect(parsed.val.source).toBe("12345678901234567890");
    // Lo que no se pidió exacto sigue siendo un número.
    expect(parsed.fy).toBe(2024);
  });

  it("does not confuse a string that looks like a number with a number", () => {
    const parsed = parseJsonWithExactNumbers(
      '{"val": "39572000000"}',
      new Set(["val"]),
    ) as { val: unknown };

    expect(parsed.val).toBe("39572000000");
  });

  it("throws on text that is not JSON", () => {
    expect(() => parseJsonWithExactNumbers("{val:", new Set(["val"]))).toThrow(
      SyntaxError,
    );
  });
});

describe("canonicalDecimalFromJsonNumber", () => {
  it.each([
    ["39572000000", "39572000000"],
    ["-4200000", "-4200000"],
    ["6.10", "6.1"],
    ["0.000", "0"],
    ["-0", "0"],
    ["-0.0", "0"],
    ["1.5E-7", "0.00000015"],
    ["12e2", "1200"],
    ["1.25E+1", "12.5"],
    ["0.5", "0.5"],
    ["-0.05", "-0.05"],
    ["12345678901234567890", "12345678901234567890"],
  ])("writes %s as %s", (source, expected) => {
    expect(canonicalDecimalFromJsonNumber(source)).toBe(expected);
  });

  it.each(["", "01", "1.", ".5", "+1", "NaN", "Infinity", "1e999", "0x10"])(
    "refuses %j",
    (source) => {
      expect(canonicalDecimalFromJsonNumber(source)).toBeNull();
    },
  );
});
