import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll } from "vitest";

import { describeValuationJobStoreContract } from "@/modules/valuation/application/valuation-job-store.contract";
import { runValuation } from "@/modules/valuation/application/run-valuation";
import { DEMO_VALUATION_INPUT } from "@/modules/valuation/infrastructure/demo-valuation-fixtures";
import { createPostgresValuationJobStore } from "@/server/db/postgres-valuation-job-store";
import { createPostgresValuationRunRepository } from "@/server/db/postgres-valuation-run-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const JOB_STORE_ENTITY = "7a000000-0000-4000-8000-0000000000e6";

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
  // La FK a `valuation_runs` exige una corrida real. Es de una entidad propia:
  // la suite de corridas borra las de la entidad demo y no debe tocar esta.
  recordRun: async () =>
    (
      await createPostgresValuationRunRepository(database).record(
        runValuation(
          {
            ...DEMO_VALUATION_INPUT,
            subject: {
              ...DEMO_VALUATION_INPUT.subject,
              legalEntityId: JOB_STORE_ENTITY,
            },
          },
          {
            now: () => "2026-10-21T00:00:00.000Z",
            newValuationRunId: () => "7a000000-0000-4000-8000-0000000000f6",
          },
        ),
      )
    ).valuationRunId,
}));
