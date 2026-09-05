import {
  sourceRegistryEntrySchema,
  type SourceRegistryEntry,
} from "@/modules/ingestion/domain/source-registry-entry";

import {
  DEMO_DATASETS,
  DEMO_INGESTION_FIXTURE_VERSION,
  DEMO_PARSER_VERSION,
  DEMO_SOURCE_ID,
} from "./demo-ingestion-fixtures";

const RECORDED_AT = "2026-08-23T00:00:00.000Z";

/** Fecha en que el owner revisó y aprobó las rights rows de Fase 2. */
const RIGHTS_REVIEWED_AT = "2026-09-05T00:00:00.000Z";

/**
 * Registro de fuentes del modo demo.
 *
 * Cada fila lleva su estado honesto, porque el registro existe justamente para que
 * una fuente sin revisión falle cerrada en vez de ingerirse por descuido
 * (`TM-15`).
 *
 * Desde el 2026-09-05 hay dos filas aprobadas por el owner —`sec-edgar` y
 * `datahub-sp500-pddl`, las que constituyen el universo— y el resto sigue sin
 * derechos revisados. Aprobar una fila **no** la vuelve alcanzable: el destino lo
 * decide por separado la allowlist de egress
 * ([ADR 0009](../../../../docs/architecture/adr/0009-egress-boundary.md)), y
 * `alpaca-market-data` es el caso que lo muestra en el otro sentido.
 *
 * Cada aprobación concede sólo los derechos que su adaptador usa: el payload
 * descargado no se conserva, así que `rawStorage` sigue en `unknown` a propósito.
 */
export const DEMO_SOURCE_REGISTRY: readonly SourceRegistryEntry[] =
  Object.freeze([
    sourceRegistryEntrySchema.parse({
      sourceId: DEMO_SOURCE_ID,
      displayName: "Fixture sintética FixtureCo",
      owner: "Portal Financiero",
      canonicalUrl: "https://fixtures.invalid/fixture-demo-fundamentals",
      documentationUrls: [],
      datasets: Object.values(DEMO_DATASETS),
      endpoints: [],
      authentication: "none",
      applicablePlan: null,
      rateLimit: null,
      attribution: null,
      expectedCadence: "estática; sólo cambia con la versión de la fixture",
      freshnessTarget: "no aplica: la fixture no representa datos vigentes",
      timezone: "UTC",
      units: ["monetary", "shares"],
      currencies: ["USD"],
      parserVersion: DEMO_PARSER_VERSION,
      fixturePolicy: `Datos sintéticos versionados (${DEMO_INGESTION_FIXTURE_VERSION}) sobre una empresa inexistente; no derivan de ningún payload live y cada dataset ejercita un caso del contrato: completo, parcial, vacío, parser roto y fuente caída.`,
      fallbackSourceIds: [],
      rights: {
        personalUse: "allowed",
        automatedAccess: "allowed",
        rawStorage: "allowed",
        normalizedStorage: "allowed",
        derivedStorage: "allowed",
        publicDisplay: "allowed",
        export: "allowed",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_public_demo",
      reviewedAt: RECORDED_AT,
      rightsReviewedAt: RECORDED_AT,
      rightsReviewDueAt: null,
      reviewEvidence: [
        "src/modules/ingestion/infrastructure/demo-ingestion-fixtures.ts",
        "docs/data/source-registry.md#fixtures-y-modo-demo",
      ],
      retentionClasses: ["R0"],
      quotaPolicyId: null,
      ownerNotes:
        "Fuente propia del repositorio. No representa una capacidad disponible ni una integración real.",
      recordedAt: RECORDED_AT,
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "sec-edgar",
      displayName: "SEC EDGAR",
      owner: "U.S. Securities and Exchange Commission",
      canonicalUrl:
        "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
      documentationUrls: [
        "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
        "https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data",
      ],
      datasets: ["sec.submissions", "sec.companyfacts", "sec.frames"],
      endpoints: [],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "Fair Access de la SEC; requiere User-Agent responsable",
      attribution: null,
      expectedCadence: "diaria con bulk nocturno",
      freshnessTarget: "pendiente de definir junto al gate de Fase 2",
      timezone: "America/New_York",
      units: [],
      currencies: [],
      parserVersion: null,
      fixturePolicy:
        "Sin fixture: los extractos reales congelados llegan en `F2-06`; el payload descargado no se conserva.",
      fallbackSourceIds: [],
      rights: {
        personalUse: "allowed",
        automatedAccess: "allowed",
        // El universo se persiste normalizado y derivado; el payload descargado
        // no se conserva, así que `rawStorage` sigue sin revisar a propósito.
        rawStorage: "unknown",
        normalizedStorage: "allowed",
        derivedStorage: "allowed",
        publicDisplay: "unknown",
        export: "unknown",
        aiTransfer: "unknown",
      },
      technicalStatus: "spike_ready",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-08-21T00:00:00.000Z",
      rightsReviewedAt: RIGHTS_REVIEWED_AT,
      rightsReviewDueAt: null,
      reviewEvidence: [
        "docs/data/source-registry.md#sec-edgar",
        "docs/data/provider-use-matrix.md",
        "docs/architecture/adr/0009-egress-boundary.md",
      ],
      retentionClasses: ["R2", "R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Aprobada por el owner el 2026-09-05 para uso personal automatizado: acceso público sin key, sujeto a Fair Access y a un User-Agent con contacto real, que el runtime exige por configuración. El ritmo de las llamadas (2 req/s, concurrencia 1) todavía no está implementado: es `TM-10` y llega con `F2-05`.",
      recordedAt: RECORDED_AT,
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "datahub-sp500-pddl",
      displayName: "DataHub — S&P 500 companies (PDDL)",
      owner: "Open Knowledge Foundation / datasets",
      canonicalUrl: "https://github.com/datasets/s-and-p-500-companies",
      documentationUrls: [
        "https://github.com/datasets/s-and-p-500-companies",
        "https://opendatacommons.org/licenses/pddl/",
      ],
      datasets: ["sp500.constituents"],
      endpoints: [],
      authentication: "none",
      applicablePlan: null,
      rateLimit: null,
      attribution: "PDDL 1.0; upstream operativo es Wikipedia",
      expectedCadence: "sin cadencia declarada; cambia por commit del paquete",
      freshnessTarget: "revisión mensual o manual; nunca polling frecuente",
      timezone: null,
      units: [],
      currencies: [],
      parserVersion: null,
      fixturePolicy:
        "Sin fixture: el corpus sintético de `F2-02` cubre el contrato y no deriva de este archivo.",
      fallbackSourceIds: [],
      rights: {
        personalUse: "allowed",
        automatedAccess: "allowed",
        rawStorage: "unknown",
        normalizedStorage: "allowed",
        derivedStorage: "allowed",
        publicDisplay: "unknown",
        export: "unknown",
        aiTransfer: "unknown",
      },
      technicalStatus: "spike_ready",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-08-21T00:00:00.000Z",
      rightsReviewedAt: RIGHTS_REVIEWED_AT,
      rightsReviewDueAt: null,
      reviewEvidence: [
        "docs/data/source-registry.md#identidad-y-mercados",
        "docs/data/provider-use-matrix.md",
        "docs/architecture/adr/0009-egress-boundary.md",
      ],
      retentionClasses: ["R2", "R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Aprobada por el owner el 2026-09-05 bajo PDDL 1.0 para el paquete publicado. Sigue siendo universo de desarrollo y no prueba de membresía oficial: su fuente operativa es Wikipedia, así que no arbitra identidad y su columna CIK no se lee. Exige pin por commit, que el adaptador hace cumplir.",
      recordedAt: RECORDED_AT,
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "caja-valores-cedear",
      displayName: "Caja de Valores — CEDEAR",
      owner: "Caja de Valores S.A.",
      canonicalUrl: "https://cajadevalores.com.ar/Servicios/Cedears",
      documentationUrls: ["https://cajadevalores.com.ar/Servicios/Cedears"],
      datasets: ["cedear.programs"],
      endpoints: [],
      authentication: "none",
      applicablePlan: null,
      rateLimit: null,
      attribution: null,
      expectedCadence: "publicación sin cadencia declarada",
      freshnessTarget: "pendiente de definir junto al gate de Fase 2",
      timezone: "America/Argentina/Buenos_Aires",
      units: [],
      currencies: [],
      parserVersion: null,
      fixturePolicy:
        "Sin fixture: la vista publicada no sustituye un historial y todavía no hay derechos revisados.",
      fallbackSourceIds: [],
      rights: {},
      technicalStatus: "technical_reviewed",
      approvalStatus: "rights_review_pending",
      reviewedAt: "2026-08-21T00:00:00.000Z",
      rightsReviewedAt: null,
      rightsReviewDueAt: null,
      reviewEvidence: ["docs/data/source-registry.md#cedear-y-universo"],
      retentionClasses: [],
      quotaPolicyId: null,
      ownerNotes:
        "Candidata de Fase 2. Falta método oficial y automatizable para historizar cambios de ratio.",
      recordedAt: RECORDED_AT,
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "alpaca-market-data",
      displayName: "Alpaca Market Data",
      owner: "Alpaca Securities LLC",
      canonicalUrl: "https://docs.alpaca.markets/us/docs/about-market-data-api",
      documentationUrls: [
        "https://docs.alpaca.markets/us/docs/about-market-data-api",
        "https://docs.alpaca.markets/us/reference/stockbarsingle-1",
      ],
      datasets: ["alpaca.stock-bars"],
      endpoints: [],
      authentication: "api_key",
      applicablePlan: "Trading API Basic (sin confirmar para este uso)",
      rateLimit: "200 llamadas históricas por minuto según el plan publicado",
      attribution: null,
      expectedCadence: "EOD en el modo personal",
      freshnessTarget: "pendiente de definir junto al gate de Fase 2",
      timezone: "America/New_York",
      units: [],
      currencies: [],
      parserVersion: null,
      fixturePolicy:
        "Sin fixture: no se conservan barras reales mientras la retención del plan no esté revisada.",
      fallbackSourceIds: [],
      rights: {},
      technicalStatus: "technical_reviewed",
      approvalStatus: "rights_review_pending",
      reviewedAt: "2026-08-21T00:00:00.000Z",
      rightsReviewedAt: null,
      rightsReviewDueAt: null,
      reviewEvidence: ["docs/data/source-registry.md#alpaca"],
      retentionClasses: [],
      quotaPolicyId: null,
      ownerNotes:
        "Candidata de Fase 2 y sólo para modo personal. El default `iex` del endpoint no prueba entitlement de la cuenta.",
      recordedAt: RECORDED_AT,
    }),
  ]);
