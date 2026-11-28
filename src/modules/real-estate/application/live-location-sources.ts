import type {
  EgressFetch,
  EgressFetchRequest,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";

import {
  BARRIOS_KMZ_URL,
  BARRIOS_LAYER_ID,
  BarriosParseError,
  parseBarriosKmz,
  type BarrioProperties,
} from "../domain/cordoba-barrios";
import type { GeoPoint } from "../domain/geo-geometry";
import {
  GEOREF_ADDRESSES_URL,
  GEOREF_DATASET,
  georefBatchBody,
  GeorefParseError,
  parseGeorefBatch,
  type GeorefQuery,
  type GeorefResult,
} from "../domain/georef-addresses";
import {
  IdecorParseError,
  PARCELS_DATASET,
  parcelsAtUrl,
  parseParcelsAt,
  parseZoningLayer,
  ZONING_LAYER_ID,
  zoningLayerUrl,
  type ParcelAtPoint,
  type ParsedLayerFeature,
  type ZoningFeatureProperties,
} from "../domain/idecor-wfs";

export const GEOREF_SOURCE_ID = "georef-ar";
export const IDECOR_SOURCE_ID = "idecor-geoserver";
export const BARRIOS_SOURCE_ID = "cordoba-gobierno-abierto";

/** Un error de fuente con su código; nunca un valor del cable (`TM-02`). */
export class LocationSourceError extends Error {
  constructor(
    readonly code:
      | "rights_not_approved"
      | "fetch_failed"
      | "rate_limited"
      | "unexpected_status"
      | "schema_changed",
    readonly sourceId: string,
    readonly detail: string | null = null,
    readonly retryAfter: string | null = null,
  ) {
    super(`${code}${detail === null ? "" : ` (${detail})`}: ${sourceId}`);
    this.name = "LocationSourceError";
  }
}

type Dependencies = {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
};

async function assertRights(
  registry: SourceRegistryRepository,
  sourceId: string,
  datasetId: string,
): Promise<void> {
  const entry = await registry.findBySourceId(sourceId);
  const rights =
    entry && entry.datasets.includes(datasetId)
      ? evaluateIngestionRights(entry, {
          storesRawPayload: false,
          storesNormalizedValues: true,
          publicDisplay: false,
        })
      : null;
  if (!rights?.allowed)
    throw new LocationSourceError("rights_not_approved", sourceId);
}

async function fetchOk(
  fetch: EgressFetch,
  request: EgressFetchRequest,
): Promise<EgressFetchResponse> {
  let response: EgressFetchResponse;
  try {
    response = await fetch(request);
  } catch (error) {
    // El código de la puerta nombra la causa; un mensaje podría traer la URL.
    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      /^[a-z_]{1,48}$/u.test(error.code)
        ? error.code
        : null;
    throw new LocationSourceError("fetch_failed", request.sourceId, code);
  }
  if (response.status === 429 || response.status === 503)
    throw new LocationSourceError(
      "rate_limited",
      request.sourceId,
      String(response.status),
      response.retryAfter ?? null,
    );
  if (response.status !== 200)
    throw new LocationSourceError(
      "unexpected_status",
      request.sourceId,
      String(response.status),
    );
  return response;
}

const decode = (body: Uint8Array) => new TextDecoder("utf-8").decode(body);

function schemaChanged(sourceId: string, cause: unknown): never {
  if (
    cause instanceof GeorefParseError ||
    cause instanceof IdecorParseError ||
    cause instanceof BarriosParseError
  )
    throw new LocationSourceError("schema_changed", sourceId, cause.code);
  throw cause;
}

export type LocationSources = {
  readonly geocode: (
    queries: readonly GeorefQuery[],
  ) => Promise<{ results: GeorefResult[]; observedAt: string }>;
  readonly zoningLayer: () => Promise<{
    features: ParsedLayerFeature<ZoningFeatureProperties>[];
    observedAt: string;
  }>;
  readonly parcelsAt: (
    point: GeoPoint,
  ) => Promise<{ parcels: ParcelAtPoint[]; observedAt: string }>;
  readonly barrios: () => Promise<{
    features: ParsedLayerFeature<BarrioProperties>[];
    observedAt: string;
  }>;
};

export function createLiveLocationSources(
  dependencies: Dependencies,
): LocationSources {
  const { sourceRegistry, fetch } = dependencies;
  return {
    async geocode(queries) {
      await assertRights(sourceRegistry, GEOREF_SOURCE_ID, GEOREF_DATASET);
      const response = await fetchOk(fetch, {
        sourceId: GEOREF_SOURCE_ID,
        url: GEOREF_ADDRESSES_URL,
        method: "POST",
        body: new TextEncoder().encode(georefBatchBody(queries)),
        contentType: "application/json",
        accept: "application/json",
      });
      try {
        return {
          results: parseGeorefBatch(decode(response.body), queries),
          observedAt: response.fetchedAt,
        };
      } catch (cause) {
        return schemaChanged(GEOREF_SOURCE_ID, cause);
      }
    },
    async zoningLayer() {
      await assertRights(sourceRegistry, IDECOR_SOURCE_ID, ZONING_LAYER_ID);
      const response = await fetchOk(fetch, {
        sourceId: IDECOR_SOURCE_ID,
        url: zoningLayerUrl(),
        accept: "application/json",
      });
      try {
        return {
          features: parseZoningLayer(decode(response.body)),
          observedAt: response.fetchedAt,
        };
      } catch (cause) {
        return schemaChanged(IDECOR_SOURCE_ID, cause);
      }
    },
    async parcelsAt(point) {
      await assertRights(sourceRegistry, IDECOR_SOURCE_ID, PARCELS_DATASET);
      const response = await fetchOk(fetch, {
        sourceId: IDECOR_SOURCE_ID,
        url: parcelsAtUrl(point),
        accept: "application/json",
      });
      try {
        return {
          parcels: parseParcelsAt(decode(response.body)),
          observedAt: response.fetchedAt,
        };
      } catch (cause) {
        return schemaChanged(IDECOR_SOURCE_ID, cause);
      }
    },
    async barrios() {
      await assertRights(sourceRegistry, BARRIOS_SOURCE_ID, BARRIOS_LAYER_ID);
      const response = await fetchOk(fetch, {
        sourceId: BARRIOS_SOURCE_ID,
        url: BARRIOS_KMZ_URL,
        accept: "application/vnd.google-earth.kmz, application/zip",
      });
      try {
        return {
          features: parseBarriosKmz(response.body),
          observedAt: response.fetchedAt,
        };
      } catch (cause) {
        return schemaChanged(BARRIOS_SOURCE_ID, cause);
      }
    },
  };
}
