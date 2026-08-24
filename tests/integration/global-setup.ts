import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Las migraciones se aplican una sola vez por corrida. Si cada archivo de test
 * llamara a `migrate`, dos workers en paralelo intentarían crear el mismo tipo o
 * tabla y la corrida fallaría por una carrera, no por el código bajo prueba.
 */
export default async function setup() {
  const databaseTestUrl = process.env.DATABASE_TEST_URL?.trim();

  if (!databaseTestUrl) {
    throw new Error(
      "DATABASE_TEST_URL is required and must target a dedicated PostgreSQL test database.",
    );
  }

  const client = postgres(databaseTestUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });

  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end();
  }
}
