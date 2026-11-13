import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { sameDatabaseTarget } from "@/modules/configuration/domain/database-target";

/**
 * Aplica `drizzle-trading/` una sola vez por corrida. Se niega si la base de
 * prueba es la de análisis o su base de prueba: esta suite revoca y vuelve a
 * otorgar privilegios de toda la base.
 */
export default async function setup() {
  const url = process.env.TRADING_DATABASE_TEST_URL?.trim();

  if (!url) {
    throw new Error(
      "TRADING_DATABASE_TEST_URL is required and must target a dedicated PostgreSQL trading test database.",
    );
  }

  for (const name of [
    "DATABASE_URL",
    "DATABASE_DIRECT_URL",
    "DATABASE_TEST_URL",
    "TRADING_DATABASE_URL",
    "TRADING_DATABASE_DIRECT_URL",
  ]) {
    if (sameDatabaseTarget(url, process.env[name] ?? "")) {
      throw new Error(
        `TRADING_DATABASE_TEST_URL names the same database as ${name}; the trading suite needs its own.`,
      );
    }
  }

  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });

  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle-trading" });
  } finally {
    await client.end();
  }
}
