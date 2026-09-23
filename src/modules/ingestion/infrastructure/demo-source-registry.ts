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
 * Segunda revisión de `sec-edgar`, la que pedía congelar extractos reales:
 * [ADR 0023](../../../../docs/architecture/adr/0023-frozen-sec-extracts-rights.md).
 */
const SEC_FROZEN_EXTRACTS_RIGHTS_REVIEWED_AT = "2026-09-18T00:00:00.000Z";

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
 * Cada aprobación concede sólo los derechos que su adaptador usa, y una fila se
 * revisa de nuevo recién cuando algo necesita un derecho que decía `unknown`: eso
 * le pasó a `sec-edgar` el 2026-09-18, cuando congelar extractos reales obligó a
 * contestar por `rawStorage`, `publicDisplay` y `export` (ADR 0023).
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
      datasets: [
        "sec.submissions",
        "sec.company-tickers-exchange",
        "sec.companyfacts",
        "sec.companyconcept",
        "sec.frames",
      ],
      endpoints: [],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "Fair Access de la SEC; requiere User-Agent responsable",
      attribution: null,
      expectedCadence: "diaria con bulk nocturno",
      freshnessTarget: "pendiente de definir junto al gate de Fase 2",
      timezone: "America/New_York",
      units: ["monetary", "monetary_per_share", "shares", "pure"],
      currencies: [],
      // Tres parsers leen esta fuente —tickers, submissions y companyfacts— y
      // cada corrida registra el suyo; una sola versión acá mentiría.
      parserVersion: null,
      fixturePolicy:
        "Dos oráculos: el filer sintético (`fixture-sec-filer.ts`) para los casos que el cable real no ofrece —parser roto, fuente caída, lote vacío—, y extractos reales congelados, elegidos, reducidos y con manifiesto, para el cable tal como la SEC lo publica (ADR 0023). Una ingesta del modo personal sigue sin conservar su payload.",
      fallbackSourceIds: [],
      rights: {
        personalUse: "allowed",
        automatedAccess: "allowed",
        // La SEC publica que lo que está en sec.gov es información pública y
        // puede copiarse y redistribuirse sin su permiso, pidiendo cita y sin
        // usar su sello (ADR 0023). Eso contesta los tres primeros.
        rawStorage: "allowed",
        normalizedStorage: "allowed",
        derivedStorage: "allowed",
        // Un derecho, no una superficie: mostrar datos de la fuente en una
        // superficie anónima sigue exigiendo `approved_public_demo`, y la fila
        // sigue en `approved_personal`.
        publicDisplay: "allowed",
        export: "allowed",
        // Sin revisar a propósito: no lo decide la SEC sino el receptor, y no
        // hay receptor hasta el policy engine de Fase 5.
        aiTransfer: "unknown",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-09-14T00:00:00.000Z",
      rightsReviewedAt: SEC_FROZEN_EXTRACTS_RIGHTS_REVIEWED_AT,
      rightsReviewDueAt: null,
      reviewEvidence: [
        "docs/data/source-registry.md#sec-edgar",
        "docs/architecture/adr/0023-frozen-sec-extracts-rights.md",
        "docs/data/provider-use-matrix.md",
        "docs/architecture/adr/0009-egress-boundary.md",
        "docs/architecture/adr/0010-sec-xbrl-ingestion.md",
        "src/modules/fundamentals/",
      ],
      retentionClasses: ["R2", "R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Aprobada por el owner el 2026-09-05 para uso personal automatizado: acceso público sin key, sujeto a Fair Access y a un User-Agent con contacto real, que el runtime exige por configuración. Desde el 2026-09-14 las llamadas salen de a una, a 2 req/s y con presupuesto de 1.000 por corrida; lease, reanudación y refresh por CIK cambiado siguen siendo `F2-05`.",
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
      sourceId: "comafi-cedear",
      displayName: "Banco Comafi — programas CEDEAR",
      owner: "Banco Comafi S.A.",
      canonicalUrl: "https://www.comafi.com.ar/custodiaglobal/programas.aspx",
      documentationUrls: [
        "https://www.comafi.com.ar/custodiaglobal/programas.aspx",
        "https://www.comafi.com.ar/1759-Terminos-Y-Condiciones-Legales-De-Banco-Comafi.note.aspx",
      ],
      datasets: ["comafi.cedear-programs"],
      endpoints: [
        "https://www.comafi.com.ar/custodiaglobal/json/apps/getproducts.aspx",
      ],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; el tope diario es interno",
      attribution: "Banco Comafi S.A.",
      expectedCadence: "a mano, semanal o ante un aviso del emisor",
      freshnessTarget: "la última publicación del emisor al correr",
      timezone: "America/Argentina/Buenos_Aires",
      units: [],
      currencies: [],
      parserVersion: null,
      fixturePolicy:
        "Fixture sintética: los términos del emisor prohíben almacenar su contenido, así que ningún payload capturado entra al repositorio.",
      fallbackSourceIds: [],
      /**
       * Los términos de Comafi **prohíben** almacenar su contenido, por escrito
       * y no por omisión: «Prohibida la duplicación, distribución o
       * almacenamiento en cualquier medio». `owner_accepted` dice que el owner
       * decidió proceder igual el 2026-09-23 (ADR 0027), con esa cláusula a la
       * vista; no la convierte en un permiso.
       */
      rights: {
        personalUse: "owner_accepted",
        automatedAccess: "owner_accepted",
        // Se normaliza y se descarta: el JSON del emisor nunca se guarda.
        rawStorage: "restricted",
        normalizedStorage: "owner_accepted",
        derivedStorage: "owner_accepted",
        publicDisplay: "restricted",
        export: "owner_accepted",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-09-23T00:00:00.000Z",
      rightsReviewedAt: "2026-09-23T00:00:00.000Z",
      rightsReviewDueAt: "2026-12-22T00:00:00.000Z",
      reviewEvidence: [
        "docs/architecture/adr/0027-cedear-registry-sources.md",
        "docs/data/provider-use-matrix.md#cedear",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Decisión del owner del 2026-09-23 sobre evidencia: los términos del sitio prohíben la duplicación, distribución o almacenamiento en cualquier medio. Se usa porque el registro sin Comafi no existe —emite 364 de los programas—. Se guardan hechos normalizados y nunca el payload. Publicación de registro: el JSON del sitio y no la planilla, que arrastra ratios mal escritos y valores viejos.",
      recordedAt: RECORDED_AT,
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "caja-valores-cedear",
      displayName: "Caja de Valores — CEDEAR",
      owner: "Caja de Valores S.A.",
      canonicalUrl: "https://cajadevalores.com.ar/Servicios/Cedears",
      documentationUrls: ["https://cajadevalores.com.ar/Servicios/Cedears"],
      datasets: ["cajval.cedear-programs"],
      endpoints: ["https://cajadevalores.com.ar/Servicios/Cedears"],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; el tope diario es interno",
      attribution: "Caja de Valores S.A.",
      expectedCadence: "a mano, semanal o ante un aviso del emisor",
      freshnessTarget: "la última publicación del emisor al correr",
      timezone: "America/Argentina/Buenos_Aires",
      units: [],
      currencies: [],
      parserVersion: null,
      fixturePolicy:
        "Fixture sintética: no hay términos que autoricen almacenar la página, así que ningún HTML capturado entra al repositorio.",
      fallbackSourceIds: [],
      /**
       * Caja de Valores no publica términos de uso para su sitio: no concede ni
       * prohíbe. El owner decidió usarla el 2026-09-23 (ADR 0027) porque es el
       * otro emisor autorizado por la CNV, y sin sus programas el registro diría
       * de ocho securities del índice que no tienen CEDEAR.
       */
      rights: {
        personalUse: "owner_accepted",
        automatedAccess: "owner_accepted",
        rawStorage: "restricted",
        normalizedStorage: "owner_accepted",
        derivedStorage: "owner_accepted",
        publicDisplay: "restricted",
        export: "owner_accepted",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-09-23T00:00:00.000Z",
      rightsReviewedAt: "2026-09-23T00:00:00.000Z",
      rightsReviewDueAt: "2026-12-22T00:00:00.000Z",
      reviewEvidence: [
        "docs/architecture/adr/0027-cedear-registry-sources.md",
        "docs/data/provider-use-matrix.md#cedear",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Decisión del owner del 2026-09-23 sobre evidencia: sin términos publicados, ni concesión ni prohibición. Es el segundo emisor autorizado por la CNV (59 programas) y el único de F, UAL, MU, OXY, UBER, PANW, MOS y ABNB. Se guardan hechos normalizados y nunca el HTML.",
      recordedAt: RECORDED_AT,
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "yahoo-finance",
      displayName: "Yahoo Finance (chart)",
      owner: "Yahoo",
      canonicalUrl: "https://finance.yahoo.com/",
      documentationUrls: [],
      datasets: ["yahoo.daily-close"],
      endpoints: ["https://query1.finance.yahoo.com/v8/finance/chart/"],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; el tope diario es interno",
      attribution: "Yahoo Finance",
      expectedCadence: "EOD a mano, nunca programado",
      freshnessTarget: "cierre del día de mercado anterior",
      timezone: "America/New_York",
      units: [],
      currencies: ["USD"],
      parserVersion: null,
      fixturePolicy:
        "Fixture recortada del payload real, sin conservar la respuesta completa.",
      fallbackSourceIds: [],
      /**
       * No hay concesión contractual de ninguna clase: el endpoint no está
       * documentado como API pública y los términos de Yahoo no autorizan la
       * extracción automatizada. `owner_accepted` dice exactamente eso —nadie lo
       * concede, el owner decidió proceder igual el 2026-09-22 (ADR 0026)— en vez
       * de disfrazarlo de `allowed`, que significa «una fuente primaria lo
       * cubre» y es lo que hace que el gate valga.
       */
      rights: {
        personalUse: "owner_accepted",
        automatedAccess: "owner_accepted",
        // No se guarda el payload: la serie se normaliza y se descarta.
        rawStorage: "restricted",
        normalizedStorage: "owner_accepted",
        derivedStorage: "owner_accepted",
        // Una decisión del owner asume un riesgo propio; no fabrica un derecho
        // frente a terceros. El gate lo impide aunque alguien lo intente.
        publicDisplay: "restricted",
        export: "owner_accepted",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-09-22T00:00:00.000Z",
      rightsReviewedAt: "2026-09-22T00:00:00.000Z",
      rightsReviewDueAt: "2026-12-21T00:00:00.000Z",
      reviewEvidence: [
        "docs/architecture/adr/0026-daily-prices-source.md",
        "docs/data/provider-use-matrix.md#yahoo-finance",
      ],
      retentionClasses: ["R1", "R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Decisión del owner del 2026-09-22 sobre evidencia: Tiingo gratis prohíbe persistir (ToU 1.6(a)) y Alpaca sigue en blocked_rights. Sin contrato aceptado no hay cláusula que incumplir ni cuenta que cancelar. El endpoint puede romperse sin aviso: es riesgo asumido, no mitigado.",
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
