import {
  egressAllowlistEntrySchema,
  type EgressAllowlistEntry,
} from "./egress-policy";

/**
 * Allowlist de egress del proyecto: los únicos destinos a los que este runtime
 * puede abrir un socket.
 *
 * Está vacía salvo por lo que un slice entregado necesita. Agregar una fuente es
 * agregar una fila acá **y** una rights row aprobada en el registro de fuentes;
 * ninguna de las dos alcanza sola. Una fuente que no está acá no se alcanza aunque
 * sus derechos estén aprobados, y una que está acá no se ingiere si sus derechos
 * no lo están.
 *
 * Los prefijos de path son parte del control, no una comodidad. `data.sec.gov` y
 * `www.sec.gov` no sirven los mismos recursos, y acotar el path evita que un bug
 * de construcción de URL termine paseando por el sitio entero de la SEC.
 */
export const EGRESS_ALLOWLIST_VERSION = "egress-allowlist-1.2.0";

const ENTRIES: readonly EgressAllowlistEntry[] = Object.freeze([
  egressAllowlistEntrySchema.parse({
    sourceId: "sec-edgar",
    origins: [
      {
        host: "data.sec.gov",
        pathPrefixes: [
          "/api/xbrl/companyconcept/",
          "/api/xbrl/companyfacts/",
          "/api/xbrl/frames/",
          "/submissions/",
        ],
      },
      {
        host: "www.sec.gov",
        pathPrefixes: [
          "/files/company_tickers.json",
          "/files/company_tickers_exchange.json",
          // Los documentos de una presentación, para leer las secciones
          // dirigidas de un 10-K (`F5-03`, ADR 0033). El nombre del documento
          // viene de `submissions` y el localizador lo exige plano, sin barras.
          "/Archives/edgar/data/",
        ],
      },
    ],
    // `companyfacts` de un emisor grande son varios MB de JSON sin comprimir. El
    // techo deja pasar el más grande esperado y corta bastante antes de que una
    // respuesta inesperada pueda consumir la memoria del runtime.
    maxResponseBytes: 32 * 1024 * 1024,
    deadlineMs: 30_000,
    // `www.sec.gov` puede redirigir un archivo estático; `data.sec.gov` no
    // redirige. Dos saltos cubren el caso real y cortan una cadena.
    maxRedirects: 2,
  }),
  egressAllowlistEntrySchema.parse({
    sourceId: "datahub-sp500-pddl",
    origins: [
      {
        host: "raw.githubusercontent.com",
        // Sólo este dataset. `raw.githubusercontent.com` sirve el contenido de
        // todo GitHub, así que el prefijo es lo único que separa "un archivo
        // versionado del paquete PDDL" de "cualquier archivo de cualquier repo".
        pathPrefixes: ["/datasets/s-and-p-500-companies/"],
      },
      {
        // El pin exige resolver a qué commit corresponde la versión vigente, y
        // eso sólo lo dice la API. Es el mismo paquete y por eso comparte fuente
        // en vez de inventar una: lo que cambia es el host que sirve su
        // metadata, que es exactamente lo que esta lista empareja.
        host: "api.github.com",
        pathPrefixes: ["/repos/datasets/s-and-p-500-companies/commits"],
      },
    ],
    // El CSV de constituyentes son decenas de KB; el techo deja margen para que
    // crezca y corta mucho antes de que un archivo equivocado sea un problema.
    maxResponseBytes: 4 * 1024 * 1024,
    deadlineMs: 30_000,
    // El host sirve el archivo directo. Un redirect acá sería una señal, no un
    // caso a seguir.
    maxRedirects: 0,
  }),
  egressAllowlistEntrySchema.parse({
    sourceId: "yahoo-finance",
    origins: [
      {
        host: "query1.finance.yahoo.com",
        // Sólo el chart de un símbolo. El host sirve muchos otros endpoints
        // —quotes, search, screeners— y el prefijo es lo único que separa "la
        // serie diaria de una security" de "el resto de la API no contractual".
        pathPrefixes: ["/v8/finance/chart/"],
      },
    ],
    // Cinco años de cierres diarios con eventos son ~140 KB por security. El
    // techo deja margen para un símbolo con más historia y corta mucho antes de
    // que una respuesta inesperada sea un problema.
    maxResponseBytes: 8 * 1024 * 1024,
    deadlineMs: 30_000,
    // El endpoint responde directo. Un redirect acá sería una señal, no un caso
    // a seguir: puede ser la pantalla de consentimiento que Yahoo interpone.
    maxRedirects: 0,
  }),
  egressAllowlistEntrySchema.parse({
    sourceId: "comafi-cedear",
    origins: [
      {
        host: "www.comafi.com.ar",
        // Registro JSON y una planilla fija sólo para símbolos locales (ADR 0056).
        // No se abre el resto del sitio ni la banca electrónica.
        pathPrefixes: [
          "/custodiaglobal/json/apps/getproducts.aspx",
          "/custodiaglobal/Multimedios/otros/14779.xlsx",
        ],
      },
    ],
    // El registro entero son ~350 KB de JSON. El techo deja margen para que
    // crezca y corta mucho antes de que una respuesta inesperada sea un problema.
    maxResponseBytes: 4 * 1024 * 1024,
    deadlineMs: 30_000,
    maxRedirects: 0,
  }),
  egressAllowlistEntrySchema.parse({
    sourceId: "caja-valores-cedear",
    origins: [
      {
        host: "cajadevalores.com.ar",
        // Sólo la página de CEDEAR, que el servidor entrega con la tabla
        // renderizada. El resto del sitio —trámites, portal de inversores— no
        // tiene nada que este registro necesite.
        pathPrefixes: ["/Servicios/Cedears"],
      },
    ],
    // La página son ~65 KB de HTML.
    maxResponseBytes: 2 * 1024 * 1024,
    deadlineMs: 30_000,
    maxRedirects: 0,
  }),
  egressAllowlistEntrySchema.parse({
    sourceId: "damodaran-current-data",
    origins: [
      {
        host: "pages.stern.nyu.edu",
        // Los seis archivos, uno por uno: el host sirve el sitio entero de NYU
        // Stern y los directorios `datafile/` y `pc/datasets/` cientos de tablas
        // que este portal no usa. Un archivo nuevo es un diff revisable, no un
        // comodín (ADR 0032). El libro del riesgo país cambia de nombre con
        // cada actualización y su pin vive en `damodaran-datasets.ts` (ADR 0034).
        pathPrefixes: [
          "/~adamodar/New_Home_Page/datafile/Betas.html",
          "/~adamodar/pc/datasets/ctrypremJuly26.xlsx",
          "/~adamodar/pc/fcffsimpleginzu.xlsx",
          "/~adamodar/New_Home_Page/datafile/histimpl.html",
          "/~adamodar/New_Home_Page/datafile/ratings.html",
          "/~adamodar/New_Home_Page/datafile/EVA.html",
        ],
      },
    ],
    // La página más grande, la de betas, son ~460 KB de HTML exportado por Excel.
    maxResponseBytes: 4 * 1024 * 1024,
    deadlineMs: 30_000,
    maxRedirects: 0,
  }),
  egressAllowlistEntrySchema.parse({
    sourceId: "openrouter",
    origins: [
      {
        host: "openrouter.ai",
        // Sólo el chat. El modelo no tiene herramientas y no puede pedir una
        // URL: lo que lee es lo que el proyecto le manda (ADR 0033).
        pathPrefixes: ["/api/v1/chat/completions"],
      },
    ],
    method: "POST",
    identification: "project",
    credential: {
      variable: "OPENROUTER_API_KEY",
      header: "authorization",
      scheme: "Bearer",
    },
    // Una resolución con evidencia son ~25.000 tokens de entrada, unos 100 KB.
    // El techo deja el doble y es también el que acota el peor caso del gasto:
    // un byte nunca es menos que un token.
    maxRequestBytes: 256 * 1024,
    // La respuesta es un JSON chico con un schema cerrado.
    maxResponseBytes: 1024 * 1024,
    // Un modelo con 25.000 tokens de entrada puede tardar decenas de segundos
    // en contestar; más que esto ya es una falla que sube de escalón.
    deadlineMs: 90_000,
    maxRedirects: 0,
  }),
  egressAllowlistEntrySchema.parse({
    sourceId: "tavily",
    origins: [{ host: "api.tavily.com", pathPrefixes: ["/search"] }],
    method: "POST",
    identification: "project",
    credential: {
      variable: "TAVILY_API_KEY",
      header: "authorization",
      scheme: "Bearer",
    },
    // La consulta es el nombre de la empresa y las industrias candidatas.
    maxRequestBytes: 8 * 1024,
    // Hasta cinco resultados con su extracto.
    maxResponseBytes: 512 * 1024,
    deadlineMs: 30_000,
    maxRedirects: 0,
  }),
]);

const BY_SOURCE_ID: ReadonlyMap<string, EgressAllowlistEntry> = new Map(
  ENTRIES.map((entry) => [entry.sourceId, entry]),
);

/** Devuelve `null` cuando la fuente no está en la allowlist: no hay default. */
export function findEgressAllowlistEntry(
  sourceId: string,
): EgressAllowlistEntry | null {
  return BY_SOURCE_ID.get(sourceId) ?? null;
}

export function listEgressAllowlistEntries(): readonly EgressAllowlistEntry[] {
  return ENTRIES;
}
