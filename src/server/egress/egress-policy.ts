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
export const EGRESS_POLICY_VERSION = "egress-policy-1.1.0";

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
  "method_not_allowed",
  "request_body_too_large",
  "credential_missing",
  "credential_invalid",
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

/**
 * Método que una fuente admite. Uno solo por fuente: un buscador o un modelo se
 * consultan con `POST` y no tienen nada que pedir por `GET`, y una fuente de
 * datos se lee con `GET` y no tiene nada que recibir (ADR 0033).
 */
export const egressMethodSchema = z.enum(["GET", "POST"]);

export type EgressMethod = z.infer<typeof egressMethodSchema>;

/**
 * Con qué se presenta el cliente. La SEC exige un contacto real y lo trae la
 * configuración del owner; una fuente nueva recibe un nombre genérico del
 * proyecto, porque ese contacto no tiene por qué llegarle a un modelo.
 */
export const egressIdentificationSchema = z.enum(["owner_contact", "project"]);

export type EgressIdentification = z.infer<typeof egressIdentificationSchema>;

/**
 * Credencial de una fuente: **qué variable** la trae y **en qué header** va,
 * nunca el valor. La agrega la puerta al salir, así que un adaptador no la ve y
 * no puede mandarla a otro host (`TM-02`, `TM-08`).
 */
export const egressCredentialSchema = z.object({
  variable: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
  header: z.literal("authorization"),
  scheme: z.literal("Bearer"),
});

export type EgressCredential = z.infer<typeof egressCredentialSchema>;

export const egressAllowlistEntrySchema = z
  .object({
    sourceId: sourceIdSchema,
    origins: z.array(egressOriginSchema).min(1).max(8),
    method: egressMethodSchema.default("GET"),
    identification: egressIdentificationSchema.default("owner_contact"),
    credential: egressCredentialSchema.nullable().default(null),
    /**
     * Techo del cuerpo **del pedido**. Cero para `GET`: no manda nada. En un
     * `POST` acota lo que se le puede mandar a la fuente, que es justamente lo
     * que cuesta en un modelo.
     */
    maxRequestBytes: z
      .number()
      .int()
      .min(0)
      .max(1024 * 1024)
      .default(0),
    /** Techo de bytes leídos del cuerpo; se corta el stream, no se lee y descarta. */
    maxResponseBytes: z
      .number()
      .int()
      .min(1024)
      .max(64 * 1024 * 1024),
    /** Presupuesto de tiempo de la operación completa, redirects incluidos. */
    deadlineMs: z.number().int().min(1000).max(120_000),
    maxRedirects: z.number().int().min(0).max(5),
  })
  .superRefine((entry, context) => {
    if (entry.method === "GET" && entry.maxRequestBytes !== 0) {
      context.addIssue({
        code: "custom",
        path: ["maxRequestBytes"],
        message: "A GET source sends no body.",
      });
    }

    if (entry.method === "POST" && entry.maxRequestBytes < 1024) {
      context.addIssue({
        code: "custom",
        path: ["maxRequestBytes"],
        message: "A POST source declares a request body ceiling.",
      });
    }

    // Un redirect de un `POST` obliga a decidir si el cuerpo —y la
    // credencial— se reenvían a otro destino. La respuesta es que no hay
    // redirect que seguir.
    if (entry.method === "POST" && entry.maxRedirects !== 0) {
      context.addIssue({
        code: "custom",
        path: ["maxRedirects"],
        message: "A POST source never follows redirects.",
      });
    }
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
