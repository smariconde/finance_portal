import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "./schema";

const runtimePostgresOptions = {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
  // Sin backoff de reconexión (`F7-05`). El cliente vive entre requests y, con
  // la base caída, el backoff exponencial de postgres.js acumulaba esperas:
  // medido contra un puerto cerrado, el tercer request tardó 35 s y el cuarto
  // 57 s en fallar. Una superficie que lee en el request tiene que decir «la
  // base no respondió» enseguida; reintentar es decisión del próximo request.
  backoff: () => 0,
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
