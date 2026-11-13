/**
 * A qué base apunta una URL de PostgreSQL, sin credenciales ni parámetros
 * ([ADR 0076](../../../../docs/architecture/adr/0076-schwab-read-only-account-trading-journal.md)).
 *
 * La base de trading vive aparte de la de análisis: cuota, credenciales y
 * recuperación propias. Dos URLs distintas pueden nombrar la misma base —otro
 * usuario, otro `sslmode`, el pooler de Neon en vez de la conexión directa—, así
 * que compararlas como texto no alcanza. Lo que identifica a la base es el host,
 * el puerto y su nombre.
 */
export type DatabaseTarget = {
  readonly host: string;
  readonly port: string;
  readonly database: string;
};

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const DEFAULT_POSTGRES_PORT = "5432";

/**
 * El pooler de Neon es el mismo endpoint con `-pooler` en la primera etiqueta
 * del host: `ep-x-pooler.region.aws.neon.tech` y `ep-x.region.aws.neon.tech` son
 * la misma base.
 */
function withoutNeonPooler(host: string): string {
  const [first, ...rest] = host.split(".");
  if (!first?.endsWith("-pooler")) return host;
  return [first.slice(0, -"-pooler".length), ...rest].join(".");
}

/** `null` si el valor no es una URL de PostgreSQL con host y base. */
export function parseDatabaseTarget(value: string): DatabaseTarget | null {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol)) return null;

  const host = withoutNeonPooler(url.hostname.toLowerCase());
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));

  if (host.length === 0 || database.length === 0 || database.includes("/")) {
    return null;
  }

  return { host, port: url.port || DEFAULT_POSTGRES_PORT, database };
}

/**
 * `true` si las dos URLs nombran la misma base. Una URL ilegible no se compara:
 * quien llama ya la rechazó por inválida.
 */
export function sameDatabaseTarget(left: string, right: string): boolean {
  const a = parseDatabaseTarget(left);
  const b = parseDatabaseTarget(right);

  if (!a || !b) return false;

  return a.host === b.host && a.port === b.port && a.database === b.database;
}
