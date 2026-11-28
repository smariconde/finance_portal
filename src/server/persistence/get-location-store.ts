import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import type { LocationStore } from "@/modules/real-estate/application/location-store";
import { createPostgresLocationStore } from "@/server/db/postgres-location-store";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let store: LocationStore | undefined;

/** Ubicación y zonificación de los avisos (`F13-06`), sólo en modo `personal`. */
export function getLocationStore(): LocationStore {
  if (store) return store;
  store = selectPersonalDependency(
    getConfigHealth(process.env).mode,
    "location-store",
    () => createPostgresLocationStore(getRuntimeDatabase()),
  );
  return store;
}
