import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, isNull, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { CompanyLogoStore } from "@/modules/configuration/application/company-logo-store";
import {
  COMPANY_LOGO_PARSER_VERSION,
  COMPANY_LOGO_SOURCE_ID,
} from "@/server/company-logos/download-company-logo";

import * as schema from "./schema";

export function createPostgresCompanyLogoStore(
  database: PostgresJsDatabase<typeof schema>,
): CompanyLogoStore {
  const table = schema.companyLogoAssets;
  const key = (symbol: string) =>
    and(
      eq(table.sourceId, COMPANY_LOGO_SOURCE_ID),
      eq(table.providerSymbol, symbol),
    );
  const claimed = (symbol: string, token: string) =>
    and(key(symbol), eq(table.claimToken, token), isNull(table.png));
  return {
    async read(symbol) {
      const [row] = await database
        .select()
        .from(table)
        .where(key(symbol))
        .limit(1);
      return row?.png && row.contentHash && row.fetchedAt
        ? {
            bytes: new Uint8Array(row.png),
            contentHash: row.contentHash,
            fetchedAt: row.fetchedAt.toISOString(),
          }
        : null;
    },
    async claim(symbol, token, now) {
      const retryAt = new Date(Date.parse(now) + 60_000);
      const rows = await database
        .insert(table)
        .values({
          assetId: randomUUID(),
          providerSymbol: symbol,
          sourceId: COMPANY_LOGO_SOURCE_ID,
          parserVersion: COMPANY_LOGO_PARSER_VERSION,
          claimToken: token,
          retryAt,
        })
        .onConflictDoUpdate({
          target: [table.sourceId, table.providerSymbol],
          set: { claimToken: token, retryAt },
          setWhere: and(isNull(table.png), lte(table.retryAt, new Date(now))),
        })
        .returning({ id: table.assetId });
      return rows.length === 1;
    },
    async save(symbol, token, logo) {
      await database
        .update(table)
        .set({
          png: Buffer.from(logo.bytes),
          contentHash: logo.contentHash,
          fetchedAt: new Date(logo.fetchedAt),
          claimToken: null,
        })
        .where(claimed(symbol, token));
    },
    async defer(symbol, token, retryAt) {
      await database
        .update(table)
        .set({ claimToken: null, retryAt: new Date(retryAt) })
        .where(claimed(symbol, token));
    },
  };
}
