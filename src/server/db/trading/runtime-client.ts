import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import {
  parseDatabaseTarget,
  sameDatabaseTarget,
} from "@/modules/configuration/domain/database-target";

import * as schema from "./schema";

/**
 * Cliente de la base de trading
 * ([ADR 0076](../../../../docs/architecture/adr/0076-schwab-read-only-account-trading-journal.md)).
 *
 * Mismas opciones que el de análisis y por las mismas razones —una conexión por
 * instancia detrás del pooler, sin prepared statements, sin backoff de
 * reconexión—, pero otro cliente: cada base tiene su cuota y sus credenciales, y
 * la cuenta tiene que responder aunque la de análisis esté caída.
 */
const tradingPostgresOptions = {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
  backoff: () => 0,
} as const;

const globalForTradingPostgres = globalThis as typeof globalThis & {
  financePortalTradingPostgres?: Sql;
};

/**
 * Lee sólo `TRADING_DATABASE_URL`. Nunca cae en `DATABASE_URL`, y se niega si
 * las dos nombran la misma base: el health ya lo marca, pero este es el último
 * punto antes de abrir un socket.
 */
export function resolveTradingDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const pooledUrl = environment.TRADING_DATABASE_URL?.trim();

  if (!pooledUrl) {
    throw new Error(
      "TRADING_DATABASE_URL is required for the trading database.",
    );
  }

  if (!parseDatabaseTarget(pooledUrl)) {
    throw new Error("TRADING_DATABASE_URL is not a PostgreSQL URL.");
  }

  if (sameDatabaseTarget(pooledUrl, environment.DATABASE_URL ?? "")) {
    throw new Error(
      "TRADING_DATABASE_URL names the analysis database; trading needs its own.",
    );
  }

  return pooledUrl;
}

function getTradingSqlClient(): Sql {
  if (globalForTradingPostgres.financePortalTradingPostgres) {
    return globalForTradingPostgres.financePortalTradingPostgres;
  }

  const client = postgres(
    resolveTradingDatabaseUrl(process.env),
    tradingPostgresOptions,
  );

  if (process.env.NODE_ENV !== "production") {
    globalForTradingPostgres.financePortalTradingPostgres = client;
  }

  return client;
}

export function getTradingDatabase() {
  return drizzle(getTradingSqlClient(), { schema });
}
