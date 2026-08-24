/**
 * Fixtures sintéticas del modo demo.
 *
 * No derivan de ningún payload live ni de una captura de proveedor: describen a
 * `FixtureCo`, una empresa inexistente, con las formas y edge cases que el
 * contrato point-in-time exige probar (valor negativo, valor ausente por falta
 * de publicación y valor ausente por licencia). Versionadas por
 * `DEMO_INGESTION_FIXTURE_VERSION`: cambiar un registro obliga a subir la
 * versión y a regenerar los hashes esperados.
 */
export const DEMO_INGESTION_FIXTURE_VERSION = "2026-08-23.1";

export const DEMO_SOURCE_ID = "fixture-demo-fundamentals";
export const DEMO_PARSER_VERSION = "fixture-1.0.0";

export const DEMO_DATASETS = {
  annual: "demo.fundamentals.annual",
  partial: "demo.fundamentals.partial",
  empty: "demo.fundamentals.empty",
  broken: "demo.fundamentals.broken",
  unavailable: "demo.fundamentals.unavailable",
} as const;

const FY2024 = {
  periodStart: "2024-01-01",
  periodEnd: "2024-12-31",
  periodType: "annual",
} as const;

const FY2024_AVAILABLE_AT = "2025-02-20T21:00:00.000Z";
const FY2024_DOCUMENT = "fixtureco-fy2024-annual-report";

/** Lote válido completo: happy path del contrato de staging. */
export const DEMO_ANNUAL_RECORDS: readonly unknown[] = Object.freeze([
  {
    externalId: "fixtureco-2023-revenue",
    concept: "Revenues",
    subjectKey: "fixtureco",
    metricId: "revenue",
    asOf: "2023-12-31",
    periodStart: "2023-01-01",
    periodEnd: "2023-12-31",
    periodType: "annual",
    unit: "monetary",
    currency: "USD",
    rawValue: "88000000",
    rawValueStatus: "stored",
    availableAt: "2024-02-15T21:00:00.000Z",
    sourceDocumentId: "fixtureco-fy2023-annual-report",
    qualityFlags: [],
  },
  {
    externalId: "fixtureco-2024-revenue",
    concept: "Revenues",
    subjectKey: "fixtureco",
    metricId: "revenue",
    asOf: "2024-12-31",
    ...FY2024,
    unit: "monetary",
    currency: "USD",
    rawValue: "100000000",
    rawValueStatus: "stored",
    availableAt: FY2024_AVAILABLE_AT,
    sourceDocumentId: FY2024_DOCUMENT,
    qualityFlags: [],
  },
  {
    // Resultado negativo: nunca debe normalizarse a cero ni a un absoluto.
    externalId: "fixtureco-2024-net-income",
    concept: "NetIncomeLoss",
    subjectKey: "fixtureco",
    metricId: "net_income",
    asOf: "2024-12-31",
    ...FY2024,
    unit: "monetary",
    currency: "USD",
    rawValue: "-4200000",
    rawValueStatus: "stored",
    availableAt: FY2024_AVAILABLE_AT,
    sourceDocumentId: FY2024_DOCUMENT,
    qualityFlags: [],
  },
  {
    // Ausencia por falta de publicación: se conserva el hecho, no un cero.
    externalId: "fixtureco-2024-capital-expenditure",
    concept: "PaymentsToAcquirePropertyPlantAndEquipment",
    subjectKey: "fixtureco",
    metricId: "capital_expenditure",
    asOf: "2024-12-31",
    ...FY2024,
    unit: "monetary",
    currency: "USD",
    rawValue: null,
    rawValueStatus: "not_provided",
    availableAt: FY2024_AVAILABLE_AT,
    sourceDocumentId: FY2024_DOCUMENT,
    qualityFlags: ["missing_from_source"],
  },
  {
    // Ausencia por licencia: se conserva identificador y motivo (`TM-15`).
    externalId: "fixtureco-2024-shares-outstanding",
    concept: "CommonStockSharesOutstanding",
    subjectKey: "fixtureco",
    metricId: "shares_outstanding",
    asOf: "2024-12-31",
    periodStart: null,
    periodEnd: null,
    periodType: "instant",
    unit: "shares",
    currency: null,
    rawValue: null,
    rawValueStatus: "license_restricted",
    availableAt: FY2024_AVAILABLE_AT,
    sourceDocumentId: FY2024_DOCUMENT,
    qualityFlags: ["raw_withheld_by_license"],
  },
]);

/** Un registro corrupto entre válidos: el lote se acepta parcialmente. */
export const DEMO_PARTIAL_RECORDS: readonly unknown[] = Object.freeze([
  DEMO_ANNUAL_RECORDS[0],
  {
    externalId: "fixtureco-2024-revenue",
    concept: "Revenues",
    subjectKey: "fixtureco",
    metricId: "revenue",
    asOf: "2024-12-31",
    ...FY2024,
    unit: "monetary",
    currency: "USD",
    rawValue: "100000000",
    rawValueStatus: "stored",
    // `available_at` ausente: sin fecha de conocimiento no hay point-in-time.
    availableAt: null,
    sourceDocumentId: FY2024_DOCUMENT,
    qualityFlags: [],
  },
  DEMO_ANNUAL_RECORDS[2],
]);

/** Todo el lote inválido: el parser se considera roto y el lote se cuarentena. */
export const DEMO_BROKEN_RECORDS: readonly unknown[] = Object.freeze([
  {
    externalId: "fixtureco-2024-revenue",
    concept: "Revenues",
    subjectKey: "fixtureco",
    metricId: "revenue",
    asOf: "2024-12-31",
    ...FY2024,
    unit: "monetary",
    currency: "USD",
    // Valor con separadores de miles: el parser previo cambió de formato.
    rawValue: "100,000,000",
    rawValueStatus: "stored",
    availableAt: FY2024_AVAILABLE_AT,
    sourceDocumentId: FY2024_DOCUMENT,
    qualityFlags: [],
  },
  {
    externalId: "fixtureco-2024-net-income",
    concept: "NetIncomeLoss",
    subjectKey: "fixtureco",
    metricId: "net_income",
    asOf: "2024-12-31",
    ...FY2024,
    unit: "monetary",
    currency: "USD",
    // Cero silencioso donde la fuente no publicó nada.
    rawValue: "0",
    rawValueStatus: "not_provided",
    availableAt: FY2024_AVAILABLE_AT,
    sourceDocumentId: FY2024_DOCUMENT,
    qualityFlags: [],
  },
]);
