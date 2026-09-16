import { z } from "zod";

import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";

import { classifyIpAddress } from "./ip-address-policy";

/**
 * Autorización de una URL de salida contra la allowlist, como convención
 * versionada.
 *
 * El threat model pide que los adaptadores reciban «IDs o dominios aprobados, no
 * URL arbitraria» (`TM-08`). Acá eso es estructural: no existe una función que
 * tome una URL sola. Toda salida se autoriza contra la entrada de allowlist de
 * **una** fuente, y la entrada empareja host con prefijos de path, porque los
 * dos hosts de la SEC no sirven los mismos recursos.
 *
 * La allowlist concede alcanzabilidad, no permiso. Que un host esté acá no
 * significa que se pueda ingerir de él: eso lo decide el gate de derechos del
 * registro de fuentes, que corre antes y por separado (`TM-15`). Son dos
 * controles a propósito —uno responde «¿a dónde se puede abrir un socket?» y el
 * otro «¿tenemos derecho a estos datos?»— y ninguno cubre al otro.
 */
export const EGRESS_POLICY_VERSION = "egress-policy-1.0.0";

export const egressRejectionCodeSchema = z.enum([
  "source_not_allowlisted",
  "url_unparsable",
  "url_too_long",
  "scheme_not_https",
  "url_contains_credentials",
  "port_not_allowed",
  "host_is_ip_literal",
  "host_not_allowlisted",
  "path_not_allowlisted",
  "user_agent_missing",
  "address_unresolvable",
  "address_not_publicly_routable",
  "redirect_without_location",
  "too_many_redirects",
  "response_too_large",
  "deadline_exceeded",
  "transport_error",
]);

export type EgressRejectionCode = z.infer<typeof egressRejectionCodeSchema>;

/**
 * Error de salida bloqueada. Conserva un código cerrado y auditable y nunca el
 * detalle que lo produjo: el mensaje se arma con origen y path, jamás con la
 * query, que es donde viajaría una key (`TM-02`).
 */
export class EgressBlockedError extends Error {
  readonly code: EgressRejectionCode;
  /** Descripción segura del destino: `https://host/path`, sin query ni fragmento. */
  readonly target: string;

  constructor(code: EgressRejectionCode, target: string, detail?: string) {
    super(
      detail === undefined
        ? `Egress blocked (${code}) for "${target}".`
        : `Egress blocked (${code}) for "${target}": ${detail}.`,
    );
    this.name = "EgressBlockedError";
    this.code = code;
    this.target = target;
  }
}

/** Un host de allowlist: minúsculas, sin puerto, sin punto final, ya en punycode. */
const allowlistHostSchema = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u,
    "An allowlisted host must be a lowercase, punycode, dotted hostname.",
  );

const pathPrefixSchema = z
  .string()
  .min(1)
  .max(256)
  .startsWith("/")
  .refine((value) => !value.includes(".."), {
    message: "A path prefix must not contain a traversal segment.",
  });

export const egressOriginSchema = z.object({
  host: allowlistHostSchema,
  /** Prefijos exactos. Un recurso fuera de todos ellos no se pide. */
  pathPrefixes: z.array(pathPrefixSchema).min(1).max(16),
});

export type EgressOrigin = z.infer<typeof egressOriginSchema>;

export const MAX_EGRESS_URL_LENGTH = 2048;

export const egressAllowlistEntrySchema = z.object({
  sourceId: sourceIdSchema,
  origins: z.array(egressOriginSchema).min(1).max(8),
  /** Techo de bytes leídos del cuerpo; se corta el stream, no se lee y descarta. */
  maxResponseBytes: z
    .number()
    .int()
    .min(1024)
    .max(64 * 1024 * 1024),
  /** Presupuesto de tiempo de la operación completa, redirects incluidos. */
  deadlineMs: z.number().int().min(1000).max(120_000),
  maxRedirects: z.number().int().min(0).max(5),
});

export type EgressAllowlistEntry = z.infer<typeof egressAllowlistEntrySchema>;

export type EgressAuthorization =
  | {
      readonly allowed: true;
      /** URL normalizada que se va a pedir, ya validada. */
      readonly url: URL;
      /** Origen y path, sin query: lo único que puede aparecer en un log. */
      readonly target: string;
    }
  | { readonly allowed: false; readonly code: EgressRejectionCode };

/**
 * Nombre de host comparable: minúsculas y sin el punto raíz final. `WWW.SEC.GOV.`
 * y `www.sec.gov` son el mismo host y ninguna de las dos formas debe poder
 * esquivar la comparación.
 *
 * No se hace ninguna otra normalización. `URL` ya entrega el host en punycode,
 * así que un nombre con caracteres unicode llega acá como `xn--…` y simplemente
 * no coincide con ninguna entrada.
 */
function normalizeHost(hostname: string): string {
  const lowercase = hostname.toLowerCase();

  return lowercase.endsWith(".") ? lowercase.slice(0, -1) : lowercase;
}

export function describeEgressTarget(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/**
 * Autoriza una URL contra una entrada de allowlist. Devuelve un resultado en vez
 * de lanzar porque el llamador la usa dos veces: para la URL pedida y para cada
 * redirect, y el segundo caso necesita distinguir el código.
 */
export function authorizeEgressUrl(
  rawUrl: string,
  entry: EgressAllowlistEntry,
): EgressAuthorization {
  if (rawUrl.length > MAX_EGRESS_URL_LENGTH) {
    return { allowed: false, code: "url_too_long" };
  }

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, code: "url_unparsable" };
  }

  if (url.protocol !== "https:") {
    return { allowed: false, code: "scheme_not_https" };
  }

  // `https://www.sec.gov@attacker.example/` parsea con host `attacker.example`.
  // No hay fuente aprobada que use credenciales en la URL, así que su presencia
  // sólo puede ser un intento de confundir a un lector humano.
  if (url.username !== "" || url.password !== "") {
    return { allowed: false, code: "url_contains_credentials" };
  }

  // `URL` deja `port` vacío cuando es el default del esquema. Cualquier puerto
  // explícito distinto de 443 apunta a otro servicio del mismo nombre.
  if (url.port !== "" && url.port !== "443") {
    return { allowed: false, code: "port_not_allowed" };
  }

  const host = normalizeHost(url.hostname);

  // Un literal IP como host saltea el punto donde se validan las direcciones:
  // no hay resolución que interceptar. Las fuentes aprobadas se nombran, no se
  // numeran.
  if (
    url.hostname.startsWith("[") ||
    classifyIpAddress(host).category !== "unparsable"
  ) {
    return { allowed: false, code: "host_is_ip_literal" };
  }

  const origin = entry.origins.find((candidate) => candidate.host === host);

  if (origin === undefined) {
    return { allowed: false, code: "host_not_allowlisted" };
  }

  // `url.pathname` ya viene resuelto y normalizado por `URL`: `/a/../../etc` se
  // colapsa antes de compararse, así que el prefijo no se puede esquivar con
  // segmentos relativos. Se compara sobre esa forma, nunca sobre el texto crudo.
  const path = url.pathname;

  if (!origin.pathPrefixes.some((prefix) => path.startsWith(prefix))) {
    return { allowed: false, code: "path_not_allowlisted" };
  }

  return { allowed: true, url, target: describeEgressTarget(url) };
}
