import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { directUrlFor, migrationTargetFromArgs } from "./migration-target";

const target = migrationTargetFromArgs();

const migrationClient = postgres(
  directUrlFor(target, process.env, "for the controlled migration job"),
  {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  },
);

try {
  await migrate(drizzle(migrationClient), {
    migrationsFolder: target.migrationsFolder,
  });
} finally {
  await migrationClient.end();
}
