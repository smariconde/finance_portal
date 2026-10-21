import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import type { ValuationJobStore } from "@/modules/valuation/application/valuation-job-store";
import { createPostgresValuationJobStore } from "@/server/db/postgres-valuation-job-store";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let store: ValuationJobStore | undefined;

export function getValuationJobStore(): ValuationJobStore {
  if (store) {
    return store;
  }

  const mode = getConfigHealth(process.env).mode;
  store = selectPersonalDependency(mode, "valuation-job", () =>
    createPostgresValuationJobStore(getRuntimeDatabase()),
  );

  return store;
}
