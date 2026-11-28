import { parseArgs } from "node:util";

import {
  pendingSubjects,
  resolveStaleLocations,
  staleListings,
} from "@/modules/real-estate/application/listing-location-refresh";
import { classifyDeclaredAddress } from "@/modules/real-estate/domain/georef-addresses";
import { resolveListingLocation } from "@/modules/real-estate/domain/listing-location";
import { sharedPins } from "@/modules/real-estate/domain/location-precision";
import {
  ensureLocationRefreshForRequest,
  runLocationRefresh,
} from "@/server/jobs/listing-location-refresh";
import { getLocationStore } from "@/server/persistence/get-location-store";

/**
 * Ubica los avisos guardados (`F13-06`): lo mismo que hace `/inmuebles` al
 * abrirse, a mano. Sirve para la carga inicial y para ver qué daría.
 *
 *   pnpm inmuebles:locate             # en seco: qué falta y qué daría con lo guardado; sin red
 *   pnpm inmuebles:locate --apply     # planea y corre los jobs (gasta cuota) y escribe las lecturas
 *   pnpm inmuebles:locate --apply --retry   # también lo que falló antes
 */
const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    retry: { type: "boolean", default: false },
  },
});

const store = getLocationStore();
const now = () => new Date().toISOString();

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(28)} ${String(value)}`);
}

async function report(): Promise<void> {
  const [state, barrios, zoning] = await Promise.all([
    store.readState(),
    store.readLayer("cordoba.barrios"),
    store.readLayer("idecor.cba-ordenanza-8256"),
  ]);
  const pending = pendingSubjects({ state, barrios, zoning, now: now() });
  log("avisos", state.listings.length);
  log(
    "barrios",
    barrios.release
      ? `${barrios.release.features.length} polígonos`
      : "sin bajar",
  );
  log(
    "ocupación del suelo",
    zoning.release
      ? `${zoning.release.features.length} polígonos`
      : "sin bajar",
  );
  log("direcciones pendientes", pending.addressKeys.length);
  log("puntos pendientes", pending["idecor.parcelas"].length);
  log(
    "lecturas atrasadas",
    staleListings({
      state,
      barriosRelease: barrios.release?.releaseId ?? null,
      zoningRelease: zoning.release?.releaseId ?? null,
    }).length,
  );

  const shared = sharedPins(state.listings.map(({ listing }) => listing));
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const { listing } of state.listings) {
    const address = classifyDeclaredAddress(listing.addressDeclared);
    const key =
      listing.latitude === null
        ? null
        : `${listing.latitude},${listing.longitude}`;
    const reading = resolveListingLocation({
      listing,
      pinShared: key !== null && shared.has(key),
      geocode:
        address.kind === "street_number"
          ? state.geocodes.get(address.addressKey)
          : null,
      parcelsAt: (point) => state.lookups.get(point),
      zoningQueryFor: (nomenclature) => state.queries.get(nomenclature) ?? null,
      barrios: barrios.release,
      zoning: zoning.release,
    });
    bump(`precisión ${reading.precision}`);
    bump(`parcela ${reading.parcel.status}`);
    bump(`zona ${reading.zoning.confidence}`);
    bump(
      `barrio ${reading.barrio === null ? (reading.barrioReason ?? "-") : "ubicado"}`,
    );
    if (reading.pinFarFromAddress) bump("pin a más de 150 m");
  }
  console.log("");
  for (const [key, count] of [...counts].sort()) log(key, count);
}

await report();

if (values.apply) {
  // Georef destapa puntos nuevos: unas pocas vueltas alcanzan.
  for (let round = 1; round <= 4; round += 1) {
    const { status } = await ensureLocationRefreshForRequest({
      retryFailures: values.retry && round === 1,
    });
    log(`\nvuelta ${round}`, status.state);
    if (status.state === "blocked")
      log("frenada", `${status.label}: ${status.reason}`);
    if (status.state === "failed")
      log("sin consultar", `${status.failed} · ${status.labels.join(", ")}`);
    if (status.state !== "running") break;
    await runLocationRefresh();
  }
  const { written } = await resolveStaleLocations({ store, now });
  log("lecturas escritas al final", written);
  console.log("");
  await report();
}

process.exit(0);
