import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import type {
  LayerStatus,
  LocationLayerId,
  LocationStore,
  StoredListingLocation,
} from "../application/location-store";
import type { GeorefResult } from "../domain/georef-addresses";
import { withBox, type ParcelAtPoint } from "../domain/idecor-wfs";
import type { LocationListing } from "../domain/listing-location";
import type { ZoningQuery } from "../domain/zoning-resolution";

/**
 * Doble en memoria del store de ubicación, para los tests de la orquestación.
 * No es un modo de runtime: ninguna raíz de composición lo construye.
 */
export function createInMemoryLocationStore(
  listings: readonly { listingId: string; listing: LocationListing }[],
): LocationStore & {
  readonly runs: { datasetId: string; finishedAt: string }[];
  readonly readings: Map<string, StoredListingLocation & { inputHash: string }>;
} {
  const layers = new Map<
    LocationLayerId,
    { status: LayerStatus<LocationLayerId>; hash: string }
  >();
  const geocodes = new Map<string, GeorefResult>();
  const lookups = new Map<string, readonly ParcelAtPoint[]>();
  const queries = new Map<string, ZoningQuery>();
  const readings = new Map<
    string,
    StoredListingLocation & { inputHash: string }
  >();
  const runs: { datasetId: string; finishedAt: string }[] = [];

  return {
    runs,
    readings,
    async readState() {
      return {
        listings,
        readings: new Map(
          [...readings].map(([id, row]) => [
            id,
            { inputHash: row.inputHash, listingRevision: row.listingRevision },
          ]),
        ),
        geocodes,
        lookups,
        queries,
      };
    },
    async readLayer(layerId) {
      const stored = layers.get(layerId);
      const checked = runs
        .filter((run) => run.datasetId === layerId)
        .map((run) => run.finishedAt)
        .sort()
        .at(-1);
      return {
        release: (stored?.status.release ?? null) as never,
        checkedAt: checked ?? null,
      };
    },
    async recordLayer(run, layerId, features) {
      runs.push({ datasetId: run.datasetId, finishedAt: run.recordedAt });
      const hash = computeContentHash(features);
      if (layers.get(layerId)?.hash === hash)
        return { runId: run.runId, released: false };
      layers.set(layerId, {
        hash,
        status: {
          checkedAt: run.recordedAt,
          release: {
            releaseId: run.runId,
            observedAt: run.observedAt,
            features: features.map((feature) => withBox(feature)) as never,
          },
        },
      });
      return { runId: run.runId, released: true };
    },
    async recordGeocodes(run, results) {
      runs.push({ datasetId: run.datasetId, finishedAt: run.recordedAt });
      for (const { addressKey, result } of results)
        geocodes.set(addressKey, result);
      return run.runId;
    },
    async recordParcelLookup(run, point, parcels) {
      runs.push({ datasetId: run.datasetId, finishedAt: run.recordedAt });
      lookups.set(point, parcels);
      return run.runId;
    },
    async recordReadings(entries, resolvedAt) {
      let written = 0;
      for (const entry of entries) {
        const prior = readings.get(entry.listingId);
        if (prior?.inputHash === entry.inputHash) continue;
        readings.set(entry.listingId, {
          revision: (prior?.revision ?? 0) + 1,
          listingRevision: entry.reading.listingRevision,
          reading: entry.reading,
          resolvedAt,
          inputHash: entry.inputHash,
        });
        written += 1;
      }
      return written;
    },
    async recordZoningQuery(query) {
      queries.set(query.nomenclature, query);
      return 1;
    },
    async readListingLocation() {
      return null;
    },
  };
}
