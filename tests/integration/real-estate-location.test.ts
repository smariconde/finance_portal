import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { parseBarriosKml } from "@/modules/real-estate/domain/cordoba-barrios";
import {
  parseZoningLayer,
  type ParcelAtPoint,
} from "@/modules/real-estate/domain/idecor-wfs";
import { parseListingCapture } from "@/modules/real-estate/domain/listing-capture";
import {
  locationInputHash,
  resolveListingLocation,
} from "@/modules/real-estate/domain/listing-location";
import { SAME_HOUSE_THREE_AGENCIES } from "@/modules/real-estate/infrastructure/synthetic-listings";
import {
  syntheticBarriosKml,
  syntheticZoningLayer,
} from "@/modules/real-estate/infrastructure/synthetic-location";
import { createPostgresListingStore } from "@/server/db/postgres-listing-store";
import { createPostgresLocationStore } from "@/server/db/postgres-location-store";
import * as schema from "@/server/db/schema";

const client = postgres(process.env.DATABASE_TEST_URL!.trim(), {
  max: 4,
  onnotice: () => {},
});
const database = drizzle(client, { schema });
// Instantes propios de la corrida: la clave de idempotencia los incluye.
const BASE = Date.UTC(2026, 10, 28, 12) + Math.floor(Math.random() * 1e9);
const at = (minutes: number) => new Date(BASE + minutes * 60_000).toISOString();
const NOW = at(0);
const suffix = randomUUID().slice(0, 8);
// Una nomenclatura por corrida: la base de test se comparte entre corridas.
const NOMENCLATURE = `110101${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;
const runIds: string[] = [];
const listingIds: string[] = [];

const run = (datasetId: string, subjectKey: string, observedAt = NOW) => {
  const runId = randomUUID();
  runIds.push(runId);
  return {
    runId,
    sourceId: datasetId.startsWith("georef")
      ? "georef-ar"
      : datasetId.startsWith("cordoba")
        ? "cordoba-gobierno-abierto"
        : "idecor-geoserver",
    datasetId,
    parserVersion: "test-1.0.0",
    subjectKey,
    startedAt: observedAt,
    observedAt,
    recordedAt: observedAt,
  };
};

afterAll(async () => {
  if (listingIds.length) {
    await database
      .delete(schema.reListingLocations)
      .where(inArray(schema.reListingLocations.listingId, listingIds));
    await database
      .delete(schema.reListingRevisions)
      .where(inArray(schema.reListingRevisions.listingId, listingIds));
    await database
      .delete(schema.reListings)
      .where(inArray(schema.reListings.listingId, listingIds));
  }
  await database
    .delete(schema.reZoningQueries)
    .where(eq(schema.reZoningQueries.nomenclature, NOMENCLATURE));
  const parcels = await database
    .select({ parcelId: schema.reParcelVersions.parcelId })
    .from(schema.reParcelVersions)
    .where(eq(schema.reParcelVersions.provincialNomenclature, NOMENCLATURE));
  if (parcels.length) {
    const ids = parcels.map((row) => row.parcelId);
    await database
      .delete(schema.reParcelVersions)
      .where(inArray(schema.reParcelVersions.parcelId, ids));
    await database
      .delete(schema.reParcels)
      .where(inArray(schema.reParcels.parcelId, ids));
  }
  if (runIds.length) {
    await database
      .delete(schema.rePointParcelLookups)
      .where(inArray(schema.rePointParcelLookups.runId, runIds));
    await database
      .delete(schema.reAddressGeocodes)
      .where(inArray(schema.reAddressGeocodes.runId, runIds));
    const releases = await database
      .select({ releaseId: schema.reGeoLayerReleases.releaseId })
      .from(schema.reGeoLayerReleases)
      .where(inArray(schema.reGeoLayerReleases.runId, runIds));
    if (releases.length) {
      const ids = releases.map((row) => row.releaseId);
      await database
        .delete(schema.reGeoLayerFeatures)
        .where(inArray(schema.reGeoLayerFeatures.releaseId, ids));
      await database
        .delete(schema.reGeoLayerReleases)
        .where(inArray(schema.reGeoLayerReleases.releaseId, ids));
    }
    await database
      .delete(schema.ingestionRuns)
      .where(inArray(schema.ingestionRuns.runId, runIds));
  }
  await client.end();
});

const rollback = readFileSync(
  "drizzle/rollback/0061_real_estate_location.down.sql",
  "utf8",
)
  .replace(/^BEGIN;$/mu, "")
  .replace(/^COMMIT;$/mu, "");
const up = readFileSync("drizzle/0061_real_estate_location.sql", "utf8");

describe("PostgreSQL location store (migration 0061)", () => {
  it("supports the paired rollback and a clean reapply", async () => {
    await expect(
      database.transaction(async (tx) => {
        await tx.execute(sql`delete from re_listing_locations`);
        await tx.execute(sql`delete from re_zoning_queries`);
        await tx.execute(sql.raw(rollback));
        const [absent] = await tx.execute(
          sql`select to_regclass('public.re_listing_locations') as name`,
        );
        expect(absent!.name).toBeNull();
        for (const statement of up.split("--> statement-breakpoint"))
          await tx.execute(sql.raw(statement));
        const [present] = await tx.execute(
          sql`select to_regclass('public.re_geo_layer_features') as name`,
        );
        expect(present!.name).toBe("re_geo_layer_features");
        throw new Error("rollback-test-complete");
      }),
    ).rejects.toThrow("rollback-test-complete");
  });

  it("stores layers, answers and readings, each only when it changes", async () => {
    const store = createPostgresLocationStore(database);
    const listings = createPostgresListingStore(database);
    const parsed = parseListingCapture({
      ...SAME_HOUSE_THREE_AGENCIES.captures[0],
      externalId: `loc-${suffix}`,
      canonicalUrl: `${SAME_HOUSE_THREE_AGENCIES.captures[0].canonicalUrl}-loc-${suffix}`,
    });
    if (!parsed.ok) throw new Error("fixture capture must parse");
    await listings.applyCapture(parsed.capture, NOW);
    const [row] = await database
      .select({ listingId: schema.reListings.listingId })
      .from(schema.reListings)
      .where(eq(schema.reListings.externalId, `loc-${suffix}`));
    listingIds.push(row.listingId);

    // La misma capa dos veces: una release y una corrida `duplicate`.
    const zoningFeatures = parseZoningLayer(syntheticZoningLayer());
    expect(
      (
        await store.recordLayer(
          run("idecor.cba-ordenanza-8256", "layer"),
          "idecor.cba-ordenanza-8256",
          zoningFeatures,
        )
      ).released,
    ).toBe(true);
    const again = run("idecor.cba-ordenanza-8256", "layer", at(5));
    expect(
      (
        await store.recordLayer(
          again,
          "idecor.cba-ordenanza-8256",
          zoningFeatures,
        )
      ).released,
    ).toBe(false);
    const [duplicate] = await database
      .select({ status: schema.ingestionRuns.status })
      .from(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.runId, again.runId));
    expect(duplicate.status).toBe("duplicate");
    await store.recordLayer(
      run("cordoba.barrios", "layer"),
      "cordoba.barrios",
      parseBarriosKml(syntheticBarriosKml()),
    );
    const layer = await store.readLayer("idecor.cba-ordenanza-8256");
    expect(layer.checkedAt).toBe(at(5));
    expect(
      layer.release?.features.map((feature) => feature.key).sort(),
    ).toEqual(zoningFeatures.map((feature) => feature.key).sort());

    const parcels: ParcelAtPoint[] = [
      {
        nomenclature: NOMENCLATURE,
        landAreaM2: "310",
        state: "EDIFICADO NoPH",
        parcelType: "URBANO",
      },
    ];
    const state = await store.readState();
    const mine = state.listings.find(
      (entry) => entry.listingId === row.listingId,
    )!;
    const point = `${Number(mine.listing.latitude).toFixed(7)},${Number(mine.listing.longitude).toFixed(7)}`;
    await store.recordParcelLookup(
      run("idecor.parcelas", point),
      point,
      parcels,
    );
    // Otra superficie un día después: la parcela se corrige, no se duplica.
    await store.recordParcelLookup(
      run("idecor.parcelas", point, at(24 * 60 * 2)),
      point,
      [{ ...parcels[0], landAreaM2: "311" }],
    );
    const versions = await database
      .select()
      .from(schema.reParcelVersions)
      .where(eq(schema.reParcelVersions.provincialNomenclature, NOMENCLATURE));
    expect(versions.map((v) => [v.version, v.landAreaM2, v.endedBy])).toEqual(
      expect.arrayContaining([
        [1, "310", "correction"],
        [2, "311", null],
      ]),
    );

    const fresh = await store.readState();
    const listing = {
      ...mine.listing,
      propertyType: "house" as const,
      landAreaM2: "300",
    };
    const barrios = await store.readLayer("cordoba.barrios");
    const zoning = await store.readLayer("idecor.cba-ordenanza-8256");
    const inputs = {
      listing,
      pinShared: false,
      geocode: null,
      parcelsAt: (key: string) => fresh.lookups.get(key),
      zoningQueryFor: () => null,
    };
    const reading = resolveListingLocation({
      ...inputs,
      barrios: barrios.release,
      zoning: zoning.release,
    });
    const inputHash = locationInputHash({
      ...inputs,
      barriosRelease: barrios.release!.releaseId,
      zoningRelease: zoning.release!.releaseId,
    });
    expect(reading.parcel.status).toBe("matched");
    const entry = { listingId: row.listingId, inputHash, reading };
    expect(await store.recordReadings([entry], NOW)).toBe(1);
    expect(await store.recordReadings([entry], NOW)).toBe(0);

    const [stored] = await database
      .select()
      .from(schema.reListingLocations)
      .where(eq(schema.reListingLocations.listingId, row.listingId));
    expect(stored.parcelId).toBe(versions[0].parcelId);
    expect(stored.parcelStatus).toBe("matched");
    expect(
      await store.readListingLocation(parsed.capture.source, `loc-${suffix}`),
    ).toMatchObject({
      revision: 1,
      reading: { parcel: { status: "matched" } },
    });

    const query = {
      nomenclature: NOMENCLATURE,
      pattern: "8256-G2",
      ordinance: "Ord. 8256/86",
      fos: "0.6",
      fot: "1.5",
      heightMaxM: "12",
      floorsMax: 4,
      consultedOn: "2026-12-01",
      reference: "Expediente sintético",
      declaredAt: NOW,
    };
    expect(await store.recordZoningQuery(query)).toBe(1);
    expect(
      await store.recordZoningQuery({ ...query, declaredAt: at(10) }),
    ).toBe(1);
    expect((await store.readState()).queries.get(NOMENCLATURE)?.pattern).toBe(
      "8256-G2",
    );
  });

  it("refuses to roll back while a reading exists", async () => {
    await expect(
      database.transaction(async (tx) => {
        await tx.execute(sql.raw(rollback));
        // Si la guarda no saltara, nada se confirma igual.
        throw new Error("guard-did-not-fire");
      }),
    ).rejects.toThrow(/location readings or zoning queries exist/u);
  });
});
