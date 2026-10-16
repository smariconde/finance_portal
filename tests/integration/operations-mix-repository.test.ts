import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll } from "vitest";

import { describeOperationsMixRepositoryContract } from "@/modules/valuation/application/operations-mix-repository.contract";
import { createPostgresOperationsMixRepository } from "@/server/db/postgres-operations-mix-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

let client: Sql;
let database: PostgresJsDatabase<typeof schema>;

beforeAll(() => {
  client = postgres(databaseTestUrl, {
    max: 4,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  });
  database = drizzle(client, { schema });
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
});

describeOperationsMixRepositoryContract("postgres", {
  createRepository: () => createPostgresOperationsMixRepository(database),
});
