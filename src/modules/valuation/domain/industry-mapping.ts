import { z } from "zod";

/**
 * Mapeo de una empresa a la industria del dataset de betas de Damodaran
 * (`F3-05`), con el caso ambiguo **declarado y no adivinado**.
 *
 * La tabla va de cada SIC de la
 * [lista oficial de la SEC](https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list)
 * a las industrias de `damodaran.betas-us` (release de enero de 2026) que ese
 * código puede ser. Un SIC con una sola candidata mapea; uno con varias es
 * `ambiguous` y nombra las candidatas, porque el SIC no alcanza para elegir: el
 * 6021 son JPMorgan y U.S. Bancorp, que Damodaran separa en money center y
 * regional, y el 7372 son tres industrias de software distintas.
 *
 * Una ambigüedad se resuelve sólo con una **declaración del owner** con motivo,
 * igual que una sucesión o la muestra del gate. Un SIC sin fila —cheques en
 * blanco, ADR, gobiernos— es `unmapped`.
 */
export const INDUSTRY_MAPPING_VERSION = "sic-damodaran-industry-1.0.0";
export const DAMODARAN_INDUSTRY_TAXONOMY = "damodaran.betas-us";

const MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Minería y energía.
  "1000": ["metals-and-mining"],
  "1040": ["precious-metals"],
  "1090": ["metals-and-mining"],
  "1220": ["coal-and-related-energy"],
  "1221": ["coal-and-related-energy"],
  "1311": ["oil-gas-production-and-exploration"],
  "1381": ["oilfield-svcs-equip"],
  "1382": ["oilfield-svcs-equip"],
  "1389": ["oilfield-svcs-equip"],
  "1400": ["building-materials", "construction-supplies", "metals-and-mining"],
  // Construcción.
  "1520": ["homebuilding"],
  "1531": ["homebuilding"],
  "1540": ["engineering-construction"],
  "1600": ["engineering-construction"],
  "1623": ["engineering-construction"],
  "1700": ["engineering-construction"],
  "1731": ["engineering-construction"],
  // Alimentos, bebidas y tabaco.
  "2000": ["food-processing"],
  "2011": ["food-processing"],
  "2013": ["food-processing"],
  "2015": ["food-processing"],
  "2020": ["food-processing"],
  "2024": ["food-processing"],
  "2030": ["food-processing"],
  "2033": ["food-processing"],
  "2040": ["food-processing"],
  "2050": ["food-processing"],
  "2052": ["food-processing"],
  "2060": ["food-processing"],
  "2070": ["food-processing", "farming-agriculture"],
  "2080": ["beverage-alcoholic", "beverage-soft"],
  "2082": ["beverage-alcoholic"],
  "2086": ["beverage-soft"],
  "2090": ["food-processing"],
  "2092": ["food-processing"],
  "2100": ["tobacco"],
  "2111": ["tobacco"],
  // Textiles, madera, muebles y papel.
  "2200": ["apparel"],
  "2211": ["apparel"],
  "2221": ["apparel"],
  "2250": ["apparel"],
  "2253": ["apparel"],
  "2273": ["furn-home-furnishings"],
  "2300": ["apparel"],
  "2320": ["apparel"],
  "2330": ["apparel"],
  "2340": ["apparel"],
  "2390": ["apparel"],
  "2400": ["paper-forest-products", "building-materials"],
  "2421": ["paper-forest-products", "building-materials"],
  "2430": ["paper-forest-products", "building-materials"],
  "2451": ["homebuilding"],
  "2452": ["homebuilding"],
  "2510": ["furn-home-furnishings"],
  "2511": ["furn-home-furnishings"],
  "2520": ["office-equipment-and-services"],
  "2522": ["office-equipment-and-services"],
  "2531": ["furn-home-furnishings"],
  "2540": ["furn-home-furnishings"],
  "2590": ["furn-home-furnishings"],
  "2600": ["paper-forest-products"],
  "2611": ["paper-forest-products"],
  "2621": ["paper-forest-products"],
  "2631": ["paper-forest-products", "packaging-and-container"],
  "2650": ["packaging-and-container"],
  "2670": ["paper-forest-products", "packaging-and-container"],
  "2673": ["packaging-and-container"],
  // Edición e impresión.
  "2711": ["publishing-and-newspapers"],
  "2721": ["publishing-and-newspapers"],
  "2731": ["publishing-and-newspapers"],
  "2732": ["publishing-and-newspapers"],
  "2741": ["publishing-and-newspapers"],
  "2750": ["publishing-and-newspapers", "business-and-consumer-services"],
  "2761": ["office-equipment-and-services"],
  "2771": ["publishing-and-newspapers"],
  "2780": ["business-and-consumer-services"],
  "2790": ["business-and-consumer-services"],
  // Química, farmacia y petróleo.
  "2800": ["chemical-basic", "chemical-diversified", "chemical-specialty"],
  "2810": ["chemical-basic"],
  "2820": ["chemical-basic", "chemical-diversified"],
  "2821": ["chemical-basic", "chemical-diversified"],
  "2833": ["drugs-pharmaceutical"],
  "2834": ["drugs-pharmaceutical"],
  "2835": ["healthcare-products", "drugs-biotechnology"],
  "2836": ["drugs-biotechnology"],
  "2840": ["household-products"],
  "2842": ["household-products"],
  "2844": ["household-products"],
  "2851": ["chemical-specialty"],
  "2860": ["chemical-basic"],
  "2870": ["chemical-basic", "chemical-specialty", "farming-agriculture"],
  "2890": ["chemical-specialty"],
  "2891": ["chemical-specialty"],
  "2911": ["oil-gas-integrated", "oil-gas-distribution"],
  "2950": ["building-materials"],
  "2990": ["chemical-basic", "oil-gas-integrated"],
  // Caucho, plástico, cuero, vidrio y piedra.
  "3011": ["rubber-and-tires"],
  "3021": ["shoe"],
  "3050": ["rubber-and-tires", "machinery"],
  "3060": ["rubber-and-tires"],
  "3080": ["packaging-and-container", "chemical-specialty"],
  "3081": ["packaging-and-container"],
  "3086": ["packaging-and-container", "chemical-specialty"],
  "3089": ["packaging-and-container", "chemical-specialty"],
  "3100": ["apparel"],
  "3140": ["shoe"],
  "3211": ["building-materials"],
  "3220": ["building-materials", "household-products"],
  "3221": ["packaging-and-container"],
  "3231": ["building-materials"],
  "3241": ["building-materials", "construction-supplies"],
  "3250": ["building-materials", "construction-supplies"],
  "3260": ["building-materials", "household-products"],
  "3270": ["building-materials", "construction-supplies"],
  "3272": ["building-materials", "construction-supplies"],
  "3281": ["building-materials", "construction-supplies"],
  "3290": ["building-materials", "construction-supplies"],
  // Metales.
  "3310": ["steel"],
  "3312": ["steel"],
  "3317": ["steel"],
  "3320": ["steel"],
  "3330": ["metals-and-mining"],
  "3334": ["metals-and-mining"],
  "3341": ["metals-and-mining"],
  "3350": ["metals-and-mining"],
  "3357": ["metals-and-mining", "electronics-general", "electrical-equipment"],
  "3360": ["metals-and-mining"],
  "3390": ["metals-and-mining"],
  "3411": ["packaging-and-container"],
  "3412": ["packaging-and-container"],
  "3420": ["machinery"],
  "3430": ["building-materials", "machinery"],
  "3433": ["building-materials", "machinery"],
  "3440": ["building-materials", "machinery"],
  "3442": ["building-materials"],
  "3443": ["machinery"],
  "3444": ["building-materials", "machinery"],
  "3448": ["building-materials"],
  "3451": ["machinery"],
  "3452": ["machinery"],
  "3460": ["machinery"],
  "3470": ["machinery"],
  "3480": ["aerospace-defense"],
  "3490": ["machinery"],
  // Maquinaria y computación.
  "3510": ["machinery", "auto-parts"],
  "3523": ["machinery"],
  "3524": ["machinery"],
  "3531": ["machinery"],
  "3532": ["machinery"],
  "3533": ["oilfield-svcs-equip"],
  "3537": ["machinery"],
  "3540": ["machinery"],
  "3541": ["machinery"],
  "3550": ["machinery"],
  "3555": ["machinery"],
  "3559": ["machinery", "semiconductor-equip"],
  "3560": ["machinery"],
  "3561": ["machinery"],
  "3562": ["machinery"],
  "3567": ["machinery"],
  "3569": ["machinery"],
  "3570": ["computers-peripherals"],
  "3571": ["computers-peripherals"],
  "3572": ["computers-peripherals"],
  "3575": ["computers-peripherals"],
  "3576": ["telecom-equipment", "computers-peripherals"],
  "3577": ["computers-peripherals"],
  "3579": ["office-equipment-and-services"],
  "3580": ["machinery", "building-materials"],
  "3585": ["machinery", "building-materials"],
  "3590": ["machinery"],
  // Equipo eléctrico y electrónico.
  "3612": ["electrical-equipment"],
  "3613": ["electrical-equipment"],
  "3620": ["electrical-equipment"],
  "3621": ["electrical-equipment"],
  "3630": ["furn-home-furnishings", "electronics-consumer-and-office"],
  "3634": ["furn-home-furnishings", "electronics-consumer-and-office"],
  "3640": ["electrical-equipment"],
  "3651": ["electronics-consumer-and-office"],
  "3652": ["entertainment"],
  "3661": ["telecom-equipment"],
  "3663": ["telecom-equipment"],
  "3669": ["telecom-equipment"],
  "3670": ["electronics-general"],
  "3672": ["electronics-general"],
  "3674": ["semiconductor"],
  "3677": ["electronics-general"],
  "3678": ["electronics-general"],
  "3679": ["electronics-general"],
  "3690": ["electrical-equipment"],
  "3695": ["computers-peripherals"],
  // Equipo de transporte.
  "3711": ["auto-and-truck"],
  "3713": ["auto-and-truck"],
  "3714": ["auto-parts"],
  "3715": ["auto-and-truck"],
  "3716": ["recreation", "auto-and-truck"],
  "3720": ["aerospace-defense"],
  "3721": ["aerospace-defense"],
  "3724": ["aerospace-defense"],
  "3728": ["aerospace-defense"],
  "3730": ["shipbuilding-and-marine"],
  "3743": ["machinery"],
  "3751": ["recreation"],
  "3760": ["aerospace-defense"],
  "3790": ["auto-and-truck", "recreation"],
  // Instrumentos.
  "3812": ["aerospace-defense", "electronics-general"],
  "3821": ["healthcare-products", "electronics-general"],
  "3824": ["electronics-general"],
  "3825": ["electronics-general", "semiconductor-equip"],
  "3826": ["healthcare-products", "electronics-general"],
  "3827": ["semiconductor-equip", "electronics-general"],
  "3829": ["electronics-general"],
  "3841": ["healthcare-products"],
  "3842": ["healthcare-products"],
  "3843": ["healthcare-products"],
  "3844": ["healthcare-products"],
  "3845": ["healthcare-products"],
  "3851": ["healthcare-products"],
  "3861": ["electronics-consumer-and-office"],
  "3873": ["apparel"],
  // Manufacturas varias.
  "3910": ["apparel", "retail-special-lines"],
  "3911": ["apparel", "retail-special-lines"],
  "3931": ["recreation"],
  "3942": ["recreation"],
  "3944": ["recreation"],
  "3949": ["recreation"],
  "3950": ["office-equipment-and-services"],
  "3960": ["apparel"],
  "3990": ["diversified", "machinery"],
  // Transporte.
  "4011": ["transportation-railroads"],
  "4013": ["transportation-railroads"],
  "4210": ["trucking", "transportation"],
  "4213": ["trucking"],
  "4220": ["transportation"],
  "4400": ["recreation", "transportation", "shipbuilding-and-marine"],
  "4412": ["transportation", "shipbuilding-and-marine"],
  "4512": ["air-transport"],
  "4513": ["air-transport", "transportation", "trucking"],
  "4522": ["air-transport"],
  "4581": ["air-transport", "transportation"],
  "4610": ["oil-gas-distribution"],
  "4700": ["transportation"],
  "4731": ["transportation"],
  // Comunicaciones.
  "4812": ["telecom-wireless"],
  "4813": ["telecom-services"],
  "4822": ["telecom-services"],
  "4832": ["broadcasting"],
  "4833": ["broadcasting"],
  "4841": ["cable-tv"],
  "4899": ["telecom-services", "broadcasting"],
  // Servicios públicos.
  "4900": ["utility-general"],
  "4911": ["power"],
  "4922": ["oil-gas-distribution"],
  "4923": ["oil-gas-distribution", "utility-general"],
  "4924": ["oil-gas-distribution", "utility-general"],
  "4931": ["power", "utility-general"],
  "4932": ["utility-general", "oil-gas-distribution"],
  "4941": ["utility-water"],
  "4950": ["environmental-and-waste-services"],
  "4953": ["environmental-and-waste-services"],
  "4955": ["environmental-and-waste-services"],
  "4961": ["utility-general"],
  "4991": ["power", "green-and-renewable-energy"],
  // Mayoristas.
  "5000": ["retail-distributors"],
  "5010": ["retail-distributors"],
  "5013": ["retail-distributors"],
  "5020": ["retail-distributors"],
  "5030": ["retail-distributors"],
  "5031": ["retail-distributors"],
  "5040": ["retail-distributors"],
  "5045": ["retail-distributors"],
  "5047": ["retail-distributors", "healthcare-support-services"],
  "5050": ["retail-distributors"],
  "5051": ["retail-distributors"],
  "5064": ["retail-distributors"],
  "5065": ["retail-distributors", "electronics-general"],
  "5072": ["retail-distributors"],
  "5080": ["retail-distributors"],
  "5084": ["retail-distributors"],
  "5090": ["retail-distributors"],
  "5094": ["retail-distributors"],
  "5099": ["retail-distributors"],
  "5110": ["retail-distributors"],
  "5122": ["healthcare-support-services", "retail-distributors"],
  "5130": ["retail-distributors"],
  "5140": ["food-wholesalers"],
  "5141": ["food-wholesalers"],
  "5150": ["farming-agriculture", "food-wholesalers"],
  "5160": ["retail-distributors"],
  "5171": ["oil-gas-distribution"],
  "5180": ["food-wholesalers", "beverage-alcoholic"],
  "5190": ["retail-distributors"],
  // Minoristas.
  "5200": ["retail-building-supply"],
  "5211": ["retail-building-supply"],
  "5271": ["retail-special-lines"],
  "5311": ["retail-general"],
  "5331": ["retail-general"],
  "5399": ["retail-general"],
  "5400": ["retail-grocery-and-food"],
  "5411": ["retail-grocery-and-food"],
  "5412": ["retail-grocery-and-food"],
  "5500": ["retail-automotive"],
  "5531": ["retail-automotive"],
  "5600": ["retail-special-lines"],
  "5621": ["retail-special-lines"],
  "5651": ["retail-special-lines", "retail-general"],
  "5661": ["retail-special-lines"],
  "5700": ["retail-special-lines", "furn-home-furnishings"],
  "5712": ["retail-special-lines", "furn-home-furnishings"],
  "5731": ["retail-special-lines"],
  "5734": ["retail-special-lines"],
  "5735": ["retail-special-lines"],
  "5810": ["restaurant-dining"],
  "5812": ["restaurant-dining"],
  "5900": ["retail-special-lines"],
  "5912": [
    "retail-grocery-and-food",
    "retail-special-lines",
    "healthcare-support-services",
  ],
  "5940": ["retail-special-lines"],
  "5944": ["retail-special-lines"],
  "5945": ["retail-special-lines"],
  "5960": ["retail-general", "retail-special-lines"],
  "5961": ["retail-general", "retail-special-lines"],
  "5990": ["retail-special-lines"],
  // Finanzas, seguros e inmuebles.
  "6021": ["bank-money-center", "banks-regional"],
  "6022": ["bank-money-center", "banks-regional"],
  "6029": ["bank-money-center", "banks-regional"],
  "6035": ["banks-regional"],
  "6036": ["banks-regional"],
  "6099": ["financial-svcs-non-bank-and-insurance"],
  "6111": ["financial-svcs-non-bank-and-insurance"],
  "6141": ["financial-svcs-non-bank-and-insurance"],
  "6153": ["financial-svcs-non-bank-and-insurance"],
  "6159": ["financial-svcs-non-bank-and-insurance"],
  "6162": ["financial-svcs-non-bank-and-insurance"],
  "6163": ["financial-svcs-non-bank-and-insurance"],
  "6172": ["financial-svcs-non-bank-and-insurance"],
  "6199": ["financial-svcs-non-bank-and-insurance"],
  "6211": ["brokerage-and-investment-banking"],
  "6221": ["brokerage-and-investment-banking"],
  "6282": ["investments-and-asset-management"],
  "6311": ["insurance-life"],
  "6321": ["insurance-life", "insurance-general"],
  "6324": ["healthcare-support-services", "insurance-general"],
  "6331": ["insurance-prop-cas"],
  "6351": ["insurance-general"],
  "6361": ["insurance-general"],
  "6399": ["insurance-general"],
  "6411": ["insurance-general", "financial-svcs-non-bank-and-insurance"],
  "6500": ["real-estate-general-diversified"],
  "6510": ["real-estate-operations-and-services"],
  "6512": ["real-estate-operations-and-services"],
  "6513": ["real-estate-operations-and-services"],
  "6519": ["real-estate-operations-and-services"],
  "6531": ["real-estate-operations-and-services"],
  "6532": ["real-estate-development"],
  "6552": ["real-estate-development"],
  "6792": ["oil-gas-production-and-exploration"],
  "6795": ["metals-and-mining", "precious-metals"],
  "6798": ["r-e-i-t", "retail-reits"],
  "6799": ["investments-and-asset-management"],
  // Servicios.
  "7000": ["hotel-gaming"],
  "7011": ["hotel-gaming"],
  "7200": ["business-and-consumer-services"],
  "7310": ["advertising"],
  "7311": ["advertising"],
  "7320": ["information-services", "business-and-consumer-services"],
  "7331": ["advertising"],
  "7340": ["business-and-consumer-services"],
  "7350": ["business-and-consumer-services"],
  "7359": ["business-and-consumer-services"],
  "7361": ["business-and-consumer-services"],
  "7363": ["business-and-consumer-services"],
  "7370": ["computer-services", "software-internet", "information-services"],
  "7371": ["computer-services"],
  "7372": [
    "software-system-and-application",
    "software-internet",
    "software-entertainment",
  ],
  "7373": ["computer-services"],
  "7374": ["computer-services", "information-services", "software-internet"],
  "7377": ["computer-services"],
  "7380": ["business-and-consumer-services"],
  "7381": ["business-and-consumer-services"],
  "7384": ["business-and-consumer-services"],
  "7385": ["telecom-services"],
  "7389": [
    "business-and-consumer-services",
    "financial-svcs-non-bank-and-insurance",
    "information-services",
  ],
  "7500": ["business-and-consumer-services"],
  "7510": ["business-and-consumer-services", "transportation"],
  "7600": ["business-and-consumer-services"],
  "7812": ["entertainment"],
  "7819": ["entertainment"],
  "7822": ["entertainment"],
  "7829": ["entertainment"],
  "7830": ["entertainment"],
  "7841": ["entertainment"],
  "7900": ["recreation", "entertainment"],
  "7948": ["recreation"],
  "7990": ["recreation", "hotel-gaming", "entertainment"],
  "7997": ["recreation"],
  "8000": ["hospitals-healthcare-facilities"],
  "8011": ["hospitals-healthcare-facilities"],
  "8050": ["hospitals-healthcare-facilities"],
  "8051": ["hospitals-healthcare-facilities"],
  "8060": ["hospitals-healthcare-facilities"],
  "8062": ["hospitals-healthcare-facilities"],
  "8071": ["healthcare-support-services", "healthcare-products"],
  "8082": ["healthcare-support-services"],
  "8090": ["healthcare-support-services"],
  "8093": ["hospitals-healthcare-facilities"],
  "8111": ["business-and-consumer-services"],
  "8200": ["education"],
  "8300": ["business-and-consumer-services"],
  "8351": ["business-and-consumer-services"],
  "8600": ["business-and-consumer-services"],
  "8700": ["business-and-consumer-services"],
  "8711": ["engineering-construction"],
  "8731": [
    "drugs-biotechnology",
    "healthcare-support-services",
    "business-and-consumer-services",
  ],
  "8734": ["business-and-consumer-services", "healthcare-support-services"],
  "8741": ["business-and-consumer-services"],
  "8742": ["business-and-consumer-services"],
  "8744": ["business-and-consumer-services"],
  "8900": ["business-and-consumer-services"],
});

/** Las candidatas de un SIC, o `null` si la tabla no lo mapea. */
export function industryCandidates(sic: string): readonly string[] | null {
  return MAP[sic] ?? null;
}

/** Cada industria que la tabla nombra, para comprobarla contra la release. */
export function mappedIndustryKeys(): readonly string[] {
  return [...new Set(Object.values(MAP).flat())].sort();
}

export function mappedSicCodes(): readonly string[] {
  return Object.keys(MAP).sort();
}

/**
 * Declaración del owner que resuelve una ambigüedad para una entidad legal. El
 * motivo es obligatorio: una industria elegida sin razón escrita sería la
 * adivinanza que esta regla prohíbe.
 */
export const industryDeclarationSchema = z.object({
  /**
   * CIK y no la entidad legal: el ID interno lo genera la constitución de cada
   * base, y este archivo es público y vale para cualquiera.
   */
  cik: z.string().regex(/^[0-9]{10}$/u),
  /** Símbolo con el que el owner nombra la empresa, para leer. */
  ticker: z.string().trim().min(1).max(12),
  industryKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  decidedBy: z.literal("owner"),
  decidedOn: z.iso.date(),
  rationale: z.string().trim().min(20).max(400),
});

export type IndustryDeclaration = z.infer<typeof industryDeclarationSchema>;

export type IndustryMapping =
  | {
      readonly version: typeof INDUSTRY_MAPPING_VERSION;
      readonly status: "mapped";
      readonly industryKey: string;
      readonly industryLabel: string;
      readonly basis: "sic" | "owner_declaration";
      readonly sic: string | null;
      readonly candidates: readonly string[];
    }
  | {
      readonly version: typeof INDUSTRY_MAPPING_VERSION;
      readonly status: "ambiguous";
      readonly sic: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly version: typeof INDUSTRY_MAPPING_VERSION;
      readonly status: "unmapped";
      readonly sic: string | null;
      readonly reason:
        | "sic_unknown"
        | "sic_not_mapped"
        | "industry_not_in_release"
        | "industry_release_missing";
      readonly candidates: readonly string[];
    };

export type MapIndustryInput = {
  /** CIK vigente de la entidad evaluada, o `null` si no tiene. */
  readonly cik: string | null;
  /** El SIC visible al corte, o `null` si no había. */
  readonly sic: string | null;
  /** Industrias de la release de betas visible al corte, por clave. */
  readonly releaseIndustries: ReadonlyMap<string, string> | null;
  readonly declarations: readonly IndustryDeclaration[];
};

export function mapIndustry(input: MapIndustryInput): IndustryMapping {
  const version = INDUSTRY_MAPPING_VERSION;
  const declaration =
    input.cik === null
      ? undefined
      : input.declarations.find((candidate) => candidate.cik === input.cik);
  const candidates =
    input.sic === null ? [] : [...(industryCandidates(input.sic) ?? [])];

  if (input.releaseIndustries === null) {
    return {
      version,
      status: "unmapped",
      sic: input.sic,
      reason: "industry_release_missing",
      candidates,
    };
  }

  const resolve = (key: string, basis: "sic" | "owner_declaration") => {
    const label = input.releaseIndustries!.get(key);

    return label === undefined
      ? ({
          version,
          status: "unmapped",
          sic: input.sic,
          reason: "industry_not_in_release",
          candidates: [key],
        } as const)
      : ({
          version,
          status: "mapped",
          industryKey: key,
          industryLabel: label,
          basis,
          sic: input.sic,
          candidates,
        } as const);
  };

  // Una declaración del owner vale aunque el SIC sea ambiguo o falte: es la
  // forma escrita de resolver lo que la tabla no puede.
  if (declaration !== undefined) {
    return resolve(declaration.industryKey, "owner_declaration");
  }

  if (input.sic === null) {
    return {
      version,
      status: "unmapped",
      sic: null,
      reason: "sic_unknown",
      candidates,
    };
  }

  if (candidates.length === 0) {
    return {
      version,
      status: "unmapped",
      sic: input.sic,
      reason: "sic_not_mapped",
      candidates,
    };
  }

  if (candidates.length > 1) {
    return { version, status: "ambiguous", sic: input.sic, candidates };
  }

  return resolve(candidates[0]!, "sic");
}
