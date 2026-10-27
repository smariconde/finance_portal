import "server-only";

import { and, desc, eq, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { FinancialDeclarationRepository } from "@/modules/valuation/application/financial-declaration-repository";
import { storedFinancialDeclarationSchema } from "@/modules/valuation/domain/financial-declaration";

import * as schema from "./schema";

export function createPostgresFinancialDeclarationRepository(
  database: PostgresJsDatabase<typeof schema>,
): FinancialDeclarationRepository {
  return {
    async record(candidate) {
      const declaration = storedFinancialDeclarationSchema.parse(candidate);
      await database.insert(schema.financialDeclarations).values({
        ...declaration,
        availableAt: new Date(declaration.availableAt),
        recordedAt: new Date(declaration.recordedAt),
      });
    },
    async latestAsKnown(legalEntityId, fiscalYearEnd, knownAt) {
      const [row] = await database
        .select()
        .from(schema.financialDeclarations)
        .where(
          and(
            eq(schema.financialDeclarations.legalEntityId, legalEntityId),
            eq(schema.financialDeclarations.fiscalYearEnd, fiscalYearEnd),
            lte(schema.financialDeclarations.availableAt, new Date(knownAt)),
            lte(schema.financialDeclarations.recordedAt, new Date(knownAt)),
          ),
        )
        .orderBy(
          desc(schema.financialDeclarations.availableAt),
          desc(schema.financialDeclarations.declarationId),
        )
        .limit(1);
      return row === undefined
        ? null
        : storedFinancialDeclarationSchema.parse({
            ...row,
            payout: row.payout,
            availableAt: row.availableAt.toISOString(),
            recordedAt: row.recordedAt.toISOString(),
          });
    },
  };
}
