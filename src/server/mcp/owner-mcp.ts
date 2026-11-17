import "server-only";

import { randomUUID } from "node:crypto";

import { localhostAllowedHostnames } from "@modelcontextprotocol/server";

import {
  servesTradingData,
  type ConfigHealth,
} from "@/modules/configuration/domain/config-health";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  MCP_ACCESS_TOKEN_VARIABLE,
  parseMcpAccessToken,
} from "@/modules/owner-mcp/domain/mcp-access-token";
import {
  readValuationResultForRequest,
  readValuedCompaniesForRequest,
} from "@/server/jobs/valuation-job";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { readTradeEntry } from "@/server/trading/trade-entry";
import { readJournal } from "@/server/trading/transactions";

import {
  handleOwnerMcpRequest,
  type OwnerMcpRequestDependencies,
} from "./handle-owner-mcp-request";
import type { OwnerMcpReaders } from "./owner-mcp-server";

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Los `Host` que la ruta acepta. En Vercel, los dominios que el propio
 * deployment declara (producción, el del deployment y el de la rama); fuera,
 * sólo localhost. Nunca el del pedido: eso es lo que se valida.
 */
export function mcpAllowedHostnames(environment: Environment): string[] {
  if (environment.VERCEL !== "1") return localhostAllowedHostnames();

  return [
    environment.VERCEL_PROJECT_PRODUCTION_URL,
    environment.VERCEL_URL,
    environment.VERCEL_BRANCH_URL,
  ]
    .map((value) => value?.trim().toLowerCase() ?? "")
    .filter((value) => /^[a-z0-9.-]{1,253}$/u.test(value));
}

/**
 * Las lecturas de las páginas. El diario y un trade sólo con la base de
 * trading: sin ella, sus herramientas lo dicen y el resto sirve igual.
 */
function pageReaders(health: ConfigHealth): OwnerMcpReaders {
  const trading = servesTradingData(health);

  return {
    listValuations: readValuedCompaniesForRequest,
    getValuation: readValuationResultForRequest,
    readJournal: trading
      ? async () => {
          const reading = await readJournal();
          return {
            account: reading.account,
            trades: reading.trades,
            summary: reading.summary,
            entries: reading.entries,
            lastSyncAt: reading.lastRun?.finishedAt ?? null,
            historyFrom: reading.historyFrom,
            unread: reading.unread,
          };
        }
      : null,
    readTrade: trading
      ? async (ref) => {
          const reading = await readTradeEntry(ref);
          if (reading === null) return null;
          const plan = reading.linkedPlan;
          return {
            lastFour: reading.lastFour,
            ref: reading.ref,
            trade: reading.trade,
            annotation: reading.annotation,
            linkedPlan:
              plan === null
                ? null
                : {
                    symbol: plan.idea.symbol,
                    setupCode: plan.idea.setupCode,
                    entry: plan.idea.entry,
                    stop: plan.stop,
                    target: plan.target,
                    quantity: plan.idea.quantity,
                    notes: plan.idea.notes,
                  },
            risk: reading.risk,
            r: reading.r,
            rewardRisk: reading.rewardRisk,
            unread: reading.unread,
          };
        }
      : null,
  };
}

/** Un registro por línea, sin argumentos ni respuesta (`TM-16`). */
function logLine(entry: object) {
  console.info(JSON.stringify({ scope: "owner-mcp", ...entry }));
}

/** La raíz de composición de `/mcp`: el health ya se resolvió en el request. */
export function serveOwnerMcp(
  request: Request,
  health: ConfigHealth,
): Promise<Response> {
  const token = parseMcpAccessToken(process.env[MCP_ACCESS_TOKEN_VARIABLE]);
  const dependencies: OwnerMcpRequestDependencies = {
    health,
    tokenDigest: token.ok ? token.digest : null,
    allowedHostnames: mcpAllowedHostnames(process.env),
    budget: {
      consume: (sourceId, now) => getSourceBudgetStore().consume(sourceId, now),
    },
    readers: pageReaders,
    registry: DEMO_SOURCE_REGISTRY,
    requestId: randomUUID(),
    now: () => performance.now(),
    clock: () => new Date().toISOString(),
    log: logLine,
  };

  return handleOwnerMcpRequest(request, dependencies);
}
