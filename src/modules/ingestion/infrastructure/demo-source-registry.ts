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
const SOY_RIGHTS_REVIEWED_AT = "2026-11-04T00:00:00.000Z";
const SOY_RIGHTS_REVIEW_DUE_AT = "2027-02-04T00:00:00.000Z";

/** Fecha en que el owner revisó y aprobó las rights rows de Fase 2. */
const RIGHTS_REVIEWED_AT = "2026-09-05T00:00:00.000Z";

/**
 * Revisión de la capa IA ([ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md)):
 * las dos fuentes nuevas y el `aiTransfer` de `sec-edgar`, que no tenía
 * receptor hasta entonces. Es la tercera revisión de `sec-edgar`; la segunda,
 * el 2026-09-18, fue la que pedía congelar extractos reales
 * ([ADR 0023](../../../../docs/architecture/adr/0023-frozen-sec-extracts-rights.md)).
 */
const AI_LAYER_RIGHTS_REVIEWED_AT = "2026-10-02T00:00:00.000Z";
const AI_LAYER_RIGHTS_REVIEW_DUE_AT = "2027-04-01T00:00:00.000Z";

/**
 * Schwab (ADR 0076). El 2026-11-13 se leyeron los términos del sitio de
 * desarrolladores, que prohíben acceder **al sitio** con herramientas
 * automatizadas y no hablan de la API. El acuerdo que rige la API (Developer
 * Program Agreement) no se encontró publicado fuera del login y no se leyó. El
 * owner aceptó el riesgo ese día para un uso acotado: leer su propia cuenta,
 * de forma automatizada, y guardarla normalizada. Por eso `owner_accepted` y no
 * `allowed`: nadie lo concedió por escrito. El payload crudo, la exhibición
 * pública, el export y la transferencia a IA quedan `restricted`.
 */
const SCHWAB_RECORDED_AT = "2026-11-13T00:00:00.000Z";
const SCHWAB_RIGHTS_REVIEW_DUE_AT = "2027-05-13T00:00:00.000Z";

function schwabSource(input: {
  sourceId: string;
  displayName: string;
  datasets: string[];
  endpoints: string[];
  rateLimit: string;
  expectedCadence: string;
  ownerNotes: string;
}): SourceRegistryEntry {
  return sourceRegistryEntrySchema.parse({
    ...input,
    owner: "Charles Schwab & Co., Inc.",
    canonicalUrl: "https://developer.schwab.com/",
    documentationUrls: [
      "https://developer.schwab.com/products/trader-api--individual",
      "https://developer.schwab.com/terms-and-conditions",
    ],
    authentication: "account",
    applicablePlan: "Trader API – Individual, app del owner con Order Limit 0",
    attribution: null,
    freshnessTarget:
      "al momento del request; nada se presenta como vigente sin su hora",
    timezone: "America/New_York",
    units: [],
    currencies: ["USD"],
    parserVersion: null,
    fixturePolicy:
      "Fixtures sintéticas; ninguna respuesta de la cuenta del owner en el repositorio.",
    fallbackSourceIds: [],
    rights: {
      personalUse: "owner_accepted",
      automatedAccess: "owner_accepted",
      rawStorage: "restricted",
      normalizedStorage: "owner_accepted",
      derivedStorage: "owner_accepted",
      publicDisplay: "restricted",
      export: "restricted",
      aiTransfer: "restricted",
    },
    technicalStatus: "spike_ready",
    approvalStatus: "approved_personal",
    reviewedAt: SCHWAB_RECORDED_AT,
    rightsReviewedAt: SCHWAB_RECORDED_AT,
    rightsReviewDueAt: SCHWAB_RIGHTS_REVIEW_DUE_AT,
    reviewEvidence: [
      "docs/architecture/adr/0076-schwab-read-only-account-trading-journal.md",
      "https://developer.schwab.com/terms-and-conditions",
    ],
    retentionClasses: ["R3"],
    quotaPolicyId: null,
    recordedAt: SCHWAB_RECORDED_AT,
  });
}

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
        // F5-03: el documento principal del último 10-K, del que salen las
        // secciones dirigidas que se le mandan a un modelo (ADR 0033).
        "sec.annual-report-documents",
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
        // Mandar un extracto a un modelo es copiarlo, y la SEC autoriza copiar
        // con cita. Se contestó cuando apareció el receptor (ADR 0033).
        aiTransfer: "allowed",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-09-14T00:00:00.000Z",
      rightsReviewedAt: AI_LAYER_RIGHTS_REVIEWED_AT,
      rightsReviewDueAt: null,
      reviewEvidence: [
        "docs/data/source-registry.md#sec-edgar",
        "docs/architecture/adr/0023-frozen-sec-extracts-rights.md",
        "docs/architecture/adr/0033-ai-layer-industry-resolution.md",
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
        // El paquete publica PDDL 1.0: permite reutilización y exportación.
        export: "allowed",
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
        "https://www.comafi.com.ar/custodiaglobal/Multimedios/otros/14779.xlsx",
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
      datasets: [
        "yahoo.daily-close",
        "yahoo.benchmark-close",
        // Patas de los pares ADR del CCL implícito (ADR 0068).
        "yahoo.adr-pair-close",
        // Contrato más cercano de soja de CBOT, `ZS=F` (ADR 0071).
        "yahoo.futures-close",
      ],
      endpoints: ["https://query1.finance.yahoo.com/v8/finance/chart/"],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; el tope diario es interno",
      attribution: "Yahoo Finance",
      expectedCadence: "EOD a mano, nunca programado",
      freshnessTarget: "cierre del día de mercado anterior",
      timezone: "America/New_York",
      units: ["US cents/bushel"],
      // `USX`: centavos de dólar, como Yahoo cotiza los granos de CBOT.
      currencies: ["USD", "USX"],
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
    schwabSource({
      sourceId: "schwab-oauth",
      displayName: "Schwab — OAuth de la Trader API",
      datasets: ["schwab.oauth-token"],
      endpoints: ["https://api.schwabapi.com/v1/oauth/token"],
      rateLimit: "sin cuota publicada; 100 requests/día internos",
      expectedCadence: "al conectar y cada 30 minutos de uso",
      ownerNotes:
        "Sólo canjea el código y renueva el access token. Los tokens se guardan cifrados en la base de trading y nunca en claro.",
    }),
    schwabSource({
      sourceId: "schwab-trader",
      displayName: "Schwab — cuentas (Trader API)",
      datasets: ["schwab.accounts", "schwab.transactions"],
      endpoints: ["https://api.schwabapi.com/trader/v1/accounts"],
      rateLimit:
        "120 requests/minuto según fuentes secundarias; 1.000 requests/día internos",
      expectedCadence: "al abrir la cuenta o el diario",
      ownerNotes:
        "Sólo GET: posiciones, saldos, órdenes abiertas y transacciones. Nunca órdenes (ADR 0076, sección 2).",
    }),
    schwabSource({
      sourceId: "schwab-marketdata",
      displayName: "Schwab — market data (Trader API)",
      datasets: [
        "schwab.quotes",
        "schwab.price-history",
        "schwab.market-hours",
      ],
      endpoints: [
        "https://api.schwabapi.com/marketdata/v1/quotes",
        "https://api.schwabapi.com/marketdata/v1/pricehistory",
        "https://api.schwabapi.com/marketdata/v1/markets",
      ],
      rateLimit:
        "120 requests/minuto según fuentes secundarias; 1.000 requests/día internos",
      expectedCadence: "sólo con la página visible y posiciones abiertas",
      ownerNotes:
        "Cotizaciones y velas se muestran y no se guardan (ADR 0076, sección 8).",
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "damodaran-current-data",
      displayName: "Damodaran Online — datos actuales",
      owner: "Aswath Damodaran (NYU Stern)",
      canonicalUrl:
        "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html",
      documentationUrls: [
        "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/guide.html",
        "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html",
        "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/spreadsh.htm",
      ],
      datasets: [
        "damodaran.betas-us",
        "damodaran.country-risk",
        "damodaran.country-risk-regions",
        "damodaran.implied-erp",
        "damodaran.synthetic-ratings",
        "damodaran.failure-rates",
        "damodaran.eva-us",
        "damodaran.margins-us",
      ],
      endpoints: [
        "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/Betas.html",
        "https://pages.stern.nyu.edu/~adamodar/pc/datasets/ctrypremJuly26.xlsx",
        "https://pages.stern.nyu.edu/~adamodar/pc/fcffsimpleginzu.xlsx",
        "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histimpl.html",
        "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ratings.html",
        "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/EVA.html",
        "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/margin.html",
      ],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; el tope diario es interno",
      attribution: "Aswath Damodaran, Damodaran Online (NYU Stern)",
      expectedCadence:
        "a mano, al publicarse la actualización anual de enero y la de riesgo país de julio",
      freshnessTarget: "la última release publicada al correr",
      timezone: "America/New_York",
      units: [],
      currencies: ["USD"],
      parserVersion: "damodaran-html-1.1.0",
      fixturePolicy:
        "Fixture sintética: los términos no permiten redistribuir los datos, así que ninguna página capturada entra al repositorio.",
      fallbackSourceIds: [],
      /**
       * Los términos (guide.html, leídos el 2026-10-02) autorizan el uso «as part
       * of your regular occupation or research» con atribución y prohíben
       * revender los datos. No dicen nada de descargarlos con un programa: eso
       * lo decidió el owner (`owner_accepted`), acotado a las rutas declaradas, una
       * request cada una y nunca crawling (ADR 0032).
       */
      rights: {
        personalUse: "allowed",
        automatedAccess: "owner_accepted",
        // Se normaliza y se descarta: la página nunca se guarda ni se commitea.
        rawStorage: "restricted",
        normalizedStorage: "allowed",
        derivedStorage: "allowed",
        publicDisplay: "restricted",
        export: "allowed",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-10-20T00:00:00.000Z",
      rightsReviewedAt: "2026-10-20T00:00:00.000Z",
      rightsReviewDueAt: "2027-01-31T00:00:00.000Z",
      reviewEvidence: [
        "docs/architecture/adr/0032-damodaran-reference-datasets.md",
        "docs/architecture/adr/0040-failure-probability-employee-options.md",
        "docs/data/provider-use-matrix.md",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "ADR 0032/0034: owner_accepted acotado para descarga de betas, riesgo país, ERP y rating sintético. ADR 0040: F4-05 agrega únicamente fcffsimpleginzu.xlsx para su tabla de fracaso. Una request por URL, a mano; se guardan filas normalizadas con atribución, nunca páginas ni libros.",
      recordedAt: "2026-10-20T00:00:00.000Z",
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "indec-api",
      displayName: "INDEC — Catálogo API-INDEC",
      owner: "Instituto Nacional de Estadística y Censos",
      canonicalUrl: "https://api.indec.gob.ar/",
      documentationUrls: [
        "https://api.indec.gob.ar/docs",
        "https://api.indec.gob.ar/ayuda/faq",
        "https://api.indec.gob.ar/ayuda/terminos",
      ],
      datasets: ["indec.service-rows"],
      endpoints: ["https://api.indec.gob.ar/v1/{servicio}"],
      authentication: "api_key",
      applicablePlan: "cuenta gratuita con token JWT de 12 meses",
      rateLimit:
        "límites por tipo de cuenta según la FAQ, no publicados; 60 requests/día internos",
      attribution: "Fuente: INDEC, con el servicio de datos consultado",
      expectedCadence: "a mano; servicios mensuales declarados",
      freshnessTarget: "última publicación de cada servicio",
      timezone: "America/Argentina/Buenos_Aires",
      units: [
        "Índice 2004=100",
        "Número índice",
        "Numero índice",
        "Unidad",
        "Pesos argentinos",
        "Dólares",
      ],
      currencies: ["USD", "ARS"],
      parserVersion: "indec-api-1.2.0",
      fixturePolicy:
        "Fixtures sintéticas de filas por servicio; ninguna respuesta real en el repositorio.",
      fallbackSourceIds: ["argentina-series-tiempo"],
      rights: {
        personalUse: "allowed",
        automatedAccess: "allowed",
        rawStorage: "restricted",
        normalizedStorage: "allowed",
        derivedStorage: "allowed",
        publicDisplay: "allowed",
        export: "allowed",
        aiTransfer: "restricted",
      },
      technicalStatus: "spike_ready",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-11-03T00:00:00.000Z",
      rightsReviewedAt: "2026-11-03T00:00:00.000Z",
      rightsReviewDueAt: "2027-05-03T00:00:00.000Z",
      reviewEvidence: [
        "docs/architecture/adr/0069-argentina-activity-fiscal-external.md",
        "docs/data/provider-use-matrix.md",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "El portal permite copiar, reutilizar o redistribuir citando la fuente primaria. El owner registró su cuenta el 2026-11-03; el token vence a los 12 meses y se rota a mano. No se guarda la respuesta cruda.",
      recordedAt: "2026-11-03T00:00:00.000Z",
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "argentina-series-tiempo",
      displayName: "Argentina — API de Series de Tiempo",
      owner: "Administración Pública Nacional",
      canonicalUrl:
        "https://www.argentina.gob.ar/datos-abiertos/api-series-de-tiempo",
      documentationUrls: [
        "https://www.argentina.gob.ar/datos-abiertos/api-series-de-tiempo",
        "https://www.argentina.gob.ar/node/427984",
        "https://datos.gob.ar/dataset/sspm-estimador-mensual-actividad-economica-emae-base-2004",
        "https://datos.gob.ar/dataset/sspm-intercambio-comercial-argentino",
      ],
      datasets: ["argentina.series-observations"],
      endpoints: ["https://apis.datos.gob.ar/series/api/series/?ids={id}"],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; 30 requests/min y 50/día internos",
      attribution: "Datos Argentina; fuente primaria INDEC",
      expectedCadence: "a mano; cinco series mensuales declaradas",
      freshnessTarget: "última publicación de cada serie",
      timezone: "America/Argentina/Buenos_Aires",
      units: ["Índice 2004=100", "Millones de dólares"],
      currencies: ["USD"],
      parserVersion: "argentina-series-api-1.0.0",
      fixturePolicy:
        "Fixtures sintéticas del sobre y las filas; ninguna captura real en el repositorio.",
      fallbackSourceIds: [],
      rights: {
        personalUse: "allowed",
        automatedAccess: "allowed",
        rawStorage: "restricted",
        normalizedStorage: "allowed",
        derivedStorage: "allowed",
        publicDisplay: "restricted",
        export: "allowed",
        aiTransfer: "restricted",
      },
      technicalStatus: "spike_ready",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-11-03T00:00:00.000Z",
      rightsReviewedAt: "2026-11-03T00:00:00.000Z",
      rightsReviewDueAt: "2027-05-03T00:00:00.000Z",
      reviewEvidence: [
        "docs/architecture/adr/0069-argentina-activity-fiscal-external.md",
        "docs/data/provider-use-matrix.md",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Aprobado por el owner el 2026-11-03 para los datasets CC BY 4.0 declarados, uso personal con atribución y persistencia normalizada. Fiscal vigente requiere otra fuente.",
      recordedAt: "2026-11-03T00:00:00.000Z",
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "bcra-itcrm-xlsx",
      displayName: "BCRA — ITCRM histórico diario",
      owner: "Banco Central de la República Argentina",
      canonicalUrl:
        "https://www.bcra.gob.ar/indices-de-tipo-de-cambio-multilateral/",
      documentationUrls: [
        "https://www.bcra.gob.ar/indices-de-tipo-de-cambio-multilateral/",
        "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/TCRMMetodologia.pdf",
        "https://www.bcra.gob.ar/aviso-legal/",
      ],
      datasets: ["bcra.itcrm-daily"],
      endpoints: [
        "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/itcrm-serie.xlsx",
      ],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; 10 descargas por día internas",
      attribution: "Banco Central de la República Argentina (BCRA)",
      expectedCadence: "descarga manual de la historia diaria",
      freshnessTarget: "última publicación al correr",
      timezone: "America/Argentina/Buenos_Aires",
      units: ["Índice 17-12-2015=100"],
      currencies: [],
      parserVersion: "bcra-itcrm-xlsx-1.0.0",
      fixturePolicy:
        "Fixture XLSX sintética con forma observada; el libro real no se guarda en Git.",
      fallbackSourceIds: [],
      rights: {
        personalUse: "allowed",
        automatedAccess: "owner_accepted",
        rawStorage: "restricted",
        normalizedStorage: "allowed",
        derivedStorage: "allowed",
        publicDisplay: "restricted",
        export: "restricted",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-11-12T00:00:00.000Z",
      rightsReviewedAt: "2026-11-12T00:00:00.000Z",
      rightsReviewDueAt: "2027-05-12T00:00:00.000Z",
      reviewEvidence: [
        "docs/architecture/adr/0074-bcra-itcrm-history.md",
        "docs/data/provider-use-matrix.md",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Sitio BCRA: reutilización informativa no comercial con atribución. El archivo se descarta tras normalizar la columna ITCRM; revisión observada al descargar. No se exporta el libro ni se sirve en una URL pública.",
      recordedAt: "2026-11-12T00:00:00.000Z",
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "bcra-rem-release",
      displayName: "BCRA — edición mensual del REM",
      owner: "Banco Central de la República Argentina",
      canonicalUrl:
        "https://www.bcra.gob.ar/relevamiento-expectativas-mercado-rem/",
      documentationUrls: [
        "https://www.bcra.gob.ar/aviso-legal/",
        "https://www.bcra.gob.ar/relevamiento-expectativas-mercado-rem/",
      ],
      datasets: ["bcra.rem-monthly-inflation"],
      endpoints: [
        "https://www.bcra.gob.ar/publicaciones/relevamiento-de-expectativas-de-mercado-rem-octubre-de-2026/",
        "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-tablas-2026-10.xlsx",
      ],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; 10 requests/día internas",
      attribution: "Banco Central de la República Argentina (BCRA)",
      expectedCadence: "una edición mensual; ingesta manual",
      freshnessTarget: "edición declarada",
      timezone: "America/Argentina/Buenos_Aires",
      units: ["variación porcentual mensual del IPC nacional"],
      currencies: [],
      parserVersion: "bcra-rem-page-xlsx-1.0.0",
      fixturePolicy:
        "Fixture sintética de página y XLSX; no guardar los originales en Git.",
      fallbackSourceIds: [],
      rights: {
        personalUse: "allowed",
        automatedAccess: "owner_accepted",
        rawStorage: "restricted",
        normalizedStorage: "allowed",
        derivedStorage: "restricted",
        publicDisplay: "restricted",
        export: "restricted",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-11-13T00:00:00.000Z",
      rightsReviewedAt: "2026-11-13T00:00:00.000Z",
      rightsReviewDueAt: "2027-05-13T00:00:00.000Z",
      reviewEvidence: [
        "docs/architecture/adr/0075-bcra-rem-release-forecasts.md",
        "docs/data/provider-use-matrix.md",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Owner aprobó el 2026-11-13 uso personal, dos requests por edición y persistencia exclusiva de medianas normalizadas. Sin raw, export, demo pública, derivados almacenados ni IA; atribución BCRA.",
      recordedAt: "2026-11-13T00:00:00.000Z",
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "bcra-monetarias-v4",
      displayName: "BCRA — Estadísticas Monetarias v4",
      owner: "Banco Central de la República Argentina",
      canonicalUrl: "https://www.bcra.gob.ar/apis-banco-central/",
      documentationUrls: [
        "https://www.bcra.gob.ar/apis-banco-central/",
        "https://www.bcra.gob.ar/archivos/Catalogo/Content/files/pdf/principales-variables-v4.pdf",
        "https://www.bcra.gob.ar/aviso-legal/",
      ],
      datasets: ["bcra.monetary-catalog", "bcra.monetary-observations"],
      endpoints: [
        "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias",
        "https://api.bcra.gob.ar/estadisticas/v4.0/Metodologia",
        "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/{idVariable}",
      ],
      authentication: "none",
      applicablePlan: null,
      rateLimit:
        "control de tráfico por IP sin cifra publicada; el ritmo (30/min) y el tope diario son internos",
      attribution: "Banco Central de la República Argentina (BCRA)",
      expectedCadence: "a mano: el catálogo y luego el set declarado",
      freshnessTarget: "la última publicación al correr",
      timezone: "America/Argentina/Buenos_Aires",
      units: [],
      currencies: ["ARS", "USD"],
      parserVersion: "bcra-monetarias-v4-1.0.0",
      fixturePolicy:
        "Fixture sintética: ninguna respuesta real entra al repositorio; los valores y las descripciones de los tests son inventados.",
      fallbackSourceIds: [],
      /**
       * El aviso legal —el mismo que la página de APIs enlaza para cada API, y
       * que nombra los datos provistos por API en su punto 6— permite reutilizar
       * con fines informativos, educativos o académicos citando al BCRA, sin
       * alterar contexto y sin fin comercial. La página de APIs las ofrece para
       * integrarlas de forma automatizada. Leídos el 2026-11-02; decisión del
       * owner del mismo día (ADR 0065).
       */
      rights: {
        personalUse: "allowed",
        automatedAccess: "allowed",
        // Se normaliza y se descarta: la respuesta nunca se guarda ni se commitea.
        rawStorage: "restricted",
        normalizedStorage: "allowed",
        derivedStorage: "allowed",
        publicDisplay: "restricted",
        export: "allowed",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-11-02T00:00:00.000Z",
      rightsReviewedAt: "2026-11-02T00:00:00.000Z",
      rightsReviewDueAt: "2027-05-01T00:00:00.000Z",
      reviewEvidence: [
        "docs/architecture/adr/0065-bcra-monetary-catalog-vintages.md",
        "docs/data/provider-use-matrix.md",
      ],
      retentionClasses: ["R2", "R3"],
      quotaPolicyId: null,
      ownerNotes:
        "ADR 0065: catálogo y metodología completos; observaciones sólo del set declarado (35 Principales Variables), historia completa la primera vez y una página por serie después. Uso comercial requiere autorización del BCRA.",
      recordedAt: "2026-11-02T00:00:00.000Z",
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "bcra-cambiarias-v1",
      displayName: "BCRA — Estadísticas Cambiarias v1",
      owner: "Banco Central de la República Argentina",
      canonicalUrl: "https://www.bcra.gob.ar/apis-banco-central/",
      documentationUrls: [
        "https://www.bcra.gob.ar/apis-banco-central/",
        "https://www.bcra.gob.ar/archivos/Catalogo/Content/files/pdf/estadisticascambiarias-v1.pdf",
        "https://www.bcra.gob.ar/aviso-legal/",
      ],
      datasets: ["bcra.fx-currencies", "bcra.fx-quotes"],
      endpoints: [
        "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Maestros/Divisas",
        "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/{moneda}",
      ],
      authentication: "none",
      applicablePlan: null,
      rateLimit:
        "control de tráfico por IP sin cifra publicada; el ritmo (30/min) y el tope diario son internos",
      attribution: "Banco Central de la República Argentina (BCRA)",
      expectedCadence: "a mano: el maestro y las monedas declaradas",
      freshnessTarget: "la última publicación al correr",
      timezone: "America/Argentina/Buenos_Aires",
      units: [],
      currencies: ["ARS", "USD", "EUR", "BRL", "CNY"],
      parserVersion: "bcra-cambiarias-v1-1.0.0",
      fixturePolicy:
        "Fixture sintética: ninguna respuesta real entra al repositorio; las cotizaciones de los tests son inventadas.",
      fallbackSourceIds: [],
      /**
       * El mismo aviso legal que Estadísticas Monetarias: la página de APIs lo
       * enlaza para cada API y su punto 6 nombra los datos provistos por API.
       * Mismos derechos que `bcra-monetarias-v4`, decisión del owner del
       * 2026-11-03 (ADR 0067).
       */
      rights: {
        personalUse: "allowed",
        automatedAccess: "allowed",
        rawStorage: "restricted",
        normalizedStorage: "allowed",
        derivedStorage: "allowed",
        publicDisplay: "restricted",
        export: "allowed",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: "2026-11-03T00:00:00.000Z",
      rightsReviewedAt: "2026-11-03T00:00:00.000Z",
      rightsReviewDueAt: "2027-05-01T00:00:00.000Z",
      reviewEvidence: [
        "docs/architecture/adr/0067-bcra-official-fx-quotes.md",
        "docs/data/provider-use-matrix.md",
      ],
      retentionClasses: ["R2", "R3"],
      quotaPolicyId: null,
      ownerNotes:
        "ADR 0067: cotizaciones diarias publicadas por el BCRA de USD, EUR, BRL y CNY desde 1992, historia completa la primera vez y una página por moneda después. Uso comercial requiere autorización del BCRA.",
      recordedAt: "2026-11-03T00:00:00.000Z",
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "openrouter",
      displayName: "OpenRouter",
      owner: "OpenRouter, Inc.",
      canonicalUrl: "https://openrouter.ai/docs/api/reference/overview",
      documentationUrls: [
        "https://openrouter.ai/docs/guides/features/zdr",
        "https://openrouter.ai/docs/guides/privacy/data-collection",
        "https://openrouter.ai/docs/guides/routing/provider-selection",
        "https://openrouter.ai/docs/guides/features/structured-outputs",
        "https://openrouter.ai/terms",
      ],
      datasets: ["openrouter.chat-completions"],
      endpoints: ["https://openrouter.ai/api/v1/chat/completions"],
      authentication: "api_key",
      applicablePlan: "pago por uso con crédito prepago en la cuenta del owner",
      rateLimit: "según el crédito de la cuenta; el tope diario es interno",
      attribution: null,
      expectedCadence: "a demanda, por tarea pedida a mano",
      freshnessTarget: "no aplica: produce propuestas, no series",
      timezone: null,
      units: [],
      currencies: ["USD"],
      parserVersion: "openrouter-chat-1.0.0",
      fixturePolicy:
        "Dobles de test sintéticos: ninguna respuesta real de un modelo entra al repositorio.",
      fallbackSourceIds: [],
      /**
       * La API existe para ser llamada por programa, y la cuenta es del owner.
       * Lo que se guarda —la propuesta estructurada y su motivo— no lo concede
       * nadie: lo decidió el owner (ADR 0033). La fila no recibe datos: decide
       * qué se le manda el armado del prompt, contra el `aiTransfer` de cada
       * fuente de origen.
       */
      rights: {
        personalUse: "allowed",
        automatedAccess: "allowed",
        rawStorage: "owner_accepted",
        normalizedStorage: "owner_accepted",
        derivedStorage: "owner_accepted",
        publicDisplay: "unknown",
        export: "unknown",
        aiTransfer: "unknown",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: AI_LAYER_RIGHTS_REVIEWED_AT,
      rightsReviewedAt: AI_LAYER_RIGHTS_REVIEWED_AT,
      rightsReviewDueAt: AI_LAYER_RIGHTS_REVIEW_DUE_AT,
      reviewEvidence: [
        "docs/architecture/adr/0033-ai-layer-industry-resolution.md",
        "docs/data/provider-use-matrix.md#openrouter",
      ],
      retentionClasses: ["R4"],
      quotaPolicyId: null,
      ownerNotes:
        "Decisión del owner del 2026-10-02. Cada request fija ZDR, data_collection=deny, require_parameters y el precio máximo del escalón; ninguno se relaja por entorno. Gasto acotado en USD por tarea y por día, además del límite de crédito de la clave. Integrada el 2026-10-15: los tres escalones contestaron la tarea de humo bajo ZDR por USD 0,000538 en total.",
      recordedAt: AI_LAYER_RIGHTS_REVIEWED_AT,
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "tavily",
      displayName: "Tavily Search API",
      owner: "Tavily",
      canonicalUrl:
        "https://docs.tavily.com/documentation/api-reference/endpoint/search",
      documentationUrls: [
        "https://docs.tavily.com/documentation/api-credits",
        "https://docs.tavily.com/documentation/rate-limits",
        "https://www.tavily.com/terms",
        "https://www.tavily.com/privacy",
      ],
      datasets: ["tavily.search"],
      endpoints: ["https://api.tavily.com/search"],
      authentication: "api_key",
      applicablePlan: "Researcher gratuito: 1.000 créditos por mes",
      rateLimit: "100 requests/min en desarrollo; el tope diario es interno",
      attribution: null,
      expectedCadence: "a demanda, sólo cuando el 10-K no alcanzó",
      freshnessTarget: "no aplica: evidencia puntual de una tarea",
      timezone: null,
      units: [],
      currencies: [],
      parserVersion: null,
      fixturePolicy:
        "Dobles de test sintéticos: ningún resultado real de búsqueda entra al repositorio.",
      fallbackSourceIds: [],
      /**
       * Los términos (leídos el 2026-10-02) no prohíben conservar el resultado
       * ni exigen atribución; permiten a Tavily entrenar con las consultas
       * (§9.2), y por eso una consulta lleva sólo datos públicos. Se guarda el
       * extracto citado, nunca la página.
       */
      rights: {
        personalUse: "allowed",
        automatedAccess: "allowed",
        rawStorage: "restricted",
        normalizedStorage: "owner_accepted",
        derivedStorage: "owner_accepted",
        publicDisplay: "unknown",
        export: "unknown",
        aiTransfer: "owner_accepted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: AI_LAYER_RIGHTS_REVIEWED_AT,
      rightsReviewedAt: AI_LAYER_RIGHTS_REVIEWED_AT,
      rightsReviewDueAt: AI_LAYER_RIGHTS_REVIEW_DUE_AT,
      reviewEvidence: [
        "docs/architecture/adr/0033-ai-layer-industry-resolution.md",
        "docs/data/provider-use-matrix.md#tavily",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Decisión del owner del 2026-10-02: búsqueda básica en el plan gratuito, sólo como segunda evidencia. Brave se descartó porque sus términos prohíben almacenar resultados y evaluar modelos con ellos.",
      recordedAt: AI_LAYER_RIGHTS_REVIEWED_AT,
    }),
    /**
     * Fuentes de la soja (ADR 0071). Tres sin concesión: la Cámara Arbitral no
     * publica términos, el BNA admite la descarga «para uso personal y privado»
     * y prohíbe reproducir, y Estimaciones Agrícolas no declara licencia aunque
     * su serie se publique CC BY 4.0 una campaña atrás. El owner decidió
     * proceder el 2026-11-04 porque el portal es personal; nada se muestra en
     * público ni se exporta, y el payload no se guarda.
     */
    sourceRegistryEntrySchema.parse({
      sourceId: "bcr-cac-pizarra",
      displayName:
        "Bolsa de Comercio de Rosario — pizarra de la Cámara Arbitral",
      owner: "Bolsa de Comercio de Rosario",
      canonicalUrl: "https://www.cac.bcr.com.ar/es/precios-de-pizarra",
      documentationUrls: [
        "https://www.cac.bcr.com.ar/es/precios-de-pizarra",
        "https://www.cac.bcr.com.ar/es/precios-de-pizarra/consultas",
      ],
      datasets: ["bcr-cac.pizarra"],
      endpoints: ["https://www.cac.bcr.com.ar/es/api/prices/987/export"],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; el tope diario es interno",
      attribution: "Cámara Arbitral de Cereales, Bolsa de Comercio de Rosario",
      expectedCadence: "al abrir la página, una vez por día hábil",
      freshnessTarget: "pizarra del último día hábil",
      timezone: "America/Argentina/Buenos_Aires",
      units: ["$/Tn"],
      currencies: ["ARS"],
      parserVersion: "bcr-cac-pizarra-1.0.0",
      fixturePolicy:
        "Fixture sintética: sin términos que autoricen almacenar la planilla, ningún archivo capturado entra al repositorio.",
      fallbackSourceIds: [],
      rights: {
        personalUse: "owner_accepted",
        automatedAccess: "owner_accepted",
        rawStorage: "restricted",
        normalizedStorage: "owner_accepted",
        derivedStorage: "owner_accepted",
        publicDisplay: "restricted",
        export: "restricted",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: SOY_RIGHTS_REVIEWED_AT,
      rightsReviewedAt: SOY_RIGHTS_REVIEWED_AT,
      rightsReviewDueAt: SOY_RIGHTS_REVIEW_DUE_AT,
      reviewEvidence: [
        "docs/architecture/adr/0071-soy-basis-sources.md",
        "docs/data/provider-use-matrix.md#soja",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Decisión del owner del 2026-11-04 sobre evidencia: el sitio dice «Todos los derechos reservados» y no publica condiciones de uso. Es la referencia del mercado físico de Rosario; se guardan precios normalizados y nunca la planilla.",
      recordedAt: SOY_RIGHTS_REVIEWED_AT,
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "bna-fx",
      displayName: "Banco de la Nación Argentina — cotizaciones",
      owner: "Banco de la Nación Argentina",
      canonicalUrl: "https://www.bna.com.ar/Cotizador/MonedasHistorico",
      documentationUrls: [
        "https://www.bna.com.ar/Cotizador/MonedasHistorico",
        "https://www.bna.com.ar/Home/TerminosYCondiciones",
      ],
      datasets: ["bna.divisas"],
      endpoints: ["https://www.bna.com.ar/Cotizador/DescargarPorFecha"],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; el tope diario es interno",
      attribution: "Banco de la Nación Argentina",
      expectedCadence: "al abrir la página, una vez por día hábil",
      freshnessTarget: "cierre del último día hábil",
      timezone: "America/Argentina/Buenos_Aires",
      units: ["Pesos por dólar"],
      currencies: ["ARS", "USD"],
      parserVersion: "bna-divisas-1.0.0",
      fixturePolicy:
        "Fixture sintética: los términos prohíben reproducir el contenido, así que ningún CSV capturado entra al repositorio.",
      fallbackSourceIds: [],
      rights: {
        personalUse: "owner_accepted",
        automatedAccess: "owner_accepted",
        rawStorage: "restricted",
        normalizedStorage: "owner_accepted",
        derivedStorage: "owner_accepted",
        publicDisplay: "restricted",
        export: "restricted",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: SOY_RIGHTS_REVIEWED_AT,
      rightsReviewedAt: SOY_RIGHTS_REVIEWED_AT,
      rightsReviewDueAt: SOY_RIGHTS_REVIEW_DUE_AT,
      reviewEvidence: [
        "docs/architecture/adr/0071-soy-basis-sources.md",
        "docs/data/provider-use-matrix.md#soja",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Decisión del owner del 2026-11-04 sobre evidencia: los términos permiten descargar «para uso personal y privado» y prohíben reproducir, modificar o transmitir sin autorización escrita. Es el dólar con el que la Cámara Arbitral convierte su pizarra; la cotización del BCRA no lo reemplaza.",
      recordedAt: SOY_RIGHTS_REVIEWED_AT,
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "magyp-estimaciones",
      displayName: "Ministerio de Agricultura — Estimaciones Agrícolas",
      owner: "Ministerio de Agricultura, Ganadería y Pesca",
      canonicalUrl:
        "https://datosestimaciones.magyp.gob.ar/reportes.php?reporte=Estimaciones",
      documentationUrls: [
        "https://datosestimaciones.magyp.gob.ar/reportes.php?reporte=Estimaciones",
        "https://datos.magyp.gob.ar/dataset/soja-siembra-cosecha-produccion-rendimiento",
      ],
      datasets: ["magyp.estimaciones"],
      endpoints: [
        "https://datosestimaciones.magyp.gob.ar/reportes.php?reporte=Estimaciones",
      ],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; el tope diario es interno",
      attribution:
        "Dirección de Estimaciones Agrícolas, Ministerio de Agricultura, Ganadería y Pesca",
      expectedCadence: "al abrir la página, una vez por día",
      freshnessTarget: "última actualización de la campaña en curso",
      timezone: "America/Argentina/Buenos_Aires",
      units: ["ha", "t", "kg/ha"],
      currencies: [],
      parserVersion: "magyp-estimaciones-1.0.0",
      fixturePolicy:
        "Fixtures sintéticas con la forma del CSV; ninguna captura real en el repositorio.",
      fallbackSourceIds: ["magyp-datos-abiertos"],
      rights: {
        personalUse: "owner_accepted",
        automatedAccess: "owner_accepted",
        rawStorage: "restricted",
        normalizedStorage: "owner_accepted",
        derivedStorage: "owner_accepted",
        publicDisplay: "restricted",
        export: "restricted",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: SOY_RIGHTS_REVIEWED_AT,
      rightsReviewedAt: SOY_RIGHTS_REVIEWED_AT,
      rightsReviewDueAt: SOY_RIGHTS_REVIEW_DUE_AT,
      reviewEvidence: [
        "docs/architecture/adr/0071-soy-basis-sources.md",
        "docs/data/provider-use-matrix.md#soja",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "Decisión del owner del 2026-11-04: el sitio no declara licencia; la misma serie, de la misma dirección, se publica CC BY 4.0 en datos.magyp.gob.ar hasta la campaña anterior, y cada corrida la concilia contra ese archivo.",
      recordedAt: SOY_RIGHTS_REVIEWED_AT,
    }),
    sourceRegistryEntrySchema.parse({
      sourceId: "magyp-datos-abiertos",
      displayName: "Ministerio de Agricultura — datos abiertos",
      owner: "Ministerio de Agricultura, Ganadería y Pesca",
      canonicalUrl:
        "https://datos.magyp.gob.ar/dataset/soja-siembra-cosecha-produccion-rendimiento",
      documentationUrls: [
        "https://datos.magyp.gob.ar/dataset/soja-siembra-cosecha-produccion-rendimiento",
      ],
      datasets: ["magyp.annual-csv"],
      endpoints: [
        "https://datos.magyp.gob.ar/dataset/8ae4865f-d2f2-45a2-9343-7a4a12728a90/resource/3bfe4630-91e2-46cd-82ad-cf8dc94d3dfb/download/soja-serie-1941-2024-anual.csv",
      ],
      authentication: "none",
      applicablePlan: null,
      rateLimit: "sin cuota publicada; el tope diario es interno",
      attribution:
        "Ministerio de Agricultura, Ganadería y Pesca — Dirección Nacional de Agricultura (CC BY 4.0)",
      expectedCadence: "con cada corrida de Estimaciones, para conciliar",
      freshnessTarget: "última campaña cerrada",
      timezone: "America/Argentina/Buenos_Aires",
      units: ["ha", "t", "kg/ha"],
      currencies: [],
      parserVersion: "magyp-annual-csv-1.0.0",
      fixturePolicy:
        "Fixtures sintéticas con la forma del CSV; ninguna captura real en el repositorio.",
      fallbackSourceIds: [],
      rights: {
        personalUse: "allowed",
        automatedAccess: "allowed",
        rawStorage: "restricted",
        normalizedStorage: "allowed",
        derivedStorage: "allowed",
        publicDisplay: "restricted",
        export: "allowed",
        aiTransfer: "restricted",
      },
      technicalStatus: "integrated",
      approvalStatus: "approved_personal",
      reviewedAt: SOY_RIGHTS_REVIEWED_AT,
      rightsReviewedAt: SOY_RIGHTS_REVIEWED_AT,
      rightsReviewDueAt: SOY_RIGHTS_REVIEW_DUE_AT,
      reviewEvidence: [
        "docs/architecture/adr/0071-soy-basis-sources.md",
        "docs/data/provider-use-matrix.md#soja",
      ],
      retentionClasses: ["R3"],
      quotaPolicyId: null,
      ownerNotes:
        "CC BY 4.0 declarada en el dataset (2026-11-04). Sólo se usa para conciliar Estimaciones; no se guarda como serie propia.",
      recordedAt: SOY_RIGHTS_REVIEWED_AT,
    }),
  ]);
