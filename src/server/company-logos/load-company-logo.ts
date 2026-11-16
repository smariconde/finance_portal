import "server-only";

import { randomUUID } from "node:crypto";

import { createCompanyLogoLoader } from "@/modules/configuration/application/load-company-logo";
import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { companyLogoPublishableKey } from "@/modules/configuration/domain/company-logo";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createPostgresCompanyLogoStore } from "@/server/db/postgres-company-logo-store";
import { getRuntimeDatabase } from "@/server/db/runtime-client";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

import {
  COMPANY_LOGO_SOURCE_ID,
  createCompanyLogoDownload,
} from "./download-company-logo";

export function getCompanyLogoLoader() {
  return selectPersonalDependency(
    getConfigHealth(process.env).mode,
    "company logos",
    () => {
      const entry = DEMO_SOURCE_REGISTRY.find(
        (row) => row.sourceId === COMPANY_LOGO_SOURCE_ID,
      )!;
      return createCompanyLogoLoader({
        store: createPostgresCompanyLogoStore(getRuntimeDatabase()),
        canDownload: () =>
          companyLogoPublishableKey(process.env.LOGO_DEV_PUBLISHABLE_KEY) !==
          null,
        newToken: randomUUID,
        now: () => new Date().toISOString(),
        download: async (symbol) => {
          await syncDeclaredSourceRegistry(
            [entry],
            getSourceRegistryRepository(),
          );
          return createCompanyLogoDownload({
            entry,
            fetch: getSourceEgressFetch({ minIntervalMs: 250, maxRequests: 1 }),
            key: () => process.env.LOGO_DEV_PUBLISHABLE_KEY,
          })(symbol);
        },
      });
    },
  );
}
