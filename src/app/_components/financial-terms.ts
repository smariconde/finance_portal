/**
 * Glosario de métricas: el término estándar en inglés primero —el de los
 * 10-K, Damodaran y Finviz, con el que el owner trabaja— y la aclaración en
 * castellano. La interfaz sigue en castellano; sólo los nombres de métricas
 * siguen esta regla, y la prosa los nombra por su sigla.
 *
 * Es copia de interfaz, como `labels.ts`: el identificador del motor es el
 * contrato y este nombre puede cambiar sin tocar una corrida.
 */
type FinancialTerm = {
  /** El nombre en inglés, como se lee en un filing o en Damodaran. */
  readonly en: string;
  /** La sigla de uso corriente, cuando la hay y no es ya el nombre. */
  readonly abbr?: string;
  /** La aclaración en castellano, en minúscula para leerse como subtítulo. */
  readonly es: string;
};

export const FINANCIAL_TERMS = {
  revenue: { en: "Revenue", es: "ventas" },
  revenueGrowth: { en: "Revenue growth", es: "crecimiento de las ventas" },
  operatingMargin: { en: "Operating margin", es: "margen operativo" },
  ebit: { en: "EBIT", es: "resultado operativo" },
  ebitMargin: { en: "EBIT margin", es: "margen operativo" },
  terminalEbitMargin: {
    en: "Terminal EBIT margin",
    es: "margen operativo a perpetuidad",
  },
  nopat: { en: "NOPAT", es: "resultado operativo después de impuestos" },
  reinvestment: { en: "Reinvestment", es: "reinversión" },
  salesToCapital: { en: "Sales-to-capital", es: "ventas sobre capital" },
  returnOnCapital: { en: "ROIC", es: "retorno sobre el capital invertido" },
  terminalReturnOnCapital: {
    en: "Terminal ROIC",
    es: "retorno sobre el capital a perpetuidad",
  },
  dilutedEps: { en: "Diluted EPS", es: "ganancia por acción diluida" },
  freeCashFlow: {
    en: "Free cash flow",
    abbr: "FCF",
    es: "flujo de caja libre",
  },
  fcff: {
    en: "Free cash flow to the firm",
    abbr: "FCFF",
    es: "flujo de caja libre de la empresa",
  },
  netCash: { en: "Net cash (debt)", es: "caja neta (o deuda neta)" },
  dilutedShares: { en: "Diluted shares", es: "acciones diluidas" },
  sharesOutstanding: {
    en: "Shares outstanding",
    es: "acciones en circulación",
  },
  presentValue: { en: "Present value", abbr: "PV", es: "valor de hoy" },
  discountFactor: { en: "Discount factor", es: "factor de descuento" },
  terminalValue: { en: "Terminal value", abbr: "TV", es: "valor terminal" },
  terminalGrowth: { en: "Terminal growth", es: "crecimiento a perpetuidad" },
  goingConcernValue: {
    en: "Going-concern value",
    es: "valor si sigue operando",
  },
  enterpriseValue: {
    en: "Enterprise value",
    abbr: "EV",
    es: "valor de las operaciones",
  },
  equityValue: { en: "Equity value", es: "valor para los accionistas" },
  valuePerShare: { en: "Value per share", es: "valor por acción" },
  excessCash: { en: "Excess cash", es: "caja excedente" },
  nonOperatingAssets: {
    en: "Non-operating assets",
    es: "activos no operativos",
  },
  debt: { en: "Debt", es: "deuda financiera" },
  leaseDebt: { en: "Lease liabilities", es: "deuda por arrendamientos" },
  minorityInterest: {
    en: "Minority interest",
    es: "participaciones no controlantes",
  },
  otherClaims: { en: "Other claims", es: "otros reclamos sobre el patrimonio" },
  employeeOptions: { en: "Employee options", es: "opciones de empleados" },
  wacc: { en: "WACC", es: "costo promedio ponderado del capital" },
  terminalWacc: { en: "Terminal WACC", es: "costo del capital a perpetuidad" },
  costOfEquity: { en: "Cost of equity", es: "costo del patrimonio" },
  preTaxCostOfDebt: {
    en: "Pre-tax cost of debt",
    es: "costo de la deuda antes de impuestos",
  },
  afterTaxCostOfDebt: {
    en: "After-tax cost of debt",
    es: "costo de la deuda después de impuestos",
  },
  riskFree: { en: "Risk-free rate", es: "tasa libre de riesgo" },
  equityRiskPremium: {
    en: "Equity risk premium",
    abbr: "ERP",
    es: "prima de riesgo del mercado",
  },
  countryRiskPremium: {
    en: "Country risk premium",
    abbr: "CRP",
    es: "prima de riesgo país",
  },
  leveredBeta: { en: "Levered beta", es: "beta reapalancada" },
  syntheticRating: { en: "Synthetic rating", es: "calificación sintética" },
  equityWeight: { en: "Equity weight", abbr: "E/V", es: "peso del patrimonio" },
  debtWeight: { en: "Debt weight", abbr: "D/V", es: "peso de la deuda" },
  taxRate: { en: "Tax rate", es: "tasa impositiva" },
  discountRate: { en: "Discount rate", es: "tasa de descuento" },
  priceToValue: { en: "Price / value", es: "precio sobre valor" },
  priceToEarnings: { en: "P/E", es: "precio sobre ganancia" },
  evToEbit: { en: "EV/EBIT", es: "valor de las operaciones sobre EBIT" },
  returnOnEquity: { en: "ROE", es: "retorno sobre el patrimonio" },
  commonBookEquity: { en: "Common book equity", es: "patrimonio común" },
  excessReturn: { en: "Excess return", es: "retorno excedente" },
} as const satisfies Record<string, FinancialTerm>;

export type FinancialTermKey = keyof typeof FINANCIAL_TERMS;

function entry(key: FinancialTermKey): FinancialTerm {
  return FINANCIAL_TERMS[key];
}

/** «Free cash flow (FCF)»: el nombre completo con su sigla. */
export function termName(key: FinancialTermKey): string {
  const term = entry(key);
  return term.abbr === undefined ? term.en : `${term.en} (${term.abbr})`;
}

/** «FCF»: la sigla si existe; si no, el nombre en inglés. */
export function termShort(key: FinancialTermKey): string {
  const term = entry(key);
  return term.abbr ?? term.en;
}

/** «flujo de caja libre»: la aclaración en castellano. */
export function termSpanish(key: FinancialTermKey): string {
  return entry(key).es;
}

/** «FCF (flujo de caja libre)»: para nombrar la métrica dentro de la prosa. */
export function termInProse(key: FinancialTermKey): string {
  return `${termShort(key)} (${termSpanish(key)})`;
}
