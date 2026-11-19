import { describe, expect, it } from "vitest";

import { compareDecimalText, compareNullsLast, nextSort } from "./table-sort";

describe("nextSort", () => {
  it("flips the direction of the same column", () => {
    expect(
      nextSort({ key: "a", direction: "ascending" }, "a", "descending"),
    ).toEqual({ key: "a", direction: "descending" });
    expect(
      nextSort({ key: "a", direction: "descending" }, "a", "descending"),
    ).toEqual({ key: "a", direction: "ascending" });
  });

  it("starts another column in its declared direction", () => {
    expect(
      nextSort<"a" | "b">(
        { key: "a", direction: "ascending" },
        "b",
        "descending",
      ),
    ).toEqual({ key: "b", direction: "descending" });
  });
});

describe("compareNullsLast", () => {
  const values = ["2", null, "-1", "10", null, "0"];

  it("orders ascending and leaves missing values at the end", () => {
    expect(
      [...values].sort((l, r) =>
        compareNullsLast(l, r, "ascending", compareDecimalText),
      ),
    ).toEqual(["-1", "0", "2", "10", null, null]);
  });

  it("orders descending and still leaves missing values at the end", () => {
    expect(
      [...values].sort((l, r) =>
        compareNullsLast(l, r, "descending", compareDecimalText),
      ),
    ).toEqual(["10", "2", "0", "-1", null, null]);
  });

  it("never reads a zero as missing", () => {
    expect(
      compareNullsLast("0", null, "descending", compareDecimalText),
    ).toBeLessThan(0);
  });
});
