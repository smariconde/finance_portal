import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "./schema";

const runtimePostgresOptions = {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
} as const;

const globalForPostgres = globalThis as typeof globalThis & {
  financePortalPostgres?: Sql;
};

export function resolveRuntimeDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const pooledUrl = environment.DATABASE_URL?.trim();

  if (!pooledUrl) {
    throw new Error("DATABASE_URL is required for personal runtime storage.");
  }

  return pooledUrl;
}

function getRuntimeSqlClient(): Sql {
  if (globalForPostgres.financePortalPostgres) {
    return globalForPostgres.financePortalPostgres;
  }

  const client = postgres(
    resolveRuntimeDatabaseUrl(process.env),
    runtimePostgresOptions,
  );

  if (process.env.NODE_ENV !== "production") {
    globalForPostgres.financePortalPostgres = client;
  }

  return client;
}

export function getRuntimeDatabase() {
  return drizzle(getRuntimeSqlClient(), { schema });
}
