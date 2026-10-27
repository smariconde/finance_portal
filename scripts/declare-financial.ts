import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  getConfigHealth,
  servesRealData,
} from "@/modules/configuration/domain/config-health";
import { usMarketGraph } from "@/modules/identity/domain/us-market-graph";
import { resolveIdentity } from "@/modules/identity/domain/resolve-identity";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import {
  financialDeclarationFileSchema,
  FINANCIAL_DECLARATION_VERSION,
} from "@/modules/valuation/domain/financial-declaration";
import { valuationTickerSchema } from "@/modules/valuation/domain/valuation-job";
import { getFinancialDeclarationRepository } from "@/server/persistence/get-financial-declaration-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    ticker: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
if (values.file === undefined || values.ticker === undefined)
  throw new Error("Use --ticker and --file.");
const ticker = valuationTickerSchema.parse(values.ticker);
const info = await stat(values.file);
if (!info.isFile() || info.size > 32_768)
  throw new Error("The private declaration must be a file under 32 KiB.");
const declaration = financialDeclarationFileSchema.parse(
  JSON.parse(await readFile(values.file, "utf8")),
);
const health = getConfigHealth(process.env);
if (!servesRealData(health))
  throw new Error("Financial declarations require a personal runtime.");

const now = new Date().toISOString();
const query = pointInTimeQuerySchema.parse({
  effectiveAt: now,
  knownAt: now,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  knowledgeBasis: "public_availability",
  sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
});
const state = await getUniverseRepository().loadState({
  indexId: SP500_INDEX_ID,
  versions: "all",
  limit: 50_000,
});
const identity = resolveIdentity(
  usMarketGraph(state.graph),
  { symbol: ticker },
  query,
);
if (identity.status !== "resolved" || identity.legalEntityId === null)
  throw new Error("Ticker does not resolve to one legal entity.");

console.log(
  `${ticker}: ${declaration.fiscalYearEnd}, payout ${declaration.payout}; three reviews and citation present.`,
);
if (!values.apply) {
  console.log("Dry run. Add --apply to record this private declaration.");
} else {
  await getFinancialDeclarationRepository().record({
    ...declaration,
    version: FINANCIAL_DECLARATION_VERSION,
    declarationId: randomUUID(),
    legalEntityId: identity.legalEntityId,
    availableAt: now,
    recordedAt: now,
  });
  console.log("Declaration recorded.");
}
