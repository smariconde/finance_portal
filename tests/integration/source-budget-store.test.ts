import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import {
  BUDGET_T0,
  describeSourceBudgetStoreContract,
  uniqueBudgetSourceId,
} from "@/modules/ingestion/application/source-budget-store.contract";
import { createPostgresSourceBudgetStore } from "@/server/db/postgres-source-budget-store";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

let client: Sql;
let database: PostgresJsDatabase<typeof schema>;

beforeAll(() => {
  client = postgres(databaseTestUrl, {
    max: 12,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  });
  database = drizzle(client, { schema });
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
});

describeSourceBudgetStoreContract("postgres", {
  createStore: (budgets) => createPostgresSourceBudgetStore(database, budgets),
});

/**
 * Lo que sólo se puede probar con conexiones reales: el incremento condicionado
 * al tope es lo único que impide que dos procesos se pasen de la cuota, y un
 * doble en memoria no puede demostrarlo.
 */
describe("presupuesto bajo concurrencia real", () => {
  it("con doce llamadas simultáneas y un tope de cinco, pasan exactamente cinco", async () => {
    const sourceId = uniqueBudgetSourceId();
    const stores = Array.from({ length: 12 }, () =>
      createPostgresSourceBudgetStore(
        drizzle(
          postgres(databaseTestUrl, {
            max: 1,
            prepare: false,
            connect_timeout: 10,
          }),
          { schema },
        ),
        { [sourceId]: 5 },
      ),
    );

    const verdicts = await Promise.all(
      stores.map((store) => store.consume(sourceId, BUDGET_T0)),
    );

    expect(
      verdicts.filter((verdict) => verdict.status === "allowed"),
    ).toHaveLength(5);
    expect(
      verdicts.filter((verdict) => verdict.status === "daily_budget_exhausted"),
    ).toHaveLength(7);

    // Los cinco permitidos vieron contadores distintos: ninguno se pisó.
    expect(
      new Set(
        verdicts.flatMap((verdict) =>
          verdict.status === "allowed" ? [verdict.used] : [],
        ),
      ),
    ).toEqual(new Set([1, 2, 3, 4, 5]));

    const store = createPostgresSourceBudgetStore(database, { [sourceId]: 5 });

    expect(await store.readState(sourceId, BUDGET_T0)).toMatchObject({
      used: 5,
    });
  });

  it("dos procesos no pueden dejar dos controles vigentes de la misma fuente", async () => {
    const sourceId = uniqueBudgetSourceId();
    const store = createPostgresSourceBudgetStore(database, { [sourceId]: 5 });
    const change = (reason: string) => ({
      controlId: randomUUID(),
      sourceId,
      status: "disabled" as const,
      dailyRequestLimit: null,
      reason,
      actor: "owner",
      now: BUDGET_T0,
    });

    const results = await Promise.allSettled([
      store.setControl(change("uno")),
      store.setControl(change("dos")),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled").length,
    ).toBeGreaterThanOrEqual(1);
    expect(await store.listControlHistory(sourceId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ supersededAt: null })]),
    );
    expect(
      (await store.listControls()).filter(
        (control) => control.sourceId === sourceId,
      ),
    ).toHaveLength(1);
  });
});
