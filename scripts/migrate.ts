import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function getDirectDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const directUrl = environment.DATABASE_DIRECT_URL?.trim();

  if (!directUrl) {
    throw new Error(
      "DATABASE_DIRECT_URL is required for the controlled migration job.",
    );
  }

  return directUrl;
}

const migrationClient = postgres(getDirectDatabaseUrl(process.env), {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
});

try {
  await migrate(drizzle(migrationClient), { migrationsFolder: "drizzle" });
} finally {
  await migrationClient.end();
}
