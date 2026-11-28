"use server";

import { after } from "next/server";
import { z } from "zod";

import { servesRealData } from "@/modules/configuration/domain/config-health";
import type { LocationRefreshStatus } from "@/modules/real-estate/application/listing-location-refresh";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import {
  ensureLocationRefreshForRequest,
  startLocationRefreshWorker,
} from "@/server/jobs/listing-location-refresh";

const refreshRequestSchema = z.object({ retryFailures: z.boolean() }).strict();

export type LocationRefreshResult =
  | LocationRefreshStatus
  /** Runtime trabado, pedido inválido o base caída: sin detalle (`TM-02`). */
  | { readonly state: "unavailable" };

/**
 * Pone al día la ubicación y la zonificación de los avisos (`F13-06`, patrón
 * de las ADR 0030 y 0070). Se trata como un endpoint público aunque sólo lo
 * llame la página (`TM-03`):
 *
 * - el modo se resuelve en el pedido y un runtime trabado no abre la base;
 * - la entrada es un booleano con esquema cerrado: ni una dirección, ni un
 *   punto, ni una URL; qué preguntar lo decide el servidor con lo guardado;
 * - cada pedido sale por el egress medido con su cuota y su kill switch
 *   (ADR 0020), y el lease de cada fuente separa dos actualizaciones;
 * - la respuesta son conteos, etiquetas y códigos; ningún mensaje de error.
 */
export async function refreshListingLocations(
  input: unknown,
): Promise<LocationRefreshResult> {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health)) return { state: "unavailable" };

  const request = refreshRequestSchema.safeParse(input);
  if (!request.success) return { state: "unavailable" };

  try {
    const result = await ensureLocationRefreshForRequest(request.data);
    // Después de responder: la página no espera la descarga, vuelve a
    // preguntar con esta misma acción.
    if (result.runWorker) after(() => startLocationRefreshWorker());
    return result.status;
  } catch (error) {
    // Sólo el tipo: el mensaje puede traer un host, un puerto o SQL (`TM-02`).
    console.error(
      "location refresh failed",
      error instanceof Error ? error.name : typeof error,
    );
    return { state: "unavailable" };
  }
}
