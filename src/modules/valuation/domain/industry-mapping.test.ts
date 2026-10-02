import { describe, expect, it } from "vitest";

import { DECLARED_INDUSTRY_ASSIGNMENTS } from "../application/declared-industry-assignments";
import {
  INDUSTRY_MAPPING_VERSION,
  industryCandidates,
  industryDeclarationSchema,
  mapIndustry,
  mappedIndustryKeys,
  mappedSicCodes,
} from "./industry-mapping";

/**
 * Industrias de `damodaran.betas-us` en la release de enero de 2026: los nombres
 * de la taxonomía, no sus cifras. Si Damodaran renombra una, este test lo dice
 * antes de que el mapeo empiece a devolver `industry_not_in_release`.
 */
const JANUARY_2026_INDUSTRIES = [
  "advertising",
  "aerospace-defense",
  "air-transport",
  "apparel",
  "auto-and-truck",
  "auto-parts",
  "bank-money-center",
  "banks-regional",
  "beverage-alcoholic",
  "beverage-soft",
  "broadcasting",
  "brokerage-and-investment-banking",
  "building-materials",
  "business-and-consumer-services",
  "cable-tv",
  "chemical-basic",
  "chemical-diversified",
  "chemical-specialty",
  "coal-and-related-energy",
  "computer-services",
  "computers-peripherals",
  "construction-supplies",
  "diversified",
  "drugs-biotechnology",
  "drugs-pharmaceutical",
  "education",
  "electrical-equipment",
  "electronics-consumer-and-office",
  "electronics-general",
  "engineering-construction",
  "entertainment",
  "environmental-and-waste-services",
  "farming-agriculture",
  "financial-svcs-non-bank-and-insurance",
  "food-processing",
  "food-wholesalers",
  "furn-home-furnishings",
  "green-and-renewable-energy",
  "healthcare-products",
  "healthcare-support-services",
  "heathcare-information-and-technology",
  "homebuilding",
  "hospitals-healthcare-facilities",
  "hotel-gaming",
  "household-products",
  "information-services",
  "insurance-general",
  "insurance-life",
  "insurance-prop-cas",
  "investments-and-asset-management",
  "machinery",
  "metals-and-mining",
  "office-equipment-and-services",
  "oil-gas-distribution",
  "oil-gas-integrated",
  "oil-gas-production-and-exploration",
  "oilfield-svcs-equip",
  "packaging-and-container",
  "paper-forest-products",
  "power",
  "precious-metals",
  "publishing-and-newspapers",
  "r-e-i-t",
  "real-estate-development",
  "real-estate-general-diversified",
  "real-estate-operations-and-services",
  "recreation",
  "reinsurance",
  "restaurant-dining",
  "retail-automotive",
  "retail-building-supply",
  "retail-distributors",
  "retail-general",
  "retail-grocery-and-food",
  "retail-reits",
  "retail-special-lines",
  "rubber-and-tires",
  "semiconductor",
  "semiconductor-equip",
  "shipbuilding-and-marine",
  "shoe",
  "software-entertainment",
  "software-internet",
  "software-system-and-application",
  "steel",
  "telecom-equipment",
  "telecom-services",
  "telecom-wireless",
  "tobacco",
  "transportation",
  "transportation-railroads",
  "trucking",
  "utility-general",
  "utility-water",
];

const RELEASE = new Map(
  JANUARY_2026_INDUSTRIES.map((key) => [key, `Label of ${key}`]),
);

function map(
  sic: string | null,
  overrides: Partial<Parameters<typeof mapIndustry>[0]> = {},
) {
  return mapIndustry({
    cik: "0000000042",
    sic,
    releaseIndustries: RELEASE,
    declarations: [],
    ...overrides,
  });
}

describe(INDUSTRY_MAPPING_VERSION, () => {
  it("names only industries of the pinned release and only four-digit codes", () => {
    const unknown = mappedIndustryKeys().filter((key) => !RELEASE.has(key));

    expect(unknown).toEqual([]);
    expect(mappedSicCodes().every((code) => /^[0-9]{4}$/u.test(code))).toBe(
      true,
    );
    // Ninguna industria repetida dentro de un mismo código.
    for (const code of mappedSicCodes()) {
      const candidates = industryCandidates(code)!;
      expect(new Set(candidates).size).toBe(candidates.length);
    }
  });

  it("maps a specific code to its single industry", () => {
    expect(map("3571")).toEqual({
      version: INDUSTRY_MAPPING_VERSION,
      status: "mapped",
      industryKey: "computers-peripherals",
      industryLabel: "Label of computers-peripherals",
      basis: "sic",
      sic: "3571",
      candidates: ["computers-peripherals"],
    });
    expect(map("2834")).toMatchObject({ industryKey: "drugs-pharmaceutical" });
  });

  it("names the candidates of an ambiguous code instead of picking one", () => {
    expect(map("7372")).toEqual({
      version: INDUSTRY_MAPPING_VERSION,
      status: "ambiguous",
      sic: "7372",
      candidates: [
        "software-system-and-application",
        "software-internet",
        "software-entertainment",
      ],
    });
    expect(map("6798").status).toBe("ambiguous");
  });

  it("resolves an ambiguity only with an owner declaration for that CIK", () => {
    const declaration = industryDeclarationSchema.parse({
      cik: "0000000042",
      ticker: "FIX",
      industryKey: "software-system-and-application",
      decidedBy: "owner",
      decidedOn: "2026-10-02",
      rationale: "Enterprise application software; licenses and subscriptions.",
    });

    expect(map("7372", { declarations: [declaration] })).toMatchObject({
      status: "mapped",
      basis: "owner_declaration",
      industryKey: "software-system-and-application",
    });
    expect(
      map("7372", { declarations: [declaration], cik: "0000000043" }).status,
    ).toBe("ambiguous");
  });

  it("refuses a declaration without a written reason or a public identifier", () => {
    expect(() =>
      industryDeclarationSchema.parse({
        cik: "42",
        ticker: "FIX",
        industryKey: "machinery",
        decidedBy: "owner",
        decidedOn: "2026-10-02",
        rationale: "because",
      }),
    ).toThrow();
  });

  it("keeps the declarations file empty until the owner decides", () => {
    expect(DECLARED_INDUSTRY_ASSIGNMENTS).toEqual([]);
  });

  it("separates the reasons a company stays unmapped", () => {
    expect(map(null)).toMatchObject({
      status: "unmapped",
      reason: "sic_unknown",
    });
    expect(map("6770")).toMatchObject({
      status: "unmapped",
      reason: "sic_not_mapped",
    });
    expect(map("3571", { releaseIndustries: null })).toMatchObject({
      status: "unmapped",
      reason: "industry_release_missing",
    });
    expect(
      map("3571", { releaseIndustries: new Map([["machinery", "Machinery"]]) }),
    ).toMatchObject({
      status: "unmapped",
      reason: "industry_not_in_release",
      candidates: ["computers-peripherals"],
    });
  });
});
