import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type {
  ListingStore,
  StoredListingHistory,
} from "@/modules/real-estate/application/listing-store";
import {
  LISTING_CAPTURE_VERSION,
  type RealEstatePortal,
} from "@/modules/real-estate/domain/listing-capture";
import {
  LISTING_REVISION_VERSION,
  planListingCapture,
  type ListingRevision,
  type StoredListing,
} from "@/modules/real-estate/domain/listing-revisions";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type ListingRow = typeof schema.reListings.$inferSelect;
type RevisionRow = typeof schema.reListingRevisions.$inferSelect;

/** Espacio de los locks consultivos de esta tabla (ver los demás repositorios). */
const LISTING_LOCK_NAMESPACE = 20_589;

function revisionOf(row: RevisionRow): ListingRevision {
  return {
    revision: row.revision,
    observedAt: row.observedAt.toISOString(),
    pageKind: row.pageKind as ListingRevision["pageKind"],
    parseBasis: row.parseBasis as ListingRevision["parseBasis"],
    status: row.status as ListingRevision["status"],
    removalEvidence: row.removalEvidence as ListingRevision["removalEvidence"],
    detailSeen: row.detailSeen,
    contentHash: row.contentHash,
    facts: {
      operation: row.operation as ListingRevision["facts"]["operation"],
      propertyType:
        row.propertyType as ListingRevision["facts"]["propertyType"],
      priceAmount: row.priceAmount,
      priceStatus: row.priceStatus as ListingRevision["facts"]["priceStatus"],
      priceCurrency:
        row.priceCurrency as ListingRevision["facts"]["priceCurrency"],
      expensesAmount: row.expensesAmount,
      expensesCurrency:
        row.expensesCurrency as ListingRevision["facts"]["expensesCurrency"],
      coveredAreaM2: row.coveredAreaM2,
      totalAreaM2: row.totalAreaM2,
      landAreaM2: row.landAreaM2,
      rooms: row.rooms,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      parkingSpaces: row.parkingSpaces,
      ageYears: row.ageYears,
      floor: row.floor,
      amenities: row.amenities as ListingRevision["facts"]["amenities"],
      condition: row.condition as ListingRevision["facts"]["condition"],
      legalFlags: row.legalFlags as ListingRevision["facts"]["legalFlags"],
      addressDeclared: row.addressDeclared,
      neighborhood: row.neighborhood,
      latitude: row.latitude,
      longitude: row.longitude,
      agency: row.agency,
      publishedAt: row.publishedAt,
      descriptionSimhash: row.descriptionSimhash,
      photoDhashes: row.photoDhashes,
      photoCount: row.photoCount,
    },
  };
}

function revisionRow(
  listingId: string,
  revision: ListingRevision,
  recordedAt: string,
): typeof schema.reListingRevisions.$inferInsert {
  const facts = revision.facts;
  return {
    listingId,
    revision: revision.revision,
    captureContract: LISTING_CAPTURE_VERSION,
    revisionRule: LISTING_REVISION_VERSION,
    observedAt: new Date(revision.observedAt),
    recordedAt: new Date(recordedAt),
    pageKind: revision.pageKind,
    parseBasis: revision.parseBasis,
    status: revision.status,
    removalEvidence: revision.removalEvidence,
    detailSeen: revision.detailSeen,
    contentHash: revision.contentHash,
    ...facts,
    amenities: [...facts.amenities],
    legalFlags: [...facts.legalFlags],
    photoDhashes: [...facts.photoDhashes],
  };
}

function listingOf(row: ListingRow) {
  return {
    source: row.sourceId as RealEstatePortal,
    externalId: row.externalId,
    canonicalUrl: row.canonicalUrl,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/**
 * Los avisos de la Fase 13 (ADR 0089, Decisión 3). Cada captura toma un lock
 * consultivo por `(fuente, id externo)` antes de leer, así dos pestañas que
 * envían el mismo aviso aplican la regla una después de la otra y la cadena
 * nunca tiene dos revisiones con el mismo número.
 */
export function createPostgresListingStore(database: Database): ListingStore {
  const listings = schema.reListings;
  const revisions = schema.reListingRevisions;

  return {
    async applyCapture(capture, recordedAt) {
      return database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${LISTING_LOCK_NAMESPACE}::int4, hashtext(${`${capture.source}:${capture.externalId}`}::text))`,
        );
        const [listing] = await tx
          .select()
          .from(listings)
          .where(
            and(
              eq(listings.sourceId, capture.source),
              eq(listings.externalId, capture.externalId),
            ),
          )
          .limit(1);
        let existing: StoredListing | null = null;
        if (listing !== undefined) {
          const [latest] = await tx
            .select()
            .from(revisions)
            .where(eq(revisions.listingId, listing.listingId))
            .orderBy(desc(revisions.revision))
            .limit(1);
          if (latest === undefined) throw new Error("listing_without_revision");
          existing = { ...listingOf(listing), latest: revisionOf(latest) };
        }

        const plan = planListingCapture({ existing, capture });
        switch (plan.kind) {
          case "new_listing": {
            const listingId = randomUUID();
            await tx.insert(listings).values({
              listingId,
              sourceId: plan.listing.source,
              externalId: plan.listing.externalId,
              canonicalUrl: plan.listing.canonicalUrl,
              firstSeenAt: new Date(plan.listing.firstSeenAt),
              lastSeenAt: new Date(plan.listing.lastSeenAt),
            });
            await tx
              .insert(revisions)
              .values(revisionRow(listingId, plan.revision, recordedAt));
            break;
          }
          case "revision":
            await tx
              .update(listings)
              .set({
                canonicalUrl: plan.canonicalUrl,
                lastSeenAt: new Date(plan.lastSeenAt),
              })
              .where(eq(listings.listingId, listing!.listingId));
            await tx
              .insert(revisions)
              .values(
                revisionRow(listing!.listingId, plan.revision, recordedAt),
              );
            break;
          case "seen":
            await tx
              .update(listings)
              .set({
                canonicalUrl: plan.canonicalUrl,
                lastSeenAt: new Date(plan.lastSeenAt),
              })
              .where(eq(listings.listingId, listing!.listingId));
            break;
          case "out_of_order":
            await tx
              .update(listings)
              .set({ firstSeenAt: new Date(plan.firstSeenAt) })
              .where(eq(listings.listingId, listing!.listingId));
            break;
        }
        return plan.kind;
      });
    },

    async readListing(source, externalId) {
      const [listing] = await database
        .select()
        .from(listings)
        .where(
          and(
            eq(listings.sourceId, source),
            eq(listings.externalId, externalId),
          ),
        )
        .limit(1);
      if (listing === undefined) return null;
      const rows = await database
        .select()
        .from(revisions)
        .where(eq(revisions.listingId, listing.listingId))
        .orderBy(asc(revisions.revision));
      const history: StoredListingHistory = {
        ...listingOf(listing),
        revisions: rows.map(revisionOf),
      };
      return history;
    },

    async listRecent(limit) {
      const recent = await database
        .select()
        .from(listings)
        .orderBy(desc(listings.lastSeenAt))
        .limit(limit);
      if (recent.length === 0) return [];
      const latest = await database
        .selectDistinctOn([revisions.listingId])
        .from(revisions)
        .where(
          sql`${revisions.listingId} in (${sql.join(
            recent.map((row) => sql`${row.listingId}::uuid`),
            sql`, `,
          )})`,
        )
        .orderBy(revisions.listingId, desc(revisions.revision));
      const byListing = new Map(latest.map((row) => [row.listingId, row]));
      return recent.flatMap((row) => {
        const revision = byListing.get(row.listingId);
        return revision === undefined
          ? []
          : [{ ...listingOf(row), latest: revisionOf(revision) }];
      });
    },
  };
}
