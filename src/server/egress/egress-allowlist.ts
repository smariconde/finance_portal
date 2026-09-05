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
export const EGRESS_ALLOWLIST_VERSION = "egress-allowlist-1.0.0";

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
