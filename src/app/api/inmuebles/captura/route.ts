import { getRequestConfigHealth } from "@/server/config/app-environment";
import { serveListingCapture } from "@/server/real-estate/listing-capture";

/**
 * La captura de avisos desde la extensión (`F13-02`,
 * [ADR 0089](../../../../../docs/architecture/adr/0089-real-estate-intelligence-cordoba.md)).
 * El modo se resuelve en el request (ADR 0005) y nada se cachea (`TM-04`).
 */
export async function POST(request: Request): Promise<Response> {
  return serveListingCapture(request, await getRequestConfigHealth());
}

async function notAllowed(request: Request): Promise<Response> {
  return serveListingCapture(request, await getRequestConfigHealth());
}

export {
  notAllowed as GET,
  notAllowed as DELETE,
  notAllowed as PUT,
  notAllowed as PATCH,
};
