import { FAILURE_RISK_VERSION } from "../domain/failure-risk";
import {
  DEMO_IDENTITY_IDS,
  DEMO_SUBJECT_KEY,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import {
  DEMO_SOURCE_ID,
  FY2024_AMENDMENT_AVAILABLE_AT,
} from "@/modules/ingestion/infrastructure/demo-ingestion-fixtures";
import { DEFAULT_SOURCE_POLICY_VERSION } from "@/modules/temporal/domain/point-in-time-query";

import { type CompletenessProfile } from "../domain/completeness-profile";
import { DECIMAL_POLICY } from "../domain/decimal-policy";
import { buildCapitalization } from "../domain/capitalization-bridge";
import { buildNormalization } from "../domain/normalization";
import {
  METHOD_SELECTION_VERSION,
  type MethodSelection,
} from "../domain/method-selection";
import {
  buildCostOfCapital,
  marginalTaxRateOf,
} from "../domain/cost-of-capital";
import { qualitativeDecisionsSchema } from "../domain/qualitative-decisions";
import { deriveRigorLevel } from "../domain/rigor-level";
import { SCENARIO_SET_VERSION } from "../domain/scenarios";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { EQUITY_VOLATILITY_FORMULA_VERSION } from "@/modules/metrics/domain/equity-volatility";
import {
  deriveEmployeeEquity,
  DIVIDEND_YIELD_VERSION,
  EMPLOYEE_EQUITY_CLAIM_VERSION,
  type EmployeeEquityDecision,
  type EmployeeOptionMarket,
} from "../domain/employee-equity-claim";
import { fixtureCostOfCapitalReadings } from "./fixture-cost-of-capital-readings";
import {
  ENGINE_VERSION,
  METHODOLOGY_VERSION,
  VALUATION_METHOD,
  valuationInputSchema,
  type ValuationInput,
} from "../domain/valuation-input";

/**
 * Snapshot de valuación sintético del modo demo.
 *
 * Valúa a `FixtureCo`, la misma empresa inexistente del grafo de identidad, con
 * los hechos que la fuente sintética ya publica. No deriva de ningún payload
 * live ni de una captura de proveedor. Cambiar un supuesto obliga a subir
 * `DEMO_VALUATION_FIXTURE_VERSION` y regenerar los hashes esperados.
 *
 * Dos detalles son deliberados y se prueban:
 *
 * - `observationId` es `null` porque las observaciones demo reciben un UUID
 *   nuevo en cada publicación; una fixture estática no puede fingir ese enlace.
 *   La provenance conserva fuente, documento, `as_of` y `available_at`.
 * - las acciones diluidas **no** vienen del dataset de fundamentales: allí
 *   `shares_outstanding` queda `license_restricted` y sin valor. El snapshot las
 *   declara desde otro documento en vez de inventar un cero (`TM-05`, `TM-15`).
 */
export const DEMO_VALUATION_FIXTURE_VERSION = "2026-10-02.2";

export const DEMO_VALUATION_AS_OF = "2025-06-30";

/**
 * Evaluación de la Fase 3 de `FixtureCo`, declarada: la empresa no tiene SIC ni
 * una serie de cinco ejercicios en la fuente sintética, así que la selección y la
 * completitud se escriben como lo que una evaluación devolvería. El rigor **no**
 * se escribe: se deriva, igual que lo recalcula el motor.
 */
const DEMO_SELECTION: MethodSelection = {
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

const DEMO_COMPLETENESS: CompletenessProfile = {
  // La completitud de la fixture se midió con `1.2.0`; fijarla mantiene sus hashes.
  version: "completeness-profile-1.2.0",
  latestFiscalYearEnd: "2024-12-31",
  checks: [
    {
      check: "structural_inputs",
      status: "met",
      missing: [],
      measures: { present: 4, required: 4 },
    },
    {
      check: "history_years",
      status: "missing",
      missing: ["fiscal_years_with_revenue_and_ebit.5"],
      measures: { years: 1 },
    },
    {
      check: "cash_and_debt",
      status: "met",
      missing: [],
      measures: { present: 2, required: 2 },
    },
    {
      check: "leases",
      status: "missing",
      missing: ["operating_lease_liability"],
      measures: { present: 0, required: 1 },
    },
    {
      check: "research_development",
      status: "missing",
      missing: ["research_development.not_reported"],
      measures: { years: 0 },
    },
    {
      check: "reinvestment_inputs",
      status: "missing",
      missing: ["capital_expenditure", "depreciation_amortization"],
      measures: { present: 0, required: 2 },
    },
    {
      check: "tax_rate_inputs",
      status: "missing",
      missing: ["pretax_income", "income_tax"],
      measures: { present: 0, required: 2 },
    },
    {
      check: "industry_mapping",
      status: "not_evaluated",
      missing: ["industry_mapping"],
      measures: {},
    },
    {
      check: "geographic_revenue_mix",
      status: "missing",
      missing: ["geographic_revenue_mix.not_ingested"],
      measures: {},
    },
  ],
};

/**
 * Costo de capital de `FixtureCo`, **construido** con la misma regla que una
 * empresa real sobre releases sintéticas. Los parámetros se eligieron para que
 * el WACC dé el 9 % que la corrida de referencia usaba como input crudo: beta 1
 * sin deuda, libre de riesgo 4 % y ERP 5 %. El terminal coincide porque la beta
 * ya está en 1.
 */
export const DEMO_COST_OF_CAPITAL_REQUEST = {
  currency: "USD",
  industryKey: "computers-peripherals",
  listingCountry: "US",
  ...fixtureCostOfCapitalReadings({
    treasuryBondRate: "0.04",
    sovereignDefaultSpread: "0",
    impliedErp: "0.05",
    countryRiskPremium: "0",
    countryDefaultSpread: "0",
    corporateTaxRate: "0.25",
    unleveredBeta: "1",
    debtToEquity: "0",
  }),
  coverage: {
    value: "10",
    fiscalYearEnd: "2024-12-31",
    fromLatestFiscalYear: true,
    availableAt: "2025-02-15T00:00:00.000Z",
  },
} as const;

const DEMO_COST_OF_CAPITAL_RESULT = buildCostOfCapital(
  DEMO_COST_OF_CAPITAL_REQUEST,
);

if (DEMO_COST_OF_CAPITAL_RESULT.status !== "computed") {
  throw new Error("the demo cost of capital must build");
}

export const DEMO_COST_OF_CAPITAL = DEMO_COST_OF_CAPITAL_RESULT.costOfCapital;

/**
 * La industria de `FixtureCo` la declara la fixture —no tiene SIC observado— y
 * no hay mix de operaciones: el CRP es el del domicilio (`F5-06`).
 */
export const DEMO_QUALITATIVE_DECISIONS = qualitativeDecisionsSchema.parse({
  // Un snapshot `1.0.0`, sin evidencia web: la `1.1.0` lo sigue leyendo y la
  // corrida de referencia conserva sus hashes.
  version: "qualitative-decisions-1.0.0",
  industry: {
    basis: "owner_declaration",
    mappingVersion: "sic-damodaran-industry-1.1.0",
    industryKey: DEMO_COST_OF_CAPITAL.industryKey,
    sic: null,
    candidates: [],
    declaredOn: "2026-10-02",
    rationale:
      "FixtureCo is a synthetic hardware maker declared for the reference run.",
  },
  operationsMix: null,
});

export const DEMO_VALUATION_ASSESSMENT = {
  selection: DEMO_SELECTION,
  completeness: DEMO_COMPLETENESS,
  rigor: deriveRigorLevel(DEMO_SELECTION, DEMO_COMPLETENESS),
};

const FY2024_DOCUMENT = "fixtureco-fy2024-annual-report";
const FY2024_AMENDMENT_DOCUMENT = "fixtureco-fy2024-annual-report-amendment";
const CAPITAL_STRUCTURE_DOCUMENT = "fixtureco-fy2024-capital-structure";
const SHARE_REGISTER_DOCUMENT = "fixtureco-2025-share-register";

const FY2024_AVAILABLE_AT = "2025-02-20T21:00:00.000Z";

const monetary = (input: {
  value: string;
  asOf: string;
  availableAt: string;
  sourceDocumentId: string;
  qualityFlags?: readonly string[];
}) => ({
  value: input.value,
  currency: "USD",
  unit: "monetary" as const,
  asOf: input.asOf,
  availableAt: input.availableAt,
  sourceId: DEMO_SOURCE_ID,
  sourceDocumentId: input.sourceDocumentId,
  observationId: null,
  qualityFlags: [...(input.qualityFlags ?? [])],
});

const declaredAbsent = (rationale: string) => ({
  status: "declared_absent" as const,
  amount: null,
  rationale,
});

/** Cinco períodos explícitos con convergencia de crecimiento y luego terminal. */
const EXPLICIT_PERIODS = [
  { periodEnd: "2025-12-31", revenueGrowth: "0.08" },
  { periodEnd: "2026-12-31", revenueGrowth: "0.07" },
  { periodEnd: "2027-12-31", revenueGrowth: "0.06" },
  { periodEnd: "2028-12-31", revenueGrowth: "0.05" },
  { periodEnd: "2029-12-31", revenueGrowth: "0.04" },
].map((period, index) => ({
  periodIndex: index + 1,
  periodEnd: period.periodEnd,
  revenueGrowth: period.revenueGrowth,
  ebitMargin: "0.18",
  taxRate: "0.25",
  wacc: "0.09",
  // Una sola convención en todos los períodos: no hace falta puente.
  reinvestment: {
    convention: "sales_to_capital" as const,
    salesToCapital: "2.5",
  },
}));

/**
 * Bear y bull de FixtureCo (`F4-04`). Son tesis sintéticas, declaradas como
 * tales: cada una mueve crecimiento, margen y retorno terminal juntos, porque
 * un escenario que sólo cambia el crecimiento no es una historia coherente.
 * El costo de capital y la tasa no se mueven: salen de componentes fechados y
 * de la normalización.
 */
const DEMO_SCENARIOS = {
  version: SCENARIO_SET_VERSION,
  bear: {
    thesis:
      "Tesis sintética: la demanda se enfría y la competencia por precio comprime el margen; en el terminal, crecer deja de crear valor.",
    drivers: [
      {
        driver: "revenueGrowth" as const,
        values: ["0.05", "0.045", "0.04", "0.035", "0.03"],
        rationale:
          "La demanda crece tres puntos menos que en la base en cada período explícito.",
      },
      {
        driver: "ebitMargin" as const,
        values: ["0.15", "0.15", "0.15", "0.15", "0.15"],
        rationale:
          "La competencia por precio se lleva tres puntos de margen y no los devuelve.",
      },
      {
        driver: "terminalGrowth" as const,
        value: "0.015",
        rationale:
          "Un negocio más lento crece a perpetuidad por debajo de la base.",
      },
      {
        driver: "terminalEbitMargin" as const,
        value: "0.15",
        rationale: "El margen comprimido persiste en el estado estable.",
      },
      {
        driver: "terminalReturnOnCapital" as const,
        value: "0.09",
        rationale:
          "Sin ventaja competitiva, el retorno sobre el capital converge al costo de capital.",
      },
    ],
  },
  bull: {
    thesis:
      "Tesis sintética: el producto gana participación y el apalancamiento operativo sube el margen; la ventaja persiste en el terminal.",
    drivers: [
      {
        driver: "revenueGrowth" as const,
        values: ["0.11", "0.095", "0.08", "0.065", "0.05"],
        rationale:
          "La ganancia de participación suma tres puntos de crecimiento que se desvanecen con la base.",
      },
      {
        driver: "ebitMargin" as const,
        values: ["0.19", "0.2", "0.2", "0.2", "0.2"],
        rationale:
          "El apalancamiento operativo sube el margen dos puntos desde el segundo año.",
      },
      {
        driver: "terminalGrowth" as const,
        value: "0.025",
        rationale:
          "Una franquicia más grande crece por encima de la base, todavía por debajo de la libre de riesgo.",
      },
      {
        driver: "terminalEbitMargin" as const,
        value: "0.2",
        rationale: "El margen más alto es estructural, no cíclico.",
      },
      {
        driver: "terminalReturnOnCapital" as const,
        value: "0.15",
        rationale:
          "La ventaja competitiva sostiene el retorno sobre el capital por encima de su costo.",
      },
    ],
  },
};

const SHARES_OUTSTANDING = {
  value: "12300000",
  unit: "shares" as const,
  asOf: "2025-06-30",
  availableAt: "2025-07-15T12:00:00.000Z",
  sourceId: DEMO_SOURCE_ID,
  sourceDocumentId: SHARE_REGISTER_DOCUMENT,
  observationId: null,
  qualityFlags: [],
};

/**
 * Opciones y unidades de FixtureCo (`F4-05`): una nota de compensación en
 * acciones **sintética**, declarada como tal, transcripta en la forma que la
 * tarea acepta. 300 mil opciones a USD 9 con cuatro años y 200 mil RSU sobre
 * 12,3 millones de acciones: el denominador sigue siendo 12,5 millones y el
 * puente resta el valor de las opciones, así que el valor por acción baja.
 * El mercado también es sintético —precio 14, volatilidad 30 %, sin
 * dividendos—: FixtureCo no tiene serie de precios.
 */
const EQUITY_NOTE_DOCUMENT = "fixtureco-fy2024-equity-compensation-note";
const DEMO_EQUITY_NOTE =
  "Synthetic note. Stock options (shares in thousands): Outstanding at December 31, 2024 300 $9.00, with a weighted average remaining contractual life of 4.0 years. Restricted stock units: Balance at December 31, 2024 200.";

const DEMO_EMPLOYEE_EQUITY_DECISION: EmployeeEquityDecision = {
  basis: "ai_proposal",
  proposalId: "00000000-0000-4000-8000-0000000000e1",
  accessionNumber: "0000000000-25-000001",
  fiscalYearEnd: "2024-12-31",
  // La transcripción de la fixture es de la tarea `1.2.0`, sin `unitsScale`:
  // fijar sus versiones mantiene los hashes, como una corrida guardada.
  taskVersion: "employee-equity-1.2.0",
  promptVersion: "employee-equity-prompt-1.3.0",
  policyVersion: "employee-equity-policy-1.1.0",
  // La propuesta de la fixture se leyó con `1.0.0`; fijarla mantiene sus hashes.
  extractVersion: "sec-10k-equity-compensation-1.0.0",
  respondedModel: "fixture/synthetic",
  evidenceSha256: computeContentHash(DEMO_EQUITY_NOTE),
  transcription: {
    decision: "proposed",
    scale: "thousands",
    optionsStatus: "outstanding",
    optionsCount: "300",
    optionsCountQuote: "Outstanding at December 31, 2024 300 $9.00",
    optionsStrike: "$9.00",
    optionsStrikeQuote: "Outstanding at December 31, 2024 300 $9.00",
    optionsLifeBasis: "remaining_years",
    optionsLife: "4.0",
    optionsLifeQuote:
      "weighted average remaining contractual life of 4.0 years",
    optionsRanges: [],
    unitsStatus: "outstanding",
    units: [
      {
        kind: "restricted",
        count: "200",
        quote: "Balance at December 31, 2024 200",
      },
    ],
    confidence: "high",
    rationale: "Synthetic year-end balances.",
    abstainReason: null,
  },
};

const DEMO_OPTION_MARKET: EmployeeOptionMarket = {
  price: {
    value: "14",
    marketDate: DEMO_VALUATION_AS_OF,
    currency: "USD",
    sourceId: DEMO_SOURCE_ID,
  },
  volatility: {
    formulaVersion: EQUITY_VOLATILITY_FORMULA_VERSION,
    value: "0.3",
    windowStart: "2020-06-30",
    baseDate: "2020-06-30",
    returns: 1256,
  },
  dividendYield: {
    version: DIVIDEND_YIELD_VERSION,
    value: "0",
    dividends: "0",
    from: "2024-06-30",
    to: DEMO_VALUATION_AS_OF,
  },
};

const DEMO_EMPLOYEE_EQUITY_DERIVED = deriveEmployeeEquity({
  decision: DEMO_EMPLOYEE_EQUITY_DECISION,
  sharesOutstanding: SHARES_OUTSTANDING,
  market: DEMO_OPTION_MARKET,
  riskFree: DEMO_COST_OF_CAPITAL.derived.riskFree,
});

const BRIDGE = {
  excessCash: {
    status: "reported" as const,
    amount: monetary({
      value: "12000000",
      asOf: "2024-12-31",
      availableAt: FY2024_AVAILABLE_AT,
      sourceDocumentId: CAPITAL_STRUCTURE_DOCUMENT,
    }),
    rationale: null,
  },
  nonOperatingAssets: declaredAbsent(
    "FixtureCo no reporta activos no operativos separables en FY2024.",
  ),
  debt: {
    status: "reported" as const,
    amount: monetary({
      value: "30000000",
      asOf: "2024-12-31",
      availableAt: FY2024_AVAILABLE_AT,
      sourceDocumentId: CAPITAL_STRUCTURE_DOCUMENT,
    }),
    rationale: null,
  },
  leaseDebt: declaredAbsent(
    "FixtureCo es dueña de sus plantas y no reporta arrendamientos operativos en FY2024.",
  ),
  minorityInterest: declaredAbsent(
    "FixtureCo consolida sin participaciones no controlantes.",
  ),
  otherClaims: declaredAbsent(
    "No hay claims preferentes declaradas en FY2024.",
  ),
  employeeOptions: {
    status: "reported" as const,
    amount: monetary({
      value: DEMO_EMPLOYEE_EQUITY_DERIVED.options!.totalValue,
      asOf: DEMO_VALUATION_AS_OF,
      availableAt: FY2024_AVAILABLE_AT,
      sourceDocumentId: EQUITY_NOTE_DOCUMENT,
    }),
    rationale: null,
  },
};

/**
 * La capitalización de FixtureCo (`F4-01`): EBIT reportado, sin arrendamientos
 * ni I+D publicados. Los dos quedan sin capitalizar con su motivo, así que el
 * valor por acción no cambia; el puente existe y el motor lo recalcula.
 */
function buildDemoCapitalization(baseRevenue: string) {
  return buildCapitalization(
    {
      baseFiscalYearEnd: "2024-12-31",
      reportedEbit: monetary({
        value: "17280000",
        asOf: "2024-12-31",
        availableAt: FY2024_AVAILABLE_AT,
        sourceDocumentId: FY2024_DOCUMENT,
      }),
      leases: {
        totalLiability: null,
        currentLiability: null,
        noncurrentLiability: null,
      },
      researchAndDevelopment: { fiscalYears: [] },
    },
    {
      baseRevenue,
      industryKey: DEMO_COST_OF_CAPITAL.industryKey,
      preTaxCostOfDebt: DEMO_COST_OF_CAPITAL.derived.preTaxCostOfDebt,
    },
  );
}

/**
 * La normalización de FixtureCo (`F4-03`): la deuda y la caja del puente salen
 * de su balance sintético —deuda de largo plazo y caja—, con un patrimonio que
 * no participa del valor por acción. No publica impuestos ni cargos, así que
 * la tasa del año base es la marginal y ningún cargo se revierte: el valor por
 * acción no cambia; el libro existe y el motor lo recalcula.
 */
function buildDemoNormalization(baseRevenue: {
  value: string;
  availableAt: string;
  sourceDocumentId: string;
}) {
  const fact = (value: string, concept: string) => ({
    ...monetary({
      value,
      asOf: "2024-12-31",
      availableAt: FY2024_AVAILABLE_AT,
      sourceDocumentId: CAPITAL_STRUCTURE_DOCUMENT,
    }),
    concept: `us-gaap:${concept}`,
  });

  return buildNormalization(
    {
      baseFiscalYearEnd: "2024-12-31",
      income: {
        pretaxIncome: null,
        incomeTax: null,
        shareBasedCompensation: null,
      },
      balance: {
        equity: fact("70000000", "StockholdersEquity"),
        minorityInterest: null,
        cash: fact("12000000", "CashAndCashEquivalentsAtCarryingValue"),
        liquidInvestments: null,
        marketableSecuritiesNoncurrent: null,
        debt: {
          longTermTotal: fact("30000000", "LongTermDebt"),
          longTermNoncurrent: null,
          longTermCurrent: null,
          currentTotal: null,
          shortTermBorrowings: null,
          commercialPaper: null,
          financeLeases: null,
        },
      },
      chargeHistory: [
        {
          fiscalYearEnd: "2024-12-31",
          revenue: {
            ...monetary({
              value: baseRevenue.value,
              asOf: "2024-12-31",
              availableAt: baseRevenue.availableAt,
              sourceDocumentId: baseRevenue.sourceDocumentId,
            }),
            concept: "us-gaap:Revenues",
          },
          restructuring: null,
          impairment: null,
        },
      ],
    },
    {
      baseRevenue: baseRevenue.value,
      marginalTaxRate: marginalTaxRateOf(DEMO_COST_OF_CAPITAL),
      capitalization: buildDemoCapitalization(baseRevenue.value),
    },
  );
}

function buildInput(baseRevenue: {
  value: string;
  availableAt: string;
  sourceDocumentId: string;
  qualityFlags?: readonly string[];
  knownAt: string;
}): ValuationInput {
  return valuationInputSchema.parse({
    subject: {
      legalEntityId: DEMO_IDENTITY_IDS.fixtureCoEntity,
      securityId: DEMO_IDENTITY_IDS.fixtureCoClassA,
      listingId: DEMO_IDENTITY_IDS.fixtureCoXnasListing,
      depositaryProgramId: DEMO_IDENTITY_IDS.cedearProgram,
    },
    asOf: DEMO_VALUATION_AS_OF,
    currency: "USD",
    knowledge: {
      effectiveAt: `${DEMO_VALUATION_AS_OF}T00:00:00.000Z`,
      revisionPolicy: "as_known",
      knownAt: baseRevenue.knownAt,
      knowledgeBasis: "public_availability",
      adjustmentPolicy: "as_known",
      sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
    },
    assetProfile: "non_financial_mature",
    assessment: DEMO_VALUATION_ASSESSMENT,
    costOfCapital: DEMO_COST_OF_CAPITAL,
    failureRisk: {
      version: FAILURE_RISK_VERSION,
      basis: "rating_table",
      horizonYears: 10,
      syntheticRating: DEMO_COST_OF_CAPITAL.derived.syntheticRating,
      parameter: {
        datasetId: "damodaran.failure-rates",
        releaseId: "e0000000-0000-4000-8000-000000000099",
        rowKey: "aaa",
        field: "year_10",
        value: "0",
        publishedLabel: "Synthetic fixture",
        availableAt: baseRevenue.availableAt,
        recordedAt: baseRevenue.availableAt,
      },
    },
    qualitativeDecisions: DEMO_QUALITATIVE_DECISIONS,
    capitalization: buildDemoCapitalization(baseRevenue.value),
    normalization: buildDemoNormalization(baseRevenue),
    method: VALUATION_METHOD,
    engineVersion: ENGINE_VERSION,
    methodologyVersion: METHODOLOGY_VERSION,
    decimalPolicy: DECIMAL_POLICY,
    baseRevenue: monetary({
      value: baseRevenue.value,
      asOf: "2024-12-31",
      availableAt: baseRevenue.availableAt,
      sourceDocumentId: baseRevenue.sourceDocumentId,
      qualityFlags: baseRevenue.qualityFlags,
    }),
    periods: EXPLICIT_PERIODS,
    reinvestmentConventionBridge: null,
    terminal: {
      growth: "0.02",
      ebitMargin: "0.18",
      taxRate: "0.25",
      // Mismo costo de capital que los períodos explícitos: así el caso base es
      // una celda de su propia grilla de sensibilidad y la tabla no contradice
      // al número principal. Un WACC que converge es de Fase 4.
      wacc: "0.09",
      returnOnCapital: "0.12",
    },
    bridge: BRIDGE,
    employeeEquity: {
      version: EMPLOYEE_EQUITY_CLAIM_VERSION,
      decision: DEMO_EMPLOYEE_EQUITY_DECISION,
      sharesOutstanding: SHARES_OUTSTANDING,
      market: DEMO_OPTION_MARKET,
      derived: DEMO_EMPLOYEE_EQUITY_DERIVED,
    },
    sensitivity: {
      // Un rango deliberadamente ancho: las celdas donde el modelo no está
      // definido deben verse, no desaparecer.
      wacc: { from: "0.03", to: "0.11", step: "0.02" },
      terminalGrowth: { from: "0", to: "0.04", step: "0.01" },
    },
    scenarios: DEMO_SCENARIOS,
  });
}

/**
 * Snapshot vigente: usa el revenue FY2024 **enmendado**, conocible desde el
 * 2025-05-01, tal como lo devuelve una consulta `as_known(2025-06-01)`.
 */
export const DEMO_VALUATION_INPUT: ValuationInput = buildInput({
  value: "96000000",
  availableAt: FY2024_AMENDMENT_AVAILABLE_AT,
  sourceDocumentId: FY2024_AMENDMENT_DOCUMENT,
  qualityFlags: ["restated_by_source"],
  knownAt: "2025-06-01T00:00:00.000Z",
});

/**
 * El mismo modelo con el corte de conocimiento anterior a la enmienda. Prueba
 * que la valuación hereda el contrato point-in-time: en marzo de 2025 el revenue
 * defendible era `100000000` y la corrida resultante es otra, con otro hash
 * (`TM-06`).
 */
export const DEMO_VALUATION_INPUT_BEFORE_AMENDMENT: ValuationInput = buildInput(
  {
    value: "100000000",
    availableAt: FY2024_AVAILABLE_AT,
    sourceDocumentId: FY2024_DOCUMENT,
    knownAt: "2025-03-01T00:00:00.000Z",
  },
);

/** Clave con la que la fuente sintética nombra al sujeto valuado. */
export const DEMO_VALUATION_SUBJECT_KEY = DEMO_SUBJECT_KEY;
