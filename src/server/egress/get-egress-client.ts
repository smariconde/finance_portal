import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import { findEgressAllowlistEntry } from "./egress-allowlist";
import { EgressBlockedError } from "./egress-policy";
import { resolveEgressUserAgent } from "./egress-user-agent";
import {
  fetchApprovedResource,
  type ApprovedResourceRequest,
  type ApprovedResourceResponse,
} from "./fetch-approved-resource";
import { createHttpsTransport } from "./https-transport";

/**
 * Raíz de composición del egress.
 *
 * Un runtime trabado no consulta ninguna fuente (ADR 0004), y eso se sostiene en
 * el mismo lugar que la persistencia: acá, al construir la dependencia. La
 * negativa llega antes de resolver un nombre y antes de leer la identificación
 * del owner, así que un runtime que no probó ser privado no genera tráfico ni
 * revela por DNS que existe.
 *
 * El cliente no acepta `userAgent` por parámetro: lo trae de la configuración al
 * construirse. Un llamador no puede presentarse de otra forma ante la fuente.
 * Tampoco acepta credenciales: la puerta las lee del entorno por el nombre que
 * declara la allowlist, y un adaptador nunca las ve (ADR 0033).
 *
 * Sin `SEC_USER_AGENT` el cliente se construye igual, porque las fuentes que se
 * presentan como proyecto no lo necesitan; lo que se niega es cada pedido a una
 * fuente que exige el contacto del owner, antes de abrir un socket.
 */
export type EgressClient = (
  request: Omit<ApprovedResourceRequest, "userAgent">,
) => Promise<ApprovedResourceResponse>;

let client: EgressClient | undefined;

export function getEgressClient(): EgressClient {
  if (client) {
    return client;
  }

  const effectiveMode = getConfigHealth(process.env).mode;

  client = selectPersonalDependency(effectiveMode, "egress client", () => {
    const identification = resolveEgressUserAgent(process.env.SEC_USER_AGENT);
    const transport = createHttpsTransport();

    return async (request) => {
      const entry = findEgressAllowlistEntry(request.sourceId);

      if (entry?.identification === "owner_contact" && !identification.ok) {
        // Se nombra la variable y el problema, nunca el valor recibido
        // (`TM-02`), igual que hace el health de configuración.
        throw new EgressBlockedError(
          "user_agent_missing",
          "SEC_USER_AGENT",
          identification.problem,
        );
      }

      return fetchApprovedResource(
        {
          ...request,
          userAgent: identification.ok ? identification.userAgent : null,
        },
        {
          transport,
          now: () => new Date().toISOString(),
          elapsedMs: () => performance.now(),
          readCredential: (variable) => process.env[variable],
        },
      );
    };
  });

  return client;
}
