import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

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

    if (!identification.ok) {
      // Se nombra la variable y el problema, nunca el valor recibido (`TM-02`),
      // igual que hace el health de configuración.
      throw new EgressBlockedError(
        "user_agent_missing",
        "SEC_USER_AGENT",
        identification.problem,
      );
    }

    const transport = createHttpsTransport();

    return (request) =>
      fetchApprovedResource(
        { ...request, userAgent: identification.userAgent },
        {
          transport,
          now: () => new Date().toISOString(),
          elapsedMs: () => performance.now(),
        },
      );
  });

  return client;
}
