"use server";

import { after } from "next/server";
import { z } from "zod";

import { servesRealData } from "@/modules/configuration/domain/config-health";
import {
  sectorCodeSchema,
  type SectorPriceStatus,
} from "@/modules/prices/application/sector-price-refresh";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import {
  ensureSectorPricesForRequest,
  startPriceRefreshWorker,
} from "@/server/jobs/sector-price-refresh";

const refreshRequestSchema = z
  .object({
    sectorCode: sectorCodeSchema,
    retryFailures: z.boolean(),
  })
  .strict();

export type SectorPriceRefreshResult =
  | SectorPriceStatus
  /** Runtime trabado, pedido inválido o base caída: sin detalle (`TM-02`). */
  | { readonly state: "unavailable" };

/**
 * Pone al día los precios de un sector antes de leer su matriz (`F7-08`,
 * [ADR 0030](../../../../docs/architecture/adr/0030-sector-prices-on-open.md)).
 *
 * Es la primera frontera que muta desde la web, y se trata como un endpoint
 * público aunque sólo la llame la página (`TM-03`):
 *
 * - el modo se resuelve en el request y un runtime trabado no abre la base;
 * - la entrada es un código de la taxonomía declarada, nunca un ticker libre ni
 *   una URL, validada con un esquema cerrado;
 * - no hay más que pedir que «lo que le falta a este sector»: el plan lo arma el
 *   servidor, cada request pasa por el egress con su cuota y su kill switch
 *   (ADR 0020), y el lease impide dos descargas a la vez (ADR 0015);
 * - la respuesta son conteos y códigos; ningún mensaje de error sale.
 *
 * Next.js ya rechaza una acción cuyo `Origin` no coincide con el host.
 */
export async function refreshSectorPrices(
  input: unknown,
): Promise<SectorPriceRefreshResult> {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return { state: "unavailable" };
  }

  const request = refreshRequestSchema.safeParse(input);

  if (!request.success) {
    return { state: "unavailable" };
  }

  try {
    const result = await ensureSectorPricesForRequest(request.data);
    const jobId = result.runJobId;

    if (jobId !== null) {
      // Después de responder: la página no espera el minuto de descarga, la
      // consulta con la misma acción.
      after(() => startPriceRefreshWorker(jobId));
    }

    return result.status;
  } catch (error) {
    // Sólo el tipo: el mensaje puede traer host, puerto o SQL (`TM-02`).
    console.error(
      "sector price refresh failed",
      error instanceof Error ? error.name : typeof error,
    );

    return { state: "unavailable" };
  }
}
