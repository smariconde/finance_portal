import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  computeIdempotencyKey,
  ingestionRunSchema,
} from "@/modules/ingestion/domain/ingestion-run";
import type {
  LocationRun,
  LocationState,
  LocationStore,
} from "@/modules/real-estate/application/location-store";
import { georefResultSchema } from "@/modules/real-estate/domain/georef-addresses";
import type { MultiPolygon } from "@/modules/real-estate/domain/geo-geometry";
import {
  parcelAtPointSchema,
  type ParcelAtPoint,
} from "@/modules/real-estate/domain/idecor-wfs";
import type { PropertyType } from "@/modules/real-estate/domain/listing-capture";
import {
  locationReadingHash,
  locationReadingSchema,
  parcelAffirmed,
} from "@/modules/real-estate/domain/listing-location";
import { planParcelCorrection } from "@/modules/real-estate/domain/parcel";
import { zoningQueryFileSchema } from "@/modules/real-estate/domain/zoning-query";
import type { ZoningQuery } from "@/modules/real-estate/domain/zoning-resolution";

import { toIngestionRunRow } from "./postgres-ingestion-run-repository";
import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const {
  ingestionRuns: runs,
  reAddressGeocodes: geocodes,
  reGeoLayerFeatures: features,
  reGeoLayerReleases: releases,
  reListingLocations: locations,
  reListingRevisions: revisions,
  reParcelVersions: parcelVersions,
  reParcels: parcels,
  rePointParcelLookups: lookups,
  reZoningQueries: queries,
} = schema;

/** Espacio de los locks consultivos de la ubicación (ver los demás repositorios). */
const LOCATION_LOCK_NAMESPACE = 20_590;
const FEATURE_BATCH = 200;

const storedQuerySchema = zoningQueryFileSchema.extend({
  declaredAt: z.iso.datetime({ offset: true }),
});

/** La corrida de una escritura: una por contenido y observación. */
async function insertRun(
  tx: Transaction,
  run: LocationRun,
  content: unknown,
  counts: { fetched: number; duplicate: number },
  qualityFlags: string[] = [],
): Promise<void> {
  const contentHash = computeContentHash(content);
  const status =
    counts.fetched === 0
      ? "empty"
      : counts.duplicate === counts.fetched
        ? "duplicate"
        : "succeeded";
  const parsed = ingestionRunSchema.parse({
    runId: run.runId,
    sourceId: run.sourceId,
    datasetId: run.datasetId,
    parserVersion: run.parserVersion,
    idempotencyKey: computeIdempotencyKey({
      sourceId: run.sourceId,
      datasetId: run.datasetId,
      parserVersion: run.parserVersion,
      requestedAsOf: run.observedAt.slice(0, 10),
      cursor: null,
      subjectKey: run.subjectKey,
      documentVersion: computeContentHash({
        content: contentHash,
        observedAt: run.observedAt,
      }),
    }),
    requestedAsOf: run.observedAt.slice(0, 10),
    cursor: null,
    nextCursor: null,
    subjectKey: run.subjectKey,
    status,
    startedAt: run.startedAt,
    finishedAt: run.recordedAt,
    counts: {
      fetched: counts.fetched,
      accepted: status === "succeeded" ? counts.fetched : 0,
      rejected: 0,
      duplicate: status === "duplicate" ? counts.fetched : 0,
    },
    contentHash,
    failure: null,
    qualityFlags,
    replayOfRunId: null,
    recordedAt: run.recordedAt,
  });
  await tx.insert(runs).values(toIngestionRunRow(parsed));
}

/** La parcela abierta con esa nomenclatura, o una nueva. Devuelve su ID. */
async function ensureParcel(
  tx: Transaction,
  parcel: ParcelAtPoint,
  sourceId: string,
  observedAt: string,
): Promise<string> {
  const [open] = await tx
    .select()
    .from(parcelVersions)
    .where(
      and(
        eq(parcelVersions.provincialNomenclature, parcel.nomenclature),
        isNull(parcelVersions.validTo),
      ),
    )
    .limit(1);
  const observedOn = observedAt.slice(0, 10);
  if (open === undefined) {
    const parcelId = randomUUID();
    await tx
      .insert(parcels)
      .values({ parcelId, createdAt: new Date(observedAt) });
    await tx.insert(parcelVersions).values({
      parcelId,
      version: 1,
      provincialNomenclature: parcel.nomenclature,
      municipalNomenclature: null,
      landAreaM2: parcel.landAreaM2,
      validFrom: observedOn,
      validTo: null,
      endedBy: null,
      closedObservedAt: null,
      sourceId,
      observedAt: new Date(observedAt),
      recordedAt: new Date(observedAt),
    });
    return parcelId;
  }
  // La misma parcela con otra superficie es una corrección de la fuente; el
  // mismo día no se versiona dos veces.
  if (open.landAreaM2 !== parcel.landAreaM2 && open.validFrom < observedOn) {
    const plan = planParcelCorrection({
      parcel: {
        parcelId: open.parcelId,
        version: open.version,
        nomenclature: {
          provincial: open.provincialNomenclature,
          municipal: open.municipalNomenclature,
        },
        landAreaM2: open.landAreaM2,
        validFrom: open.validFrom,
        validTo: null,
        endedBy: null,
        closedObservedAt: null,
        sourceId: open.sourceId,
        observedAt: open.observedAt.toISOString(),
      },
      nomenclature: {
        provincial: parcel.nomenclature,
        municipal: open.municipalNomenclature,
      },
      landAreaM2: parcel.landAreaM2,
      effectiveOn: observedOn,
      sourceId,
      observedAt,
    });
    for (const close of plan.close)
      await tx
        .update(parcelVersions)
        .set({
          validTo: close.validTo,
          endedBy: close.endedBy,
          closedObservedAt: new Date(close.closedObservedAt),
        })
        .where(
          and(
            eq(parcelVersions.parcelId, close.parcelId),
            eq(parcelVersions.version, close.version),
          ),
        );
    for (const version of plan.open)
      await tx.insert(parcelVersions).values({
        parcelId: version.parcelId,
        version: version.version,
        provincialNomenclature: version.nomenclature.provincial,
        municipalNomenclature: version.nomenclature.municipal,
        landAreaM2: version.landAreaM2,
        validFrom: version.validFrom,
        validTo: null,
        endedBy: null,
        closedObservedAt: null,
        sourceId: version.sourceId,
        observedAt: new Date(version.observedAt),
        recordedAt: new Date(observedAt),
      });
  }
  return open.parcelId;
}

export function createPostgresLocationStore(db: Database): LocationStore {
  const lock = (tx: Transaction, key: string) =>
    tx.execute(
      sql`select pg_advisory_xact_lock(${LOCATION_LOCK_NAMESPACE}, hashtext(${key}))`,
    );

  return {
    async readState(): Promise<LocationState> {
      const [latest, located, coded, looked, declared] = await Promise.all([
        db
          .selectDistinctOn([revisions.listingId], {
            listingId: revisions.listingId,
            revision: revisions.revision,
            propertyType: revisions.propertyType,
            addressDeclared: revisions.addressDeclared,
            neighborhood: revisions.neighborhood,
            latitude: revisions.latitude,
            longitude: revisions.longitude,
            landAreaM2: revisions.landAreaM2,
          })
          .from(revisions)
          .orderBy(revisions.listingId, desc(revisions.revision)),
        db
          .selectDistinctOn([locations.listingId], {
            listingId: locations.listingId,
            inputHash: locations.inputHash,
            listingRevision: locations.listingRevision,
          })
          .from(locations)
          .orderBy(locations.listingId, desc(locations.revision)),
        db
          .selectDistinctOn([geocodes.addressKey], {
            addressKey: geocodes.addressKey,
            result: geocodes.result,
          })
          .from(geocodes)
          .orderBy(geocodes.addressKey, desc(geocodes.revision)),
        db
          .selectDistinctOn([lookups.pointKey], {
            pointKey: lookups.pointKey,
            parcels: lookups.parcels,
          })
          .from(lookups)
          .orderBy(lookups.pointKey, desc(lookups.revision)),
        db
          .selectDistinctOn([queries.nomenclature], {
            nomenclature: queries.nomenclature,
            query: queries.query,
          })
          .from(queries)
          .orderBy(queries.nomenclature, desc(queries.revision)),
      ]);
      return {
        listings: latest.map((row) => ({
          listingId: row.listingId,
          listing: {
            revision: row.revision,
            propertyType: row.propertyType as PropertyType,
            addressDeclared: row.addressDeclared,
            neighborhood: row.neighborhood,
            latitude: row.latitude,
            longitude: row.longitude,
            landAreaM2: row.landAreaM2,
          },
        })),
        readings: new Map(
          located.map((row) => [
            row.listingId,
            { inputHash: row.inputHash, listingRevision: row.listingRevision },
          ]),
        ),
        geocodes: new Map(
          coded.map((row) => [
            row.addressKey,
            georefResultSchema.parse(row.result),
          ]),
        ),
        lookups: new Map(
          looked.map((row) => [
            row.pointKey,
            parcelAtPointSchema.array().parse(row.parcels),
          ]),
        ),
        queries: new Map(
          declared.map((row) => [
            row.nomenclature,
            storedQuerySchema.parse(row.query) as ZoningQuery,
          ]),
        ),
      };
    },

    async readLayer(layerId) {
      const [release] = await db
        .select()
        .from(releases)
        .where(eq(releases.layerId, layerId))
        .orderBy(desc(releases.availableAt))
        .limit(1);
      const [checked] = await db
        .select({ at: max(runs.finishedAt) })
        .from(runs)
        .where(
          and(
            eq(runs.datasetId, layerId),
            inArray(runs.status, ["succeeded", "duplicate"]),
          ),
        );
      const checkedAt = checked?.at ? checked.at.toISOString() : null;
      if (release === undefined) return { release: null, checkedAt };
      const rows = await db
        .select()
        .from(features)
        .where(eq(features.releaseId, release.releaseId));
      return {
        checkedAt,
        release: {
          releaseId: release.releaseId,
          observedAt: release.availableAt.toISOString(),
          features: rows.map((row) => ({
            key: row.featureKey,
            box: {
              minLon: row.minLon,
              minLat: row.minLat,
              maxLon: row.maxLon,
              maxLat: row.maxLat,
            },
            geometry: row.geometry as MultiPolygon,
            properties: row.properties as never,
          })),
        },
      };
    },

    async recordLayer(run, layerId, parsed) {
      const sorted = [...parsed].sort((a, b) => a.key.localeCompare(b.key));
      const contentHash = computeContentHash(sorted);
      return db.transaction(async (tx) => {
        await lock(tx, layerId);
        const [latest] = await tx
          .select({ contentHash: releases.contentHash })
          .from(releases)
          .where(eq(releases.layerId, layerId))
          .orderBy(desc(releases.availableAt))
          .limit(1);
        const unchanged = latest?.contentHash === contentHash;
        await insertRun(
          tx,
          run,
          sorted,
          {
            fetched: sorted.length,
            duplicate: unchanged ? sorted.length : 0,
          },
          unchanged ? ["unchanged_layer"] : [],
        );
        if (unchanged) return { runId: run.runId, released: false };
        const releaseId = randomUUID();
        await tx.insert(releases).values({
          releaseId,
          layerId,
          runId: run.runId,
          contentHash,
          featureCount: sorted.length,
          availableAt: new Date(run.observedAt),
          recordedAt: new Date(run.recordedAt),
        });
        const rows = sorted.map((feature) => {
          let minLon = Infinity;
          let minLat = Infinity;
          let maxLon = -Infinity;
          let maxLat = -Infinity;
          for (const polygon of feature.geometry)
            for (const [lon, lat] of polygon[0]) {
              minLon = Math.min(minLon, lon);
              minLat = Math.min(minLat, lat);
              maxLon = Math.max(maxLon, lon);
              maxLat = Math.max(maxLat, lat);
            }
          return {
            releaseId,
            featureKey: feature.key,
            properties: feature.properties,
            geometry: feature.geometry,
            minLon,
            minLat,
            maxLon,
            maxLat,
          };
        });
        for (let offset = 0; offset < rows.length; offset += FEATURE_BATCH)
          await tx
            .insert(features)
            .values(rows.slice(offset, offset + FEATURE_BATCH));
        return { runId: run.runId, released: true };
      });
    },

    async recordGeocodes(run, results) {
      return db.transaction(async (tx) => {
        await lock(tx, "georef");
        await insertRun(tx, run, results, {
          fetched: results.length,
          duplicate: 0,
        });
        const keys = results.map((entry) => entry.addressKey);
        const latest =
          keys.length === 0
            ? []
            : await tx
                .selectDistinctOn([geocodes.addressKey], {
                  addressKey: geocodes.addressKey,
                  revision: geocodes.revision,
                  result: geocodes.result,
                })
                .from(geocodes)
                .where(inArray(geocodes.addressKey, keys))
                .orderBy(geocodes.addressKey, desc(geocodes.revision));
        const byKey = new Map(latest.map((row) => [row.addressKey, row]));
        const rows = results.flatMap((entry) => {
          const prior = byKey.get(entry.addressKey);
          if (
            prior &&
            computeContentHash(prior.result) ===
              computeContentHash(entry.result)
          )
            return [];
          return [
            {
              addressKey: entry.addressKey,
              revision: (prior?.revision ?? 0) + 1,
              runId: run.runId,
              status: entry.result.status,
              result: entry.result,
              observedAt: new Date(run.observedAt),
            },
          ];
        });
        for (let offset = 0; offset < rows.length; offset += 500)
          await tx.insert(geocodes).values(rows.slice(offset, offset + 500));
        return run.runId;
      });
    },

    async recordParcelLookup(run, pointKey, found) {
      return db.transaction(async (tx) => {
        await lock(tx, `point:${pointKey}`);
        await insertRun(tx, run, found, {
          fetched: found.length,
          duplicate: 0,
        });
        const [prior] = await tx
          .select({ revision: lookups.revision, parcels: lookups.parcels })
          .from(lookups)
          .where(eq(lookups.pointKey, pointKey))
          .orderBy(desc(lookups.revision))
          .limit(1);
        if (
          prior === undefined ||
          computeContentHash(prior.parcels) !== computeContentHash(found)
        )
          await tx.insert(lookups).values({
            pointKey,
            revision: (prior?.revision ?? 0) + 1,
            runId: run.runId,
            parcels: found,
            observedAt: new Date(run.observedAt),
          });
        for (const parcel of found) {
          await lock(tx, `parcel:${parcel.nomenclature}`);
          await ensureParcel(tx, parcel, run.sourceId, run.observedAt);
        }
        return run.runId;
      });
    },

    async recordReadings(readings, resolvedAt) {
      let written = 0;
      for (const entry of readings) {
        const reading = locationReadingSchema.parse(entry.reading);
        await db.transaction(async (tx) => {
          await lock(tx, `listing:${entry.listingId}`);
          const [prior] = await tx
            .select({
              revision: locations.revision,
              inputHash: locations.inputHash,
            })
            .from(locations)
            .where(eq(locations.listingId, entry.listingId))
            .orderBy(desc(locations.revision))
            .limit(1);
          if (prior?.inputHash === entry.inputHash) return;
          let parcelId: string | null = null;
          if (
            parcelAffirmed(reading.parcel.status) &&
            reading.parcel.candidate !== null
          ) {
            const [open] = await tx
              .select({ parcelId: parcelVersions.parcelId })
              .from(parcelVersions)
              .where(
                and(
                  eq(
                    parcelVersions.provincialNomenclature,
                    reading.parcel.candidate.nomenclature,
                  ),
                  isNull(parcelVersions.validTo),
                ),
              )
              .limit(1);
            parcelId = open?.parcelId ?? null;
          }
          const affirmed = parcelId !== null;
          // Sin la parcela guardada no se afirma: la lectura queda candidata.
          const stored = affirmed
            ? reading
            : parcelAffirmed(reading.parcel.status)
              ? {
                  ...reading,
                  parcel: {
                    ...reading.parcel,
                    status: "area_unverified" as const,
                  },
                }
              : reading;
          await tx.insert(locations).values({
            listingId: entry.listingId,
            revision: (prior?.revision ?? 0) + 1,
            listingRevision: stored.listingRevision,
            inputHash: entry.inputHash,
            readingHash: locationReadingHash(stored),
            reading: stored,
            precision: stored.precision,
            parcelStatus: stored.parcel.status,
            zoningConfidence: stored.zoning.confidence,
            parcelId,
            resolvedAt: new Date(resolvedAt),
            recordedAt: new Date(),
          });
          written += 1;
        });
      }
      return written;
    },

    async recordZoningQuery(query) {
      return db.transaction(async (tx) => {
        await lock(tx, `zoning:${query.nomenclature}`);
        const [prior] = await tx
          .select({ revision: queries.revision, query: queries.query })
          .from(queries)
          .where(eq(queries.nomenclature, query.nomenclature))
          .orderBy(desc(queries.revision))
          .limit(1);
        const content = { ...query, declaredAt: null };
        if (prior !== undefined) {
          const stored = { ...(prior.query as ZoningQuery), declaredAt: null };
          if (computeContentHash(stored) === computeContentHash(content))
            return prior.revision;
        }
        const revision = (prior?.revision ?? 0) + 1;
        await tx.insert(queries).values({
          nomenclature: query.nomenclature,
          revision,
          query,
          consultedOn: query.consultedOn,
          declaredAt: new Date(query.declaredAt),
        });
        return revision;
      });
    },

    async readListingLocation(source, externalId) {
      const [row] = await db
        .select({
          revision: locations.revision,
          listingRevision: locations.listingRevision,
          reading: locations.reading,
          resolvedAt: locations.resolvedAt,
        })
        .from(locations)
        .innerJoin(
          schema.reListings,
          eq(schema.reListings.listingId, locations.listingId),
        )
        .where(
          and(
            eq(schema.reListings.sourceId, source),
            eq(schema.reListings.externalId, externalId),
          ),
        )
        .orderBy(desc(locations.revision))
        .limit(1);
      if (row === undefined) return null;
      return {
        revision: row.revision,
        listingRevision: row.listingRevision,
        reading: locationReadingSchema.parse(row.reading),
        resolvedAt: row.resolvedAt.toISOString(),
      };
    },
  };
}
