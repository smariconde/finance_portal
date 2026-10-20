import { describe, expect, it } from "vitest";

import {
  adjustForFailure,
  DISTRESS_PROCEEDS_FRACTION,
  FAILURE_ADJUSTMENT_VERSION,
} from "./failure-adjustment";
import { isValuationPolicyError } from "./valuation-error";

describe("adjustForFailure", () => {
  it("weights the going concern and the distress proceeds by the probability", () => {
    // 1.000 × 0,9 + (0,5 × 400) × 0,1 = 920
    expect(
      adjustForFailure({
        goingConcernValue: "1000",
        probability: "0.1",
        bookCapital: "400",
      }),
    ).toStrictEqual({
      version: FAILURE_ADJUSTMENT_VERSION,
      probability: "0.1",
      proceedsFraction: DISTRESS_PROCEEDS_FRACTION,
      proceedsBasis: "book_capital",
      proceeds: "200",
      goingConcernValue: "1000",
      adjustedOperatingValue: "920",
    });
  });

  it("leaves the going concern untouched with a zero probability", () => {
    expect(
      adjustForFailure({
        goingConcernValue: "1000",
        probability: "0",
        bookCapital: "400",
      }).adjustedOperatingValue,
    ).toBe("1000");
  });

  it("is the proceeds alone with a certain failure", () => {
    expect(
      adjustForFailure({
        goingConcernValue: "1000",
        probability: "1",
        bookCapital: "400",
      }).adjustedOperatingValue,
    ).toBe("200");
  });

  it("names a non-positive book capital instead of recovering a negative", () => {
    expect(
      adjustForFailure({
        goingConcernValue: "1000",
        probability: "0.2",
        bookCapital: "-300",
      }),
    ).toMatchObject({
      proceedsBasis: "non_positive_book_capital",
      proceeds: "0",
      adjustedOperatingValue: "800",
    });
  });

  it("can raise the value when the proceeds exceed the going concern", () => {
    // Un DCF negativo con capital en libros: el recupero lo compensa en parte.
    expect(
      adjustForFailure({
        goingConcernValue: "-100",
        probability: "0.5",
        bookCapital: "400",
      }).adjustedOperatingValue,
    ).toBe("50");
  });

  it("rejects a probability outside zero and one", () => {
    for (const probability of ["-0.01", "1.01"]) {
      try {
        adjustForFailure({
          goingConcernValue: "1000",
          probability,
          bookCapital: "400",
        });
      } catch (error) {
        expect(isValuationPolicyError(error) && error.subjects).toStrictEqual([
          "failure.probability",
        ]);
        continue;
      }

      throw new Error("expected a rejection");
    }
  });
});
