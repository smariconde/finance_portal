import "server-only";

import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  sourceRegistryListQuerySchema,
  type SourceRegistryRepository,
} from "@/modules/ingestion/application/source-registry-repository";
import {
  sourceIdSchema,
  sourceRegistryEntrySchema,
  type SourceRegistryEntry,
} from "@/modules/ingestion/domain/source-registry-entry";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type SourceRegistryRow = typeof schema.sourceRegistry.$inferSelect;

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toRow(
  entry: SourceRegistryEntry,
): typeof schema.sourceRegistry.$inferInsert {
  return {
    sourceId: entry.sourceId,
    displayName: entry.displayName,
    owner: entry.owner,
    canonicalUrl: entry.canonicalUrl,
    documentationUrls: [...entry.documentationUrls],
    datasets: [...entry.datasets],
    endpoints: [...entry.endpoints],
    authentication: entry.authentication,
    applicablePlan: entry.applicablePlan,
    rateLimit: entry.rateLimit,
    attribution: entry.attribution,
    expectedCadence: entry.expectedCadence,
    freshnessTarget: entry.freshnessTarget,
    timezone: entry.timezone,
    units: [...entry.units],
    currencies: [...entry.currencies],
    parserVersion: entry.parserVersion,
    fixturePolicy: entry.fixturePolicy,
    fallbackSourceIds: [...entry.fallbackSourceIds],
    personalUseRight: entry.rights.personalUse,
    automatedAccessRight: entry.rights.automatedAccess,
    rawStorageRight: entry.rights.rawStorage,
    normalizedStorageRight: entry.rights.normalizedStorage,
    derivedStorageRight: entry.rights.derivedStorage,
    publicDisplayRight: entry.rights.publicDisplay,
    exportRight: entry.rights.export,
    aiTransferRight: entry.rights.aiTransfer,
    technicalStatus: entry.technicalStatus,
    approvalStatus: entry.approvalStatus,
    reviewedAt: toDate(entry.reviewedAt),
    rightsReviewedAt: toDate(entry.rightsReviewedAt),
    rightsReviewDueAt: toDate(entry.rightsReviewDueAt),
    reviewEvidence: [...entry.reviewEvidence],
    retentionClasses: [...entry.retentionClasses],
    quotaPolicyId: entry.quotaPolicyId,
    ownerNotes: entry.ownerNotes,
    recordedAt: new Date(entry.recordedAt),
  };
}

function toDomainEntry(row: SourceRegistryRow) {
  return sourceRegistryEntrySchema.parse({
    sourceId: row.sourceId,
    displayName: row.displayName,
    owner: row.owner,
    canonicalUrl: row.canonicalUrl,
    documentationUrls: row.documentationUrls,
    datasets: row.datasets,
    endpoints: row.endpoints,
    authentication: row.authentication,
    applicablePlan: row.applicablePlan,
    rateLimit: row.rateLimit,
    attribution: row.attribution,
    expectedCadence: row.expectedCadence,
    freshnessTarget: row.freshnessTarget,
    timezone: row.timezone,
    units: row.units,
    currencies: row.currencies,
    parserVersion: row.parserVersion,
    fixturePolicy: row.fixturePolicy,
    fallbackSourceIds: row.fallbackSourceIds,
    rights: {
      personalUse: row.personalUseRight,
      automatedAccess: row.automatedAccessRight,
      rawStorage: row.rawStorageRight,
      normalizedStorage: row.normalizedStorageRight,
      derivedStorage: row.derivedStorageRight,
      publicDisplay: row.publicDisplayRight,
      export: row.exportRight,
      aiTransfer: row.aiTransferRight,
    },
    technicalStatus: row.technicalStatus,
    approvalStatus: row.approvalStatus,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rightsReviewedAt: row.rightsReviewedAt?.toISOString() ?? null,
    rightsReviewDueAt: row.rightsReviewDueAt?.toISOString() ?? null,
    reviewEvidence: row.reviewEvidence,
    retentionClasses: row.retentionClasses,
    quotaPolicyId: row.quotaPolicyId,
    ownerNotes: row.ownerNotes,
    recordedAt: row.recordedAt.toISOString(),
  });
}

export function createPostgresSourceRegistryRepository(
  database: Database,
): SourceRegistryRepository {
  return {
    storage: "personal-postgres",
    async findBySourceId(sourceId) {
      const parsedSourceId = sourceIdSchema.parse(sourceId);
      const [row] = await database
        .select()
        .from(schema.sourceRegistry)
        .where(eq(schema.sourceRegistry.sourceId, parsedSourceId))
        .limit(1);

      return row ? toDomainEntry(row) : null;
    },
    async list(query) {
      const parsedQuery = sourceRegistryListQuerySchema.parse(query ?? {});
      const filters: SQL[] = [];

      if (parsedQuery.technicalStatus) {
        filters.push(
          inArray(
            schema.sourceRegistry.technicalStatus,
            parsedQuery.technicalStatus,
          ),
        );
      }

      if (parsedQuery.approvalStatus) {
        filters.push(
          inArray(
            schema.sourceRegistry.approvalStatus,
            parsedQuery.approvalStatus,
          ),
        );
      }

      const rows = await database
        .select()
        .from(schema.sourceRegistry)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(asc(schema.sourceRegistry.sourceId))
        .limit(parsedQuery.limit);

      return rows.map(toDomainEntry);
    },
    async upsert(entry) {
      const row = toRow(sourceRegistryEntrySchema.parse(entry));
      const [stored] = await database
        .insert(schema.sourceRegistry)
        .values(row)
        .onConflictDoUpdate({
          target: schema.sourceRegistry.sourceId,
          set: row,
        })
        .returning();

      return toDomainEntry(stored!);
    },
  };
}
