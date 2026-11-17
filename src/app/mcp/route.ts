import { getRequestConfigHealth } from "@/server/config/app-environment";
import { serveOwnerMcp } from "@/server/mcp/owner-mcp";

/**
 * El MCP de sólo lectura del owner (`F11-17`,
 * [ADR 0078](../../../docs/architecture/adr/0078-owner-read-only-mcp.md)).
 * El modo se resuelve en el request (ADR 0005) y nada se cachea (`TM-04`).
 */
export async function POST(request: Request): Promise<Response> {
  return serveOwnerMcp(request, await getRequestConfigHealth());
}

async function notAllowed(request: Request): Promise<Response> {
  return serveOwnerMcp(request, await getRequestConfigHealth());
}

export {
  notAllowed as GET,
  notAllowed as DELETE,
  notAllowed as PUT,
  notAllowed as PATCH,
};
