import "server-only";

import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { BusinessExcerptRepository } from "@/modules/companies/application/business-excerpt-repository";
import {
  businessExcerptSchema,
  SEC_BUSINESS_EXCERPT_VERSION,
  type BusinessExcerpt,
} from "@/modules/companies/domain/sec-business-excerpt";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

function toDomain(
  row: typeof schema.companyBusinessExcerpts.$inferSelect,
): BusinessExcerpt {
  return businessExcerptSchema.parse({
    ...row,
    acceptedAt: row.acceptedAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
  });
}

export function createPostgresBusinessExcerptRepository(
  database: Database,
): BusinessExcerptRepository {
  return {
    async record(value) {
      const excerpt = businessExcerptSchema.parse(value);
      await database.insert(schema.companyBusinessExcerpts).values({
        ...excerpt,
        acceptedAt: new Date(excerpt.acceptedAt),
        recordedAt: new Date(excerpt.recordedAt),
      });
    },
    async hasFiling(legalEntityId, accessionNumber, extractVersion) {
      const rows = await database
        .select({
          accessionNumber: schema.companyBusinessExcerpts.accessionNumber,
        })
        .from(schema.companyBusinessExcerpts)
        .where(
          and(
            eq(schema.companyBusinessExcerpts.legalEntityId, legalEntityId),
            eq(schema.companyBusinessExcerpts.accessionNumber, accessionNumber),
            eq(schema.companyBusinessExcerpts.extractVersion, extractVersion),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    async latestForEntities(legalEntityIds, knownAt) {
      if (legalEntityIds.length === 0) return new Map();
      const rows = await database
        .select()
        .from(schema.companyBusinessExcerpts)
        .where(
          and(
            inArray(
              schema.companyBusinessExcerpts.legalEntityId,
              legalEntityIds,
            ),
            lte(schema.companyBusinessExcerpts.acceptedAt, new Date(knownAt)),
            eq(
              schema.companyBusinessExcerpts.extractVersion,
              SEC_BUSINESS_EXCERPT_VERSION,
            ),
          ),
        )
        .orderBy(
          desc(schema.companyBusinessExcerpts.acceptedAt),
          desc(schema.companyBusinessExcerpts.recordedAt),
        );
      const latest = new Map<string, BusinessExcerpt>();
      for (const row of rows) {
        if (!latest.has(row.legalEntityId))
          latest.set(row.legalEntityId, toDomain(row));
      }
      return latest;
    },
  };
}
