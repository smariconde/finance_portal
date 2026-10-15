import { findEgressAllowlistEntry } from "./egress-allowlist";
import {
  authorizeEgressUrl,
  describeEgressTarget,
  EgressBlockedError,
  MAX_EGRESS_URL_LENGTH,
  type EgressAllowlistEntry,
} from "./egress-policy";
import type { EgressTransport } from "./https-transport";

/**
 * Única puerta de salida del proyecto.
 *
 * No existe una variante que acepte una URL sin fuente: el `sourceId` es el que
 * trae la allowlist, y sin entrada de allowlist no hay pedido. Un adaptador de
 * proveedor construye el path de su recurso y nada más; no elige a dónde va el
 * socket (`TM-08`).
 */
export const APPROVED_RESOURCE_CLIENT_VERSION = "egress-client-1.1.0";

/**
 * Nombre con el que se presenta el proyecto ante una fuente que no exige
 * contacto (ADR 0033). Es genérico a propósito: el contacto del owner es un
 * requisito de la SEC, no algo que tenga que llegarle a un modelo.
 */
export const EGRESS_PROJECT_USER_AGENT = "portal-financiero/1.0";

/**
 * Forma de una credencial aceptable: texto imprimible ASCII sin espacios. El
 * valor termina en un header, así que un CR o LF partiría el request.
 */
const CREDENTIAL_PATTERN = /^[\x21-\x7e]{8,512}$/u;

/** Códigos de redirect que se siguen. Un `GET` sigue siendo `GET` en los cinco. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

export type ApprovedResourceRequest = {
  readonly sourceId: string;
  readonly url: string;
  /**
   * Contacto del owner, para las fuentes que lo exigen (`owner_contact`). Sin
   * default: la Fair Access de la SEC exige un contacto real, y un default del
   * repositorio haría que todas las instancias se presentaran igual. Se lee de
   * la configuración del owner, no de una constante. Una fuente `project` lo
   * ignora.
   */
  readonly userAgent?: string | null;
  readonly accept?: string;
  /** Debe coincidir con el de la fuente; sin él es `GET`. */
  readonly method?: "GET" | "POST";
  /** Sólo en un `POST`, acotado por `maxRequestBytes` de la fuente. */
  readonly body?: Uint8Array;
  readonly contentType?: string;
};

export type ApprovedResourceResponse = {
  readonly status: number;
  readonly contentType: string | null;
  readonly retryAfter: string | null;
  readonly body: Uint8Array;
  readonly byteLength: number;
  /** Destinos recorridos, sin query: el primero es el pedido y el último el que respondió. */
  readonly chain: readonly string[];
  readonly fetchedAt: string;
};

export type FetchApprovedResourceDependencies = {
  transport: EgressTransport;
  /** Reloj de pared para la provenance; no se usa para medir el presupuesto. */
  now: () => string;
  /** Reloj monótono en milisegundos: mide el presupuesto sin saltos de hora. */
  elapsedMs: () => number;
  findEntry?: (sourceId: string) => EgressAllowlistEntry | null;
  /**
   * Lee la credencial de una fuente por el nombre que declara su entrada. Es la
   * única forma en que un valor secreto entra a un pedido, y entra acá, después
   * de autorizar el destino.
   */
  readCredential?: (variable: string) => string | undefined;
};

function authorizeOrThrow(
  rawUrl: string,
  entry: EgressAllowlistEntry,
): { url: URL; target: string } {
  const authorization = authorizeEgressUrl(rawUrl, entry);

  if (!authorization.allowed) {
    // El destino rechazado no se repite en el error: puede ser justamente la URL
    // que el atacante quería ver en un log (`TM-02`). Se nombra la fuente.
    throw new EgressBlockedError(authorization.code, entry.sourceId);
  }

  return { url: authorization.url, target: authorization.target };
}

export async function fetchApprovedResource(
  request: ApprovedResourceRequest,
  dependencies: FetchApprovedResourceDependencies,
): Promise<ApprovedResourceResponse> {
  const {
    transport,
    now,
    elapsedMs,
    findEntry = findEgressAllowlistEntry,
    readCredential = () => undefined,
  } = dependencies;

  const entry = findEntry(request.sourceId);

  if (entry === null) {
    throw new EgressBlockedError("source_not_allowlisted", request.sourceId);
  }

  const method = request.method ?? "GET";

  if (method !== entry.method) {
    throw new EgressBlockedError("method_not_allowed", entry.sourceId, method);
  }

  const body = request.body;

  if (method === "GET" && body !== undefined) {
    throw new EgressBlockedError(
      "method_not_allowed",
      entry.sourceId,
      "GET with a body",
    );
  }

  if (
    method === "POST" &&
    (body === undefined || body.byteLength > entry.maxRequestBytes)
  ) {
    throw new EgressBlockedError(
      "request_body_too_large",
      entry.sourceId,
      `limit ${entry.maxRequestBytes} bytes`,
    );
  }

  const userAgent =
    entry.identification === "project"
      ? EGRESS_PROJECT_USER_AGENT
      : (request.userAgent ?? "").trim();

  if (userAgent.length === 0) {
    throw new EgressBlockedError("user_agent_missing", entry.sourceId);
  }

  const headers: Record<string, string> = {
    "user-agent": userAgent,
    accept: request.accept ?? "application/json",
    // Sin `accept-encoding`: el techo de bytes se aplica sobre lo que se recibe,
    // y un cuerpo comprimido escondería su tamaño real detrás de la
    // descompresión.
    "accept-encoding": "identity",
    connection: "close",
  };

  if (body !== undefined) {
    headers["content-type"] = request.contentType ?? "application/json";
  }

  const startedAt = elapsedMs();
  const chain: string[] = [];
  let current = authorizeOrThrow(request.url, entry);

  // La credencial entra después de autorizar el destino, nunca antes: un pedido
  // a un host fuera de la lista no llega a leerla. El error nombra la variable,
  // jamás el valor (`TM-02`).
  if (entry.credential !== null) {
    const credential = readCredential(entry.credential.variable)?.trim() ?? "";

    if (credential.length === 0) {
      throw new EgressBlockedError(
        "credential_missing",
        entry.sourceId,
        entry.credential.variable,
      );
    }

    if (!CREDENTIAL_PATTERN.test(credential)) {
      throw new EgressBlockedError(
        "credential_invalid",
        entry.sourceId,
        entry.credential.variable,
      );
    }

    headers[entry.credential.header] =
      `${entry.credential.scheme} ${credential}`;
  }

  for (let hop = 0; hop <= entry.maxRedirects; hop += 1) {
    chain.push(current.target);

    const remainingMs = entry.deadlineMs - (elapsedMs() - startedAt);

    if (remainingMs <= 0) {
      throw new EgressBlockedError("deadline_exceeded", current.target);
    }

    const response = await transport({
      url: current.url,
      method,
      body,
      headers,
      maxResponseBytes: entry.maxResponseBytes,
      timeoutMs: remainingMs,
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return {
        status: response.status,
        contentType: response.contentType,
        retryAfter: response.retryAfter,
        body: response.body,
        byteLength: response.body.byteLength,
        chain,
        fetchedAt: now(),
      };
    }

    if (response.location === null || response.location.trim().length === 0) {
      throw new EgressBlockedError("redirect_without_location", current.target);
    }

    let next: URL;

    try {
      // Un `Location` relativo se resuelve contra el salto actual, que ya está
      // autorizado. La resolución no autoriza nada por sí sola: el destino
      // resultante vuelve a pasar por la allowlist en la próxima vuelta, así que
      // un redirect fuera del host aprobado corta la cadena.
      next = new URL(response.location, current.url);
    } catch {
      throw new EgressBlockedError("url_unparsable", current.target);
    }

    const nextUrl = next.toString();

    if (nextUrl.length > MAX_EGRESS_URL_LENGTH) {
      throw new EgressBlockedError("url_too_long", current.target);
    }

    current = authorizeOrThrow(nextUrl, entry);
  }

  throw new EgressBlockedError(
    "too_many_redirects",
    describeEgressTarget(current.url),
  );
}
