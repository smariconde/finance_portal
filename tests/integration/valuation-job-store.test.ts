import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll } from "vitest";

import { describeValuationJobStoreContract } from "@/modules/valuation/application/valuation-job-store.contract";
import { createPostgresValuationJobStore } from "@/server/db/postgres-valuation-job-store";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

let sqlClient: Sql;
let database: PostgresJsDatabase<typeof schema>;

beforeAll(() => {
  sqlClient = postgres(databaseTestUrl, { max: 1 });
  database = drizzle(sqlClient, { schema });
});

afterAll(async () => {
  await sqlClient.end();
});

describeValuationJobStoreContract("postgres", () => ({
  store: createPostgresValuationJobStore(database),
}));
