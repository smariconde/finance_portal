/**
 * Vida amortizable de la I+D por industria de Damodaran (`F4-01`,
 * [ADR 0037](../../../../docs/architecture/adr/0037-lease-rd-capitalization.md)).
 *
 * La fuente es la hoja «Amortizable Lives Look-up Table» de la planilla
 * `R&DConv.xls` de Damodaran (guardada el 2025-01-22): 98 industrias con su
 * período de amortización. Sus nombres son los viejos de Value Line, no los del
 * dataset de betas que usa el proyecto, así que esta tabla es una **declaración**
 * que asigna a cada industria del dataset la fila de la hoja de la que toma la
 * vida, y la nombra. Cambiar una asignación es un diff revisable y sube la
 * versión.
 *
 * `total-market` y `total-market-without-financials` son agregados, no
 * industrias: no tienen vida y una empresa no los recibe nunca.
 */
export const RD_AMORTIZABLE_LIFE_VERSION = "rd-amortizable-life-1.0.0";

export const RD_AMORTIZABLE_LIFE_SOURCE =
  "Damodaran, R&DConv.xls, hoja «Amortizable Lives Look-up Table» (2025-01-22)";

export type RdAmortizableLife = {
  /** Años, entre 2 y 10 como en la hoja. */
  readonly years: number;
  /** La fila de la hoja de la que sale la vida, con su nombre exacto. */
  readonly lookupRow: string;
};

const life = (years: number, lookupRow: string): RdAmortizableLife =>
  Object.freeze({ years, lookupRow });

const LIVES: Readonly<Record<string, RdAmortizableLife>> = Object.freeze({
  advertising: life(2, "Advertising"),
  "aerospace-defense": life(10, "Aerospace/Defense"),
  "air-transport": life(10, "Air Transport"),
  apparel: life(3, "Apparel"),
  "auto-and-truck": life(10, "Auto & Truck"),
  "auto-parts": life(5, "Auto Parts (OEM)"),
  "bank-money-center": life(2, "Bank"),
  "banks-regional": life(2, "Bank"),
  "beverage-alcoholic": life(3, "Beverage (Alcoholic)"),
  "beverage-soft": life(3, "Beverage (Soft Drink)"),
  broadcasting: life(3, "Entertainment"),
  "brokerage-and-investment-banking": life(2, "Securities Brokerage"),
  "building-materials": life(5, "Building Materials"),
  "business-and-consumer-services": life(3, "Industrial Services"),
  "cable-tv": life(10, "Cable TV"),
  "chemical-basic": life(10, "Chemical (Basic)"),
  "chemical-diversified": life(10, "Chemical (Diversified)"),
  "chemical-specialty": life(10, "Chemical (Specialty)"),
  "coal-and-related-energy": life(5, "Coal/Alternate Energy"),
  "computer-services": life(3, "Computer Software & Svcs"),
  "computers-peripherals": life(5, "Computer & Peripherals"),
  "construction-supplies": life(5, "Building Materials"),
  diversified: life(5, "Diversified Co."),
  "drugs-biotechnology": life(10, "Drug"),
  "drugs-pharmaceutical": life(10, "Drug"),
  education: life(3, "Educational Services"),
  "electrical-equipment": life(10, "Electrical Equipment"),
  "electronics-consumer-and-office": life(5, "Electronics"),
  "electronics-general": life(5, "Electronics"),
  "engineering-construction": life(3, "Industrial Services"),
  entertainment: life(3, "Entertainment"),
  "environmental-and-waste-services": life(5, "Environmental"),
  "farming-agriculture": life(3, "Food Processing"),
  "financial-svcs-non-bank-and-insurance": life(2, "Financial Services"),
  "food-processing": life(3, "Food Processing"),
  "food-wholesalers": life(3, "Food Wholesalers"),
  "furn-home-furnishings": life(3, "Furn./Home Furnishings"),
  "green-and-renewable-energy": life(5, "Coal/Alternate Energy"),
  "healthcare-products": life(5, "Medical Supplies"),
  "healthcare-support-services": life(3, "Medical Services"),
  "heathcare-information-and-technology": life(3, "Healthcare Info Systems"),
  homebuilding: life(5, "Homebuilding"),
  "hospitals-healthcare-facilities": life(3, "Medical Services"),
  "hotel-gaming": life(3, "Hotel/Gaming"),
  "household-products": life(3, "Household Products"),
  "information-services": life(3, "Computer Software & Svcs"),
  "insurance-general": life(3, "Insurance (Diversified)"),
  "insurance-life": life(3, "Insurance (Life)"),
  "insurance-prop-cas": life(3, "Insurance (Prop/Casualty)"),
  "investments-and-asset-management": life(3, "Investment Co. (Domestic)"),
  machinery: life(10, "Machinery"),
  "metals-and-mining": life(5, "Metals & Mining (Div.)"),
  "office-equipment-and-services": life(5, "Office Equip & Supplies"),
  "oil-gas-distribution": life(10, "Natural Gas (Distrib.)"),
  "oil-gas-integrated": life(5, "Petroleum (Integrated)"),
  "oil-gas-production-and-exploration": life(5, "Petroleum (Producing)"),
  "oilfield-svcs-equip": life(5, "Oilfield Services/Equip."),
  "packaging-and-container": life(5, "Packaging & Container"),
  "paper-forest-products": life(10, "Paper & Forest Products"),
  power: life(10, "Electric Util. (Central)"),
  "precious-metals": life(5, "Gold/Silver Mining"),
  "publishing-and-newspapers": life(3, "Publishing"),
  "r-e-i-t": life(3, "R.E.I.T."),
  "real-estate-development": life(3, "R.E.I.T."),
  "real-estate-general-diversified": life(3, "R.E.I.T."),
  "real-estate-operations-and-services": life(3, "R.E.I.T."),
  recreation: life(5, "Recreation"),
  reinsurance: life(3, "Insurance (Prop/Casualty)"),
  "restaurant-dining": life(2, "Restaurant"),
  "retail-automotive": life(2, "Retail (Special Lines)"),
  "retail-building-supply": life(2, "Retail Building Supply"),
  "retail-distributors": life(2, "Retail (Special Lines)"),
  "retail-general": life(2, "Retail Store"),
  "retail-grocery-and-food": life(2, "Grocery"),
  "retail-reits": life(3, "R.E.I.T."),
  "retail-special-lines": life(2, "Retail (Special Lines)"),
  "rubber-and-tires": life(5, "Tire & Rubber"),
  semiconductor: life(5, "Semiconductor"),
  "semiconductor-equip": life(5, "Semiconductor Cap Equip"),
  "shipbuilding-and-marine": life(10, "Maritime"),
  shoe: life(3, "Shoe"),
  "software-entertainment": life(3, "Computer Software & Svcs"),
  "software-internet": life(3, "Internet"),
  "software-system-and-application": life(3, "Computer Software & Svcs"),
  steel: life(5, "Steel (General)"),
  "telecom-equipment": life(10, "Telecom. Equipment"),
  "telecom-services": life(5, "Telecom. Services"),
  "telecom-wireless": life(5, "Telecom. Services"),
  tobacco: life(5, "Tobacco"),
  transportation: life(5, "Trucking/Transp. Leasing"),
  "transportation-railroads": life(5, "Railroad"),
  trucking: life(5, "Trucking/Transp. Leasing"),
  "utility-general": life(10, "Electric Util. (Central)"),
  "utility-water": life(10, "Water Utility"),
});

/** La vida más larga de la tabla: lo que la ventana de historia tiene que cubrir. */
export const MAX_RD_AMORTIZABLE_LIFE_YEARS = 10;

/** La vida declarada de una industria, o `null` si no tiene. */
export function rdAmortizableLifeFor(
  industryKey: string,
): RdAmortizableLife | null {
  return Object.hasOwn(LIVES, industryKey) ? LIVES[industryKey]! : null;
}

export function declaredRdLifeIndustries(): readonly string[] {
  return Object.keys(LIVES).sort();
}
