import "server-only";

import { randomUUID } from "node:crypto";

import type { ConfigHealth } from "@/modules/configuration/domain/config-health";
import { parseMcpAccessToken } from "@/modules/owner-mcp/domain/mcp-access-token";
import { CAPTURE_TOKEN_VARIABLE } from "@/modules/real-estate/domain/capture-token";
import { getListingStore } from "@/server/persistence/get-listing-store";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";

import {
  handleListingCaptureRequest,
  type ListingCaptureLog,
} from "./handle-listing-capture-request";

/** Un registro por línea, sólo conteos (`TM-16`). */
function logLine(entry: ListingCaptureLog) {
  console.info(JSON.stringify({ scope: "listing-capture", ...entry }));
}

/** La raíz de composición del endpoint: el health ya se resolvió en el request. */
export function serveListingCapture(
  request: Request,
  health: ConfigHealth,
): Promise<Response> {
  const token = parseMcpAccessToken(process.env[CAPTURE_TOKEN_VARIABLE]);
  return handleListingCaptureRequest(request, {
    health,
    tokenDigest: token.ok ? token.digest : null,
    budget: {
      consume: (sourceId, now) => getSourceBudgetStore().consume(sourceId, now),
    },
    store: getListingStore,
    requestId: randomUUID(),
    clock: () => new Date().toISOString(),
    log: logLine,
  });
}
