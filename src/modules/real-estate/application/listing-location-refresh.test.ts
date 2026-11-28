import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import { createInMemoryIngestionJobStore } from "@/modules/ingestion/infrastructure/in-memory-ingestion-job-store";
import { createInMemorySourceBudgetStore } from "@/modules/ingestion/infrastructure/in-memory-source-budget-store";

import { parseBarriosKml } from "../domain/cordoba-barrios";
import { parseZoningLayer, type ParcelAtPoint } from "../domain/idecor-wfs";
import type { LocationListing } from "../domain/listing-location";
import { createInMemoryLocationStore } from "../infrastructure/in-memory-location-store";
import {
  syntheticBarriosKml,
  syntheticZoningLayer,
} from "../infrastructure/synthetic-location";
import {
  createLocationExecutor,
  createLocationRecorder,
  ensureLocationRefresh,
  openLocationJobsInOrder,
  resolveStaleLocations,
} from "./listing-location-refresh";
import {
  LocationSourceError,
  type LocationSources,
} from "./live-location-sources";

const NOW = "2026-11-28T12:00:00.000Z";

const listing = (overrides: Partial<LocationListing>): LocationListing => ({
  revision: 1,
  propertyType: "house",
  addressDeclared: "Rondeau 500",
  neighborhood: null,
  latitude: "-31.428",
  longitude: "-64.188",
  landAreaM2: "300",
  ...overrides,
});

function setup(options: { failParcels?: boolean } = {}) {
  const store = createInMemoryLocationStore([
    { listingId: "a", listing: listing({}) },
    {
      listingId: "b",
      listing: listing({
        propertyType: "apartment",
        addressDeclared: "Roma 1300",
        latitude: "-31.425",
        longitude: "-64.175",
        landAreaM2: null,
      }),
    },
  ]);
  const jobs = createInMemoryIngestionJobStore({ newId: randomUUID });
  const budgets = createInMemorySourceBudgetStore();
  const calls: string[] = [];
  const sources: LocationSources = {
    async geocode(queries) {
      calls.push(`georef:${queries.length}`);
      return {
        observedAt: NOW,
        results: queries.map(() => ({ status: "not_found" as const })),
      };
    },
    async zoningLayer() {
      calls.push("zoning");
      return {
        observedAt: NOW,
        features: parseZoningLayer(syntheticZoningLayer()),
      };
    },
    async barrios() {
      calls.push("barrios");
      return {
        observedAt: NOW,
        features: parseBarriosKml(syntheticBarriosKml()),
      };
    },
    async parcelsAt(point) {
      calls.push(`parcel:${point.latitude}`);
      if (options.failParcels)
        throw new LocationSourceError(
          "schema_changed",
          "idecor-geoserver",
          "wfs_truncated",
        );
      const parcels: ParcelAtPoint[] = [
        {
          nomenclature: "1101010409014065",
          landAreaM2: "310",
          state: "EDIFICADO NoPH",
          parcelType: "URBANO",
        },
      ];
      return { observedAt: NOW, parcels };
    },
  };
  const dependencies = { jobs, store, budgets, now: () => NOW };

  async function runOpen() {
    for (const job of await openLocationJobsInOrder(jobs))
      await runIngestionJob(
        { jobId: job.jobId, holder: "test-worker" },
        {
          store: jobs,
          execute: createLocationExecutor({
            record: createLocationRecorder({
              store,
              sources,
              now: () => NOW,
              newId: randomUUID,
            }),
            takeSignal: () => null,
          }),
          now: () => NOW,
          sleep: async () => {},
          newLeaseToken: randomUUID,
          startHeartbeat: () => () => {},
        },
      );
    await resolveStaleLocations({ store, now: () => NOW });
  }

  const ensure = (retryFailures = false) =>
    ensureLocationRefresh(
      { retryFailures },
      { ...dependencies, workerActive: () => false },
    );

  return { store, jobs, calls, runOpen, ensure };
}

describe("listing-location-refresh-1.0.0", () => {
  it("plans what is missing, runs layers before Georef before IDECOR, then is fresh", async () => {
    const { store, calls, runOpen, ensure } = setup();
    const first = await ensure();
    expect(first.status).toEqual({ state: "running", pending: 5, done: 0 });
    expect(first.runWorker).toBe(true);

    await runOpen();
    expect(calls).toEqual([
      "barrios",
      "zoning",
      "georef:2",
      "parcel:-31.425",
      "parcel:-31.428",
    ]);
    expect(store.readings.get("a")?.reading).toMatchObject({
      precision: "portal_pin",
      parcel: { status: "matched" },
      zoning: { confidence: "official_map", pattern: "8256-G1" },
      barrio: { name: "BARRIO SINTÉTICO" },
    });
    expect(store.readings.get("b")?.reading).toMatchObject({
      parcel: { status: "building_parcel" },
      zoning: { pattern: "8057-PERFIL X" },
    });

    // Todo respondido: nada que pedir ni que releer.
    expect((await ensure()).status).toEqual({ state: "fresh" });
    await runOpen();
    expect(calls).toHaveLength(5);
  });

  it("reports an open job instead of planning another", async () => {
    const { ensure } = setup();
    await ensure();
    expect((await ensure()).status).toMatchObject({
      state: "running",
      pending: 5,
    });
  });

  it("does not replan a failed subject until the owner retries", async () => {
    const { calls, runOpen, ensure } = setup({ failParcels: true });
    await ensure();
    await runOpen();
    expect((await ensure()).status).toEqual({
      state: "failed",
      failed: 2,
      labels: ["Parcelas (IDECOR)"],
    });
    const asked = calls.length;
    const retry = await ensure(true);
    expect(retry.status).toMatchObject({ state: "running", pending: 2 });
    await runOpen();
    expect(calls.length).toBeGreaterThan(asked);
  });
});
