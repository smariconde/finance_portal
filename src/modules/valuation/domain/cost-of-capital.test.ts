import { describe, expect, it } from "vitest";

import {
  FIXTURE_COST_OF_CAPITAL_VALUES,
  fixtureCostOfCapitalReadings,
} from "../infrastructure/fixture-cost-of-capital-readings";
import {
  buildCostOfCapital,
  COST_OF_CAPITAL_VERSION,
  COUNTRY_RISK_REGIONS_DATASET,
  deriveCostOfCapital,
  operationsCountryRiskPremium,
  type CoverageEvidence,
} from "./cost-of-capital";

function coverage(
  value: string,
  fromLatestFiscalYear = true,
): CoverageEvidence {
  return {
    value,
    fiscalYearEnd: "2025-09-27",
    fromLatestFiscalYear,
    availableAt: "2025-10-31T00:00:00.000Z",
  };
}

function build(
  overrides: Partial<Parameters<typeof buildCostOfCapital>[0]> = {},
) {
  return buildCostOfCapital({
    currency: "USD",
    industryKey: "computers-peripherals",
    listingCountry: "US",
    ...fixtureCostOfCapitalReadings(),
    coverage: coverage("29.06"),
    ...overrides,
  });
}

function computed(overrides: Parameters<typeof build>[0] = {}) {
  const result = build(overrides);
  if (result.status !== "computed") {
    throw new Error(
      `expected a cost of capital, missing ${result.missing.join(", ")}`,
    );
  }
  return result.costOfCapital;
}

describe(COST_OF_CAPITAL_VERSION, () => {
  it("builds the cost of equity from a risk-free rate net of the sovereign spread", () => {
    const { derived } = computed();

    // rf = 4,18 % − 0,23 %; βL = 1,32 × (1 + 0,75 × 0,0462); ke = rf + βL × (4,23 % + 0,23 %).
    expect(derived.riskFree).toBe("0.0395");
    expect(derived.leveredBeta).toBe("1.365738");
    expect(derived.costOfEquity).toBe("0.1004119148");
  });

  it("prices debt from the synthetic rating and blends at the industry structure", () => {
    const { derived } = computed();

    expect(derived.syntheticRating).toBe("Aaa/AAA");
    // kd = rf + 0,40 % + 0,23 %, después de impuestos al 25 %.
    expect(derived.preTaxCostOfDebt).toBe("0.0458");
    expect(derived.afterTaxCostOfDebt).toBe("0.03435");
    expect(derived.debtWeight).toBe("0.04415981647868476390747467023513669");
    expect(derived.wacc).toBe("0.0974946327662014911106862932517683");
  });

  it("converges the terminal cost of equity to a beta of one", () => {
    const { derived } = computed();

    expect(derived.terminalBeta).toBe("1");
    expect(derived.terminalCostOfEquity).toBe("0.0841");
    expect(derived.terminalWacc).toBe("0.08190304913018543299560313515580194");
  });

  it.each([
    ["29.06", "Aaa/AAA"],
    ["1.25", "B3/B-"],
    ["1.2499995", "Caa/CCC"],
    ["0.8", "Caa/CCC"],
    ["0", "D2/D"],
    ["-7.31", "D2/D"],
  ])(
    "rates a coverage of %s as %s, using each band's floor inclusively",
    (value, rating) => {
      expect(
        computed({ coverage: coverage(value) }).derived.syntheticRating,
      ).toBe(rating);
    },
  );

  it("equals the cost of equity when the target structure carries no debt", () => {
    const { derived } = computed({
      ...fixtureCostOfCapitalReadings({
        ...FIXTURE_COST_OF_CAPITAL_VALUES,
        debtToEquity: "0",
      }),
    });

    expect(derived.debtWeight).toBe("0");
    expect(derived.wacc).toBe(derived.costOfEquity);
  });

  it("names every missing component instead of filling one", () => {
    expect(
      build({
        currency: "EUR",
        industryKey: null,
        listingCountry: "AR",
        impliedErp: null,
        coverage: null,
      }),
    ).toEqual({
      status: "unsupported",
      version: COST_OF_CAPITAL_VERSION,
      missing: [
        "currency_usd",
        "industry_mapping",
        "domicile_country_risk",
        "currency_sovereign_risk",
        "implied_erp",
        "interest_coverage",
        "synthetic_rating",
      ],
    });
  });

  it("refuses a null published value by naming the parameter, never as zero", () => {
    const readings = fixtureCostOfCapitalReadings();
    const betas = {
      ...readings.betas,
      rows: [
        {
          ...readings.betas.rows[0]!,
          values: {
            ...readings.betas.rows[0]!.values,
            unlevered_beta_cash_corrected: null,
          },
        },
      ],
    };

    expect(build({ betas })).toEqual({
      status: "unsupported",
      version: COST_OF_CAPITAL_VERSION,
      missing: ["unlevered_beta"],
    });
  });

  it("cites each parameter's release, row and field", () => {
    const { parameters, declarations } = computed({
      coverage: coverage("29.06", false),
    });

    expect(
      parameters.find((parameter) => parameter.name === "unlevered_beta"),
    ).toMatchObject({
      datasetId: "damodaran.betas-us",
      rowKey: "computers-peripherals",
      field: "unlevered_beta_cash_corrected",
      publishedLabel: "January 2026",
      availableAt: "2026-10-02T17:30:00.000Z",
    });
    expect(
      parameters.find((parameter) => parameter.name === "implied_erp")?.rowKey,
    ).toBe("2025");
    expect(declarations).toContain("coverage_from_earlier_fiscal_year");
  });

  it("rebuilds the same arithmetic from the parameters alone", () => {
    const cost = computed();

    expect(
      deriveCostOfCapital(cost.parameters, cost.derived.syntheticRating),
    ).toEqual(cost.derived);
    expect(() =>
      deriveCostOfCapital(cost.parameters.slice(1), "Aaa/AAA"),
    ).toThrow("treasury_bond_rate");
  });
});

describe(`${COST_OF_CAPITAL_VERSION}: country risk weighted by operations`, () => {
  const base = fixtureCostOfCapitalReadings();
  const countryRisk = {
    ...base.countryRisk,
    rows: [
      ...base.countryRisk.rows,
      {
        key: "japan",
        label: "Japan",
        values: { country_risk_premium: "0.01", gdp_millions: "4000" },
      },
      {
        key: "china",
        label: "China",
        values: { country_risk_premium: "0.02", gdp_millions: "18000" },
      },
      {
        key: "taiwan",
        label: "Taiwan",
        values: { country_risk_premium: "0.01", gdp_millions: "2000" },
      },
    ],
  };
  const regions = {
    release: {
      ...base.countryRisk.release,
      datasetId: COUNTRY_RISK_REGIONS_DATASET,
      releaseId: "00000000-0000-4000-8000-0000000000c2",
    },
    rows: [
      {
        key: "north-america",
        label: "North America",
        values: { country_risk_premium: "0.002", gdp_millions: "30000" },
      },
      {
        key: "asia",
        label: "Asia",
        values: { country_risk_premium: "0.014", gdp_millions: "34000" },
      },
      {
        key: "africa",
        label: "Africa",
        values: { country_risk_premium: "0.074", gdp_millions: "2000" },
      },
    ],
  };

  function weighted(
    exposures: { exposureKeys: string[]; weight: string }[],
    source: "owner_declaration" | "ai_proposal" = "ai_proposal",
  ) {
    return build({
      countryRisk,
      regions,
      operationsMix: {
        source,
        proposalId:
          source === "ai_proposal"
            ? "00000000-0000-4000-8000-0000000000a1"
            : null,
        weightsVersion: "operations-mix-weights-1.0.0",
        exposures,
      },
    });
  }

  it("weights each exposure's premium by revenue and combines several rows by GDP", () => {
    const result = weighted([
      { exposureKeys: ["united-states"], weight: "0.5" },
      { exposureKeys: ["japan"], weight: "0.2" },
      // (18000 × 2 % + 2000 × 1 %) / 20000 = 1,9 %
      { exposureKeys: ["china", "taiwan"], weight: "0.2" },
      // (30000 × 0,2 % + 34000 × 1,4 % + 2000 × 7,4 %) / 66000 = 1,0364 %
      { exposureKeys: [], weight: "0.1" },
    ]);
    if (result.status !== "computed") throw new Error(result.missing.join());

    const crp = operationsCountryRiskPremium(
      result.costOfCapital.operationsExposure!,
    );
    // 0,5 × 0,23 % + 0,2 × 1 % + 0,2 × 1,9 % + 0,1 × 1,03636… %
    expect(crp.toFixed(10)).toBe("0.0079863636");
    expect(result.costOfCapital.declarations).toEqual(
      expect.arrayContaining([
        "country_risk_by_operations",
        "regions_combined_by_gdp",
        "rest_of_world_as_global",
      ]),
    );
    expect(result.costOfCapital.declarations).not.toContain(
      "country_risk_by_primary_listing",
    );
    // ke = rf + βL × (ERP + CRP por operaciones)
    expect(result.costOfCapital.derived.costOfEquity).toBe(
      deriveCostOfCapital(
        result.costOfCapital.parameters,
        "Aaa/AAA",
        result.costOfCapital.operationsExposure!,
      ).costOfEquity,
    );
    expect(Number(result.costOfCapital.derived.costOfEquity)).toBeGreaterThan(
      Number(computed().derived.costOfEquity),
    );
  });

  it("keeps the domicile's default spread and tax rate for debt", () => {
    const result = weighted([{ exposureKeys: ["japan"], weight: "1" }]);
    if (result.status !== "computed") throw new Error(result.missing.join());

    expect(result.costOfCapital.derived.preTaxCostOfDebt).toBe(
      computed().derived.preTaxCostOfDebt,
    );
  });

  it("names an exposure the release does not have instead of using the domicile", () => {
    expect(
      weighted([
        { exposureKeys: ["united-states"], weight: "0.5" },
        { exposureKeys: ["atlantis"], weight: "0.5" },
      ]),
    ).toMatchObject({
      status: "unsupported",
      missing: ["operations_exposure.atlantis"],
    });
  });

  it("needs every row's GDP to combine several, and none for one", () => {
    expect(
      weighted([{ exposureKeys: ["united-states", "japan"], weight: "1" }]),
    ).toMatchObject({
      status: "unsupported",
      missing: ["operations_exposure_gdp.united-states"],
    });
    expect(
      weighted([{ exposureKeys: ["united-states"], weight: "1" }]).status,
    ).toBe("computed");
  });

  it("refuses weights that do not add up to one", () => {
    expect(() =>
      weighted([
        { exposureKeys: ["united-states"], weight: "0.5" },
        { exposureKeys: ["japan"], weight: "0.4" },
      ]),
    ).toThrow();
  });

  it("leaves the cost of capital exactly as before without a mix", () => {
    const { derived, operationsExposure, declarations } = computed();

    expect(operationsExposure).toBeNull();
    expect(declarations).toContain("country_risk_by_primary_listing");
    expect(derived.wacc).toBe("0.0974946327662014911106862932517683");
  });
});
