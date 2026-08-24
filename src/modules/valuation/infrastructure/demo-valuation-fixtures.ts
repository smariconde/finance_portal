import {
  DEMO_IDENTITY_IDS,
  DEMO_SUBJECT_KEY,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import {
  DEMO_SOURCE_ID,
  FY2024_AMENDMENT_AVAILABLE_AT,
} from "@/modules/ingestion/infrastructure/demo-ingestion-fixtures";
import { DEFAULT_SOURCE_POLICY_VERSION } from "@/modules/temporal/domain/point-in-time-query";

import { DECIMAL_POLICY } from "../domain/decimal-policy";
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
export const DEMO_VALUATION_FIXTURE_VERSION = "2026-08-24.1";

export const DEMO_VALUATION_AS_OF = "2025-06-30";

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
  minorityInterest: declaredAbsent(
    "FixtureCo consolida sin participaciones no controlantes.",
  ),
  otherClaims: declaredAbsent(
    "No hay opciones vivas ni claims preferentes declaradas en FY2024.",
  ),
};

const DILUTED_SHARES = {
  value: "12500000",
  unit: "shares" as const,
  asOf: "2025-06-30",
  availableAt: "2025-07-15T12:00:00.000Z",
  sourceId: DEMO_SOURCE_ID,
  sourceDocumentId: SHARE_REGISTER_DOCUMENT,
  observationId: null,
  qualityFlags: [],
};

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
    dilutedShares: DILUTED_SHARES,
    sensitivity: {
      // Un rango deliberadamente ancho: las celdas donde el modelo no está
      // definido deben verse, no desaparecer.
      wacc: { from: "0.03", to: "0.11", step: "0.02" },
      terminalGrowth: { from: "0", to: "0.04", step: "0.01" },
    },
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
