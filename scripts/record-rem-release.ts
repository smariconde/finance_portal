import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { BCRA_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  BcraRemReleaseError,
  BCRA_REM_SOURCE_ID,
  createLiveBcraRemRelease,
} from "@/modules/macro-series/application/live-bcra-rem-release";
import { planRemRelease } from "@/modules/macro-series/domain/plan-rem-release";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getRemForecastRepository } from "@/server/persistence/get-rem-forecast-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/** One explicitly verified REM edition. Dry run may fetch, but never publishes. */
const { values } = parseArgs({
  options: {
    round: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
if (values.round !== "2026-10") {
  console.error("Sólo está declarada la ronda --round 2026-10.");
  process.exit(2);
}
const round = values.round;
const registry = getSourceRegistryRepository();
await syncDeclaredSourceRegistry(
  DEMO_SOURCE_REGISTRY.filter((entry) => entry.sourceId === BCRA_REM_SOURCE_ID),
  registry,
);
const budget = await checkSourceBudget(
  getSourceBudgetStore(),
  BCRA_REM_SOURCE_ID,
  2,
  new Date().toISOString(),
);
if (budget.status !== "allowed") {
  console.error(describeSourceRefusal(BCRA_REM_SOURCE_ID, budget));
  process.exit(2);
}

const load = createLiveBcraRemRelease({
  sourceRegistry: registry,
  fetch: getSourceEgressFetch({ ...BCRA_REQUEST_PACING, maxRequests: 2 }),
});
const startedAt = new Date().toISOString();
let release: Awaited<ReturnType<typeof load>>;
try {
  release = await load(round);
} catch (error) {
  if (error instanceof BcraRemReleaseError) {
    console.error(
      `REM ${round}: ${error.code}${error.detail ? ` (${error.detail})` : ""}`,
    );
    process.exit(2);
  }
  throw error;
}
const repository = getRemForecastRepository();
const runId = randomUUID();
const plan = planRemRelease({
  ...release,
  runId,
  open: await repository.open(round),
});
console.log(
  JSON.stringify(
    {
      round,
      publishedOn: release.publishedOn,
      availableAt: release.availableAt,
      forecasts: release.forecasts.length,
      newOrRevised: plan.observations.length,
      unchanged: plan.unchanged,
      requests: release.requests,
      bytes: release.bytes,
      mode: values.apply ? "apply" : "dry_run",
    },
    null,
    2,
  ),
);
if (values.apply) {
  const published = await repository.publish({
    release,
    runId,
    startedAt,
  });
  console.log(JSON.stringify(published));
}
