import { z } from "zod";

/**
 * Identificación del cliente ante la fuente, como contrato ejecutable.
 *
 * La SEC condiciona su Fair Access a que el tráfico automatizado se presente con
 * un contacto real y responda a él. Eso no se puede satisfacer con una constante
 * del repositorio: el código es público, y un default haría que toda instancia
 * se presentara con el mismo nombre. Sale de la configuración del owner, y sin
 * ella no hay pedido.
 *
 * La validación es también una defensa: el valor termina en un header HTTP, así
 * que un `\r\n` embebido partiría el request en dos. Es la única entrada de
 * configuración de este módulo que llega cruda a la red.
 */
export const EGRESS_USER_AGENT_VERSION = "egress-user-agent-1.0.0";

export const egressUserAgentSchema = z
  .string()
  .trim()
  .min(12)
  .max(200)
  // Sólo texto imprimible ASCII. Un CR o LF partiría el request y permitiría
  // inyectar headers propios; el resto de los controles se define acá arriba.
  .regex(
    /^[\x20-\x7e]+$/u,
    "The user agent must contain only printable ASCII characters.",
  )
  // El contacto es el requisito de la SEC, no un adorno: sin una dirección a la
  // que escribir, el tráfico es anónimo aunque tenga nombre.
  .regex(
    /[^\s@]+@[^\s@]+\.[^\s@]+/u,
    "The user agent must carry a reachable contact address.",
  );

export type EgressUserAgentProblem =
  "missing" | "not_printable_ascii" | "no_contact" | "invalid";

export type EgressUserAgentResolution =
  | { readonly ok: true; readonly userAgent: string }
  | { readonly ok: false; readonly problem: EgressUserAgentProblem };

/**
 * Resuelve la identificación desde un entorno. Devuelve el motivo y **nunca** el
 * valor recibido: un valor rechazado sigue siendo configuración del owner y no
 * entra en un log (`TM-02`).
 */
export function resolveEgressUserAgent(
  raw: string | undefined,
): EgressUserAgentResolution {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: false, problem: "missing" };
  }

  const parsed = egressUserAgentSchema.safeParse(raw);

  if (parsed.success) {
    return { ok: true, userAgent: parsed.data };
  }

  const messages = parsed.error.issues.map((issue) => issue.message);

  if (messages.some((message) => message.includes("printable ASCII"))) {
    return { ok: false, problem: "not_printable_ascii" };
  }

  if (messages.some((message) => message.includes("contact address"))) {
    return { ok: false, problem: "no_contact" };
  }

  return { ok: false, problem: "invalid" };
}
