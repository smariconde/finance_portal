import { buildXlsx, type CellFixture } from "./fixture-xlsx";

/** Entirely synthetic probabilities; no Damodaran table is redistributed. */
export function failureRateRows(): CellFixture[][] {
  return [
    ["Default Probabilities over time (1 - 10 year time horizons)"],
    ["Rating", ...Array.from({ length: 10 }, (_, i) => ({ n: String(i + 1) }))],
    ...["AAA", "AA", "A", "BBB", "BB", "B", "CCC/C"].map((rating, index) => [
      rating,
      ...Array.from({ length: 10 }, (_, year) => ({
        n: String(((index + 1) * (year + 1)) / 1000),
      })),
    ]),
    [],
    ["Approach 2: Using corporate age"],
    ["This unrelated table must never be read", { n: "999" }],
  ];
}
export function fixtureFailureRates(rows = failureRateRows()): Uint8Array {
  return buildXlsx([{ name: "Failure Rate worksheet", rows }]);
}
