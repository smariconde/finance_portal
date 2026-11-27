import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import type { ListingStore } from "@/modules/real-estate/application/listing-store";
import { createPostgresListingStore } from "@/server/db/postgres-listing-store";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let store: ListingStore | undefined;

/** Los avisos de la Fase 13, sólo en modo `personal` (ADR 0089). */
export function getListingStore(): ListingStore {
  if (store) return store;
  store = selectPersonalDependency(
    getConfigHealth(process.env).mode,
    "listing-store",
    () => createPostgresListingStore(getRuntimeDatabase()),
  );
  return store;
}
