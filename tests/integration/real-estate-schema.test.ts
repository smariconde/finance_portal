import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { listingCaptureSchema } from "@/modules/real-estate/domain/listing-capture";
import {
  LISTING_REVISION_VERSION,
  planListingCapture,
  type ListingRevision,
} from "@/modules/real-estate/domain/listing-revisions";
import {
  PRICE_CUTS_TWICE,
  SHARED_PIN,
  SUBDIVIDED_PARCEL,
} from "@/modules/real-estate/infrastructure/synthetic-listings";
import * as schema from "@/server/db/schema";

const client = postgres(process.env.DATABASE_TEST_URL!.trim(), {
  max: 4,
  prepare: false,
});
const database = drizzle(client, { schema });
const listingIds: string[] = [];
const parcelIds: string[] = [];
const recordedAt = new Date("2026-11-27T12:00:00.000Z");

afterAll(async () => {
  if (listingIds.length) {
    await database
      .delete(schema.reListingRevisions)
      .where(inArray(schema.reListingRevisions.listingId, listingIds));
    await database
      .delete(schema.reListings)
      .where(inArray(schema.reListings.listingId, listingIds));
  }
  if (parcelIds.length) {
    await database
      .delete(schema.reParcelVersions)
      .where(inArray(schema.reParcelVersions.parcelId, parcelIds));
    await database
      .delete(schema.reParcels)
      .where(inArray(schema.reParcels.parcelId, parcelIds));
  }
  await client.end();
});

/** Lo que el repositorio de `F13-02` escribiría por una revisión. */
function revisionRow(listingId: string, revision: ListingRevision) {
  return {
    listingId,
    revision: revision.revision,
    captureContract: "listing-capture-1.0.0",
    revisionRule: LISTING_REVISION_VERSION,
    observedAt: new Date(revision.observedAt),
    recordedAt,
    pageKind: revision.pageKind,
    parseBasis: revision.parseBasis,
    status: revision.status,
    removalEvidence: revision.removalEvidence,
    detailSeen: revision.detailSeen,
    contentHash: revision.contentHash,
    ...revision.facts,
    amenities: [...revision.facts.amenities],
    legalFlags: [...revision.facts.legalFlags],
    photoDhashes: [...revision.facts.photoDhashes],
  };
}

async function insertListing(raw: unknown) {
  const capture = listingCaptureSchema.parse(raw);
  const plan = planListingCapture({ existing: null, capture });
  if (plan.kind !== "new_listing") throw new Error("expected a new listing");
  const listingId = randomUUID();
  listingIds.push(listingId);
  await database.insert(schema.reListings).values({
    listingId,
    sourceId: plan.listing.source,
    // Un ID por corrida: la base de test se comparte entre corridas.
    externalId: `${plan.listing.externalId}-${listingId.slice(0, 8)}`,
    canonicalUrl: plan.listing.canonicalUrl,
    firstSeenAt: new Date(plan.listing.firstSeenAt),
    lastSeenAt: new Date(plan.listing.lastSeenAt),
  });
  const row = revisionRow(listingId, plan.revision);
  await database.insert(schema.reListingRevisions).values(row);
  return { listingId, row };
}

const rollback = readFileSync(
  "drizzle/rollback/0060_real_estate_identity.down.sql",
  "utf8",
);
const up = readFileSync("drizzle/0060_real_estate_identity.sql", "utf8");
/** El rollback trae su propia transacción; adentro del test manda la del test. */
const rollbackBody = rollback
  .replace(/^BEGIN;$/mu, "")
  .replace(/^COMMIT;$/mu, "");

describe("PostgreSQL real-estate identity (migration 0060)", () => {
  it("supports the paired rollback and a clean reapply on the disposable test database", async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.execute(sql`delete from re_listing_revisions`);
        await transaction.execute(sql.raw(rollbackBody));
        const [absent] = await transaction.execute(
          sql`select to_regclass('public.re_listings') as name`,
        );
        expect(absent!.name).toBeNull();
        for (const statement of up.split("--> statement-breakpoint")) {
          await transaction.execute(sql.raw(statement));
        }
        const [present] = await transaction.execute(
          sql`select to_regclass('public.re_listing_revisions') as name`,
        );
        expect(present!.name).toBe("re_listing_revisions");
        // Restituye todo el estado del test: nunca se ejecuta sobre la base personal.
        throw new Error("rollback-test-complete");
      }),
    ).rejects.toThrow("rollback-test-complete");
  });

  it("refuses to roll back while captured listings exist", async () => {
    await insertListing(PRICE_CUTS_TWICE.captures[0]);
    await expect(
      database.transaction(async (transaction) => {
        await transaction.execute(sql.raw(rollbackBody));
      }),
    ).rejects.toThrow(/re_listing_revisions holds captured listings/u);
  });

  it("round-trips a revision exactly, decimals and sets included", async () => {
    const { listingId, row } = await insertListing(
      PRICE_CUTS_TWICE.captures[0],
    );
    const [stored] = await database
      .select()
      .from(schema.reListingRevisions)
      .where(eq(schema.reListingRevisions.listingId, listingId));
    expect(stored).toEqual(row);
    expect(stored!.coveredAreaM2).toBe("72.5");
    expect(stored!.priceAmount).toBe("120000");
  });

  it("stores «consultar precio» with a null price and a shared pin as given", async () => {
    const { row } = await insertListing(SHARED_PIN.captures[2]);
    expect(row.priceStatus).toBe("on_request");
    expect(row.priceAmount).toBeNull();
    expect(row.latitude).toBe(SHARED_PIN.latitude);
  });

  it("mirrors the contract: a zero price, a foreign amenity or a dangling removal are refused", async () => {
    const { listingId, row } = await insertListing(
      PRICE_CUTS_TWICE.captures[0],
    );
    const next = { ...row, revision: 2 };
    for (const [index, broken] of [
      { ...next, priceAmount: "0" },
      { ...next, amenities: ["jacuzzi"] },
      { ...next, status: "removed" },
      { ...next, priceStatus: "on_request" },
      { ...next, coveredAreaM2: "-1" },
      { ...next, photoDhashes: Array(6).fill("0123456789abcdef") },
      // Las ramas con NULL: un check desconocido pasaría.
      { ...next, priceAmount: null },
      { ...next, priceCurrency: null },
      { ...next, expensesCurrency: null },
      { ...next, latitude: "-31.4" },
    ].entries()) {
      await expect(
        database.insert(schema.reListingRevisions).values(broken),
        `broken row ${index}`,
      ).rejects.toThrow();
    }
    await expect(
      database
        .insert(schema.reListingRevisions)
        .values({ ...row, listingId: listingId, revision: 1 }),
    ).rejects.toThrow();
    await expect(
      database.insert(schema.reListings).values({
        listingId: randomUUID(),
        sourceId: "remax-ar",
        externalId: "SYN-X",
        canonicalUrl: "https://www.remax.com.ar/x?utm=1",
        firstSeenAt: recordedAt,
        lastSeenAt: recordedAt,
      }),
    ).rejects.toThrow();
  });

  it("keeps one open version per parcel and per nomenclature", async () => {
    const parcelId = randomUUID();
    parcelIds.push(parcelId);
    const suffix = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
    const nomenclature = `11-01-01-98-98-${suffix}-001`;
    await database
      .insert(schema.reParcels)
      .values({ parcelId, createdAt: recordedAt });
    const version = {
      parcelId,
      version: 1,
      provincialNomenclature: nomenclature,
      municipalNomenclature: null,
      landAreaM2: SUBDIVIDED_PARCEL.parcel.landAreaM2,
      validFrom: SUBDIVIDED_PARCEL.parcel.validFrom,
      validTo: null,
      endedBy: null,
      closedObservedAt: null,
      sourceId: "synthetic-cadastre",
      observedAt: new Date(SUBDIVIDED_PARCEL.parcel.observedAt),
      recordedAt,
    };
    await database.insert(schema.reParcelVersions).values(version);
    await expect(
      database
        .insert(schema.reParcelVersions)
        .values({ ...version, version: 2 }),
    ).rejects.toThrow();
    await expect(
      database.insert(schema.reParcelVersions).values({
        ...version,
        version: 2,
        validTo: "2026-03-01",
        endedBy: "subdivision",
        closedObservedAt: null,
      }),
    ).rejects.toThrow();
  });
});
