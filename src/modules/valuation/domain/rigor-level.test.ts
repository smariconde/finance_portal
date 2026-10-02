import { describe, expect, it } from "vitest";

import {
  completenessCheckIds,
  COMPLETENESS_PROFILE_VERSION,
  type CompletenessCheckId,
  type CompletenessProfile,
  type CompletenessStatus,
} from "./completeness-profile";
import {
  METHOD_SELECTION_VERSION,
  type MethodSelection,
} from "./method-selection";
import { deriveRigorLevel, RIGOR_LEVEL_VERSION } from "./rigor-level";

const SELECTED: MethodSelection = {
  version: METHOD_SELECTION_VERSION,
  status: "selected",
  assetProfile: "non_financial_mature",
  recommendedMethod: "fcff_base",
  alternatives: [],
  requiredInputs: [],
  confidence: "high",
  activatedRules: ["mature_non_financial"],
  unsupportedReasons: [],
};

function profile(
  overrides: Partial<Record<CompletenessCheckId, CompletenessStatus>> = {},
): CompletenessProfile {
  return {
    version: COMPLETENESS_PROFILE_VERSION,
    latestFiscalYearEnd: "2025-12-31",
    checks: completenessCheckIds.map((check) => ({
      check,
      status: overrides[check] ?? "met",
      missing: [],
      measures: {},
    })),
  };
}

describe(RIGOR_LEVEL_VERSION, () => {
  it("is full only when every check is met, geographic mix included", () => {
    expect(deriveRigorLevel(SELECTED, profile())).toEqual({
      version: RIGOR_LEVEL_VERSION,
      level: "full",
      degradedBy: [],
      declarations: [],
    });
  });

  it("falls to standard without geographic mix and declares country risk by domicile", () => {
    expect(
      deriveRigorLevel(
        SELECTED,
        profile({ geographic_revenue_mix: "missing" }),
      ),
    ).toEqual({
      version: RIGOR_LEVEL_VERSION,
      level: "standard",
      degradedBy: ["geographic_revenue_mix"],
      declarations: ["country_risk_by_domicile"],
    });
  });

  it("accepts three years for standard but names the history that blocks full", () => {
    expect(
      deriveRigorLevel(
        SELECTED,
        profile({ history_years: "partial", leases: "missing" }),
      ),
    ).toMatchObject({
      level: "standard",
      degradedBy: ["history_years", "leases"],
    });
  });

  it("falls to screening without a mapped industry, even with everything else", () => {
    expect(
      deriveRigorLevel(
        SELECTED,
        profile({ industry_mapping: "not_evaluated" }),
      ),
    ).toMatchObject({
      level: "screening",
      degradedBy: ["industry_mapping"],
      declarations: ["invested_capital_not_reconstructed"],
    });
    expect(
      deriveRigorLevel(SELECTED, profile({ industry_mapping: "partial" }))
        .level,
    ).toBe("screening");
  });

  it("is unsupported when the selector did not admit the method", () => {
    expect(
      deriveRigorLevel(
        {
          ...SELECTED,
          status: "unsupported_method",
          assetProfile: "bank",
          unsupportedReasons: ["method_not_implemented"],
        },
        profile(),
      ),
    ).toEqual({
      version: RIGOR_LEVEL_VERSION,
      level: "unsupported",
      degradedBy: ["selection.method_not_implemented"],
      declarations: [],
    });
  });

  it("is unsupported without the structural inputs, whatever else is present", () => {
    expect(
      deriveRigorLevel(SELECTED, profile({ structural_inputs: "partial" })),
    ).toMatchObject({
      level: "unsupported",
      degradedBy: ["structural_inputs"],
    });
  });
});
