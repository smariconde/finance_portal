import { describe, expect, it } from "vitest";

import {
  assessNonRecurringCharge,
  NON_RECURRING_CHARGE_VERSION,
  type ChargeYear,
} from "./non-recurring-charges";

const ENDS = [
  "2025-12-31",
  "2024-12-31",
  "2023-12-31",
  "2022-12-31",
  "2021-12-31",
  "2020-12-31",
];

/** Del ejercicio base hacia atrás; `null` es una etiqueta ausente. */
function years(
  charges: readonly (string | null)[],
  concept = "us-gaap:AssetImpairmentCharges",
): ChargeYear[] {
  return charges.map((value, index) => ({
    fiscalYearEnd: ENDS[index]!,
    covered: true,
    charge: value === null ? null : { value, concept },
  }));
}

describe("non-recurring-charge-1.0.0", () => {
  it("reverses a charge the four previous years did not have (Ford 2025)", () => {
    expect(
      assessNonRecurringCharge(
        "impairment",
        years(["9435", "0", "0", null, null]),
      ),
    ).toStrictEqual({
      version: NON_RECURRING_CHARGE_VERSION,
      category: "impairment",
      status: "applied",
      concept: "us-gaap:AssetImpairmentCharges",
      charge: "9435",
      ebitAdjustment: "9435",
    });
  });

  it("treats a charge that comes back as a cost of the business (Salesforce)", () => {
    expect(
      assessNonRecurringCharge(
        "restructuring",
        years(
          ["586", "461", "988", "828", "0"],
          "us-gaap:RestructuringCharges",
        ),
      ),
    ).toMatchObject({
      status: "not_applied",
      reason: "recurring",
      recurringIn: ["2024-12-31", "2023-12-31", "2022-12-31"],
    });
  });

  it("reads one prior charge as enough to make it recurring", () => {
    expect(
      assessNonRecurringCharge(
        "impairment",
        years(["1300", null, null, "1100", null]),
      ),
    ).toMatchObject({ reason: "recurring", recurringIn: ["2022-12-31"] });
  });

  it("looks back four years and no further", () => {
    expect(
      assessNonRecurringCharge(
        "impairment",
        years(["500", "0", "0", "0", "0", "900"]),
      ),
    ).toMatchObject({ status: "applied", ebitAdjustment: "500" });
  });

  it("catches an accumulated amount mislabeled as the charge (Norwegian)", () => {
    expect(
      assessNonRecurringCharge(
        "impairment",
        years(
          ["1291", "1291", "1291", "1291", "0"],
          "us-gaap:GoodwillImpairmentLoss",
        ),
      ),
    ).toMatchObject({ reason: "recurring" });
  });

  it("reverses a non-recurring recovery with its sign, lowering EBIT", () => {
    expect(
      assessNonRecurringCharge(
        "restructuring",
        years(["-28", null, null, null, null], "us-gaap:RestructuringCharges"),
      ),
    ).toMatchObject({ status: "applied", ebitAdjustment: "-28" });
  });

  it("does not adjust what is absent or zero", () => {
    expect(
      assessNonRecurringCharge(
        "restructuring",
        years([null, "10", "0", "0", "0"]),
      ),
    ).toMatchObject({ status: "not_applied", reason: "not_reported" });
    expect(
      assessNonRecurringCharge(
        "restructuring",
        years(["0", "10", "0", "0", "0"]),
      ),
    ).toMatchObject({ status: "not_applied", reason: "zero_charge" });
    expect(assessNonRecurringCharge("restructuring", [])).toMatchObject({
      reason: "not_reported",
    });
  });

  it("needs four previous years in the series, all covered", () => {
    expect(
      assessNonRecurringCharge("impairment", years(["50", "0", "0", "0"])),
    ).toMatchObject({ reason: "insufficient_history" });

    const gap = years(["50", null, null, null, null]);
    gap[2] = { ...gap[2]!, covered: false };

    // Un año sin estado de resultados no prueba que no hubo cargo.
    expect(assessNonRecurringCharge("impairment", gap)).toMatchObject({
      reason: "insufficient_history",
    });
  });
});
