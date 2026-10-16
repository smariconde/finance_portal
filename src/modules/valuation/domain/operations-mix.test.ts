import { describe, expect, it } from "vitest";

import {
  lineRecordsOf,
  operationsMixDeclarationSchema,
  weightsOfDeclaration,
  weightsOfProposal,
} from "./operations-mix";

const LINES = lineRecordsOf([
  {
    label: "United States",
    amount: "$ 300",
    quote: "United States $ 300",
    evidenceId: "E1",
    basis: "name_match",
    exposureKeys: ["united-states"],
    definitionQuote: null,
  },
  {
    label: "Americas",
    amount: "100",
    quote: "Americas 100",
    evidenceId: "E1",
    basis: "name_match",
    exposureKeys: ["north-america", "central-and-south-america", "caribbean"],
    definitionQuote: null,
  },
  {
    label: "Hedging gains (losses)",
    amount: "(4)",
    quote: "Hedging (4)",
    evidenceId: "E1",
    basis: "unallocated",
    exposureKeys: [],
    definitionQuote: null,
  },
  {
    label: "Other",
    amount: "100",
    quote: "Other 100",
    evidenceId: "E1",
    basis: "rest_of_world",
    exposureKeys: [],
    definitionQuote: null,
  },
]);

describe("operations-mix-weights-1.0.0", () => {
  it("keeps the printed amount and the exact one it read", () => {
    expect(LINES[2]).toMatchObject({
      ordinal: 3,
      printedAmount: "(4)",
      amount: "-4",
    });
  });

  it("weights each geographic line over the geographic total, leaving reconciling items out", () => {
    expect(weightsOfProposal(LINES)).toEqual([
      { exposureKeys: ["united-states"], basis: "name_match", weight: "0.6" },
      {
        exposureKeys: [
          "north-america",
          "central-and-south-america",
          "caribbean",
        ],
        basis: "name_match",
        weight: "0.2",
      },
      { exposureKeys: [], basis: "rest_of_world", weight: "0.2" },
    ]);
  });

  it("refuses a proposal with no positive geographic revenue", () => {
    expect(() => weightsOfProposal([LINES[2]!])).toThrow();
  });
});

describe("owner declaration", () => {
  const DECLARED = {
    cik: "0000320193",
    exposures: [
      { exposureKeys: ["united-states"], weight: "0.43" },
      { exposureKeys: ["western-europe"], weight: "0.27" },
      { exposureKeys: ["china", "hong-kong", "taiwan"], weight: "0.3" },
    ],
    rationale: "Read from the 10-K segment note by the owner.",
    declaredOn: "2026-10-16",
  };

  it("accepts exact fractions that add up to one and keeps them as written", () => {
    const declaration = operationsMixDeclarationSchema.parse(DECLARED);

    expect(
      weightsOfDeclaration(declaration).map((item) => item.weight),
    ).toEqual(["0.43", "0.27", "0.3"]);
  });

  it.each([
    [
      "weights that do not add up to one",
      [{ exposureKeys: ["china"], weight: "0.9" }],
    ],
    [
      "a zero weight",
      [
        { exposureKeys: ["china"], weight: "1" },
        { exposureKeys: ["japan"], weight: "0" },
      ],
    ],
  ])("refuses %s", (_, exposures) => {
    expect(
      operationsMixDeclarationSchema.safeParse({ ...DECLARED, exposures })
        .success,
    ).toBe(false);
  });
});
