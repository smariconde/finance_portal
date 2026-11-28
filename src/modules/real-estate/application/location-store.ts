import type { BarrioProperties } from "../domain/cordoba-barrios";
import type { GeorefResult } from "../domain/georef-addresses";
import type { RealEstatePortal } from "../domain/listing-capture";
import type { ParsedLayerFeature, ParcelAtPoint } from "../domain/idecor-wfs";
import type { ZoningFeatureProperties } from "../domain/idecor-wfs";
import type {
  LayerRelease,
  LocationListing,
  LocationReading,
} from "../domain/listing-location";
import type { ZoningQuery } from "../domain/zoning-resolution";

export type LocationLayerId = "idecor.cba-ordenanza-8256" | "cordoba.barrios";

export type LayerPropertiesOf<L extends LocationLayerId> =
  L extends "cordoba.barrios" ? BarrioProperties : ZoningFeatureProperties;

/** Lo que hace falta para decidir qué preguntar y para resolver lecturas. */
export type LocationState = {
  /** Cada aviso con su última revisión. */
  readonly listings: readonly {
    readonly listingId: string;
    readonly listing: LocationListing;
  }[];
  /** La última lectura de cada aviso: qué leyó y de qué revisión salió. */
  readonly readings: ReadonlyMap<
    string,
    { readonly inputHash: string; readonly listingRevision: number }
  >;
  readonly geocodes: ReadonlyMap<string, GeorefResult>;
  readonly lookups: ReadonlyMap<string, readonly ParcelAtPoint[]>;
  readonly queries: ReadonlyMap<string, ZoningQuery>;
};

export type LayerStatus<L extends LocationLayerId> = {
  readonly release: LayerRelease<LayerPropertiesOf<L>> | null;
  /** La última corrida que la bajó, publicara o no una release nueva. */
  readonly checkedAt: string | null;
};

/** La corrida que respalda una escritura (ADR 0018). */
export type LocationRun = {
  readonly runId: string;
  readonly sourceId: string;
  readonly datasetId: string;
  readonly parserVersion: string;
  readonly subjectKey: string | null;
  readonly startedAt: string;
  readonly observedAt: string;
  readonly recordedAt: string;
};

export type StoredListingLocation = {
  readonly revision: number;
  readonly listingRevision: number;
  readonly reading: LocationReading;
  readonly resolvedAt: string;
};

export type LocationStore = {
  readonly readState: () => Promise<LocationState>;
  readonly readLayer: <L extends LocationLayerId>(
    layerId: L,
  ) => Promise<LayerStatus<L>>;
  /** Una release nueva sólo si cambió el contenido; si no, la corrida es `duplicate`. */
  readonly recordLayer: <L extends LocationLayerId>(
    run: LocationRun,
    layerId: L,
    features: readonly ParsedLayerFeature<LayerPropertiesOf<L>>[],
  ) => Promise<{ readonly runId: string; readonly released: boolean }>;
  readonly recordGeocodes: (
    run: LocationRun,
    results: readonly {
      readonly addressKey: string;
      readonly result: GeorefResult;
    }[],
  ) => Promise<string>;
  /** También abre la parcela si es nueva (`re-parcel-1.0.0`). */
  readonly recordParcelLookup: (
    run: LocationRun,
    pointKey: string,
    parcels: readonly ParcelAtPoint[],
  ) => Promise<string>;
  /** Escribe sólo las lecturas cuya entrada cambió; devuelve cuántas. */
  readonly recordReadings: (
    readings: readonly {
      readonly listingId: string;
      readonly inputHash: string;
      readonly reading: LocationReading;
    }[],
    resolvedAt: string,
  ) => Promise<number>;
  readonly recordZoningQuery: (query: ZoningQuery) => Promise<number>;
  /** La última lectura de un aviso, por su clave en el portal. */
  readonly readListingLocation: (
    source: RealEstatePortal,
    externalId: string,
  ) => Promise<StoredListingLocation | null>;
};
