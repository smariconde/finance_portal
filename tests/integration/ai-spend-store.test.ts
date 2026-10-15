import { randomUUID } from "node:crypto";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  describeAiSpendStoreContract,
  SPEND_T0,
} from "@/modules/ai/application/ai-spend-store.contract";
import { createPostgresAiSpendStore } from "@/server/db/postgres-ai-spend-store";
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

describeAiSpendStoreContract("postgres", {
  createStore: (limits) => {
    const controls = createPostgresSourceBudgetStore(database, {});

    return {
      store: createPostgresAiSpendStore(database, limits),
      setControl: async (control) => {
        await controls.setControl({
          controlId: randomUUID(),
          sourceId: control.sourceId,
          status: control.status,
          dailyRequestLimit: null,
          dailySpendLimitNanoUsd: control.dailySpendLimitNanoUsd,
          reason: "contract case",
          actor: "test",
          now: control.now,
        });
      },
    };
  },
});

/**
 * Lo que sólo se prueba con conexiones reales: el lock consultivo por fuente es
 * lo único que impide que dos procesos reserven a la vez el último dólar.
 */
describe("libro de gasto bajo concurrencia real", () => {
  it("con doce reservas simultáneas y lugar para cinco, entran exactamente cinco", async () => {
    const sourceId = `fixture-ai-${randomUUID().slice(0, 8)}`;
    const limits = {
      [sourceId]: { perTaskNanoUsd: 10_000, perDayNanoUsd: 500 },
    };
    const connections = Array.from({ length: 12 }, () =>
      postgres(databaseTestUrl, { max: 1, prepare: false }),
    );

    try {
      const verdicts = await Promise.all(
        connections.map((connection) =>
          createPostgresAiSpendStore(
            drizzle(connection, { schema }),
            limits,
          ).reserve({
            reservationId: randomUUID(),
            sourceId,
            taskRunId: randomUUID(),
            taskVersion: "ai-smoke-1.0.0",
            ladderVersion: "ai-model-ladder-1.0.0",
            rung: 1,
            requestedModel: "fixture/model-a",
            worstCaseNanoUsd: 100,
            now: SPEND_T0,
          }),
        ),
      );

      expect(
        verdicts.filter((verdict) => verdict.status === "reserved"),
      ).toHaveLength(5);
      expect(
        verdicts.filter(
          (verdict) => verdict.status === "daily_budget_exhausted",
        ),
      ).toHaveLength(7);
    } finally {
      await Promise.all(
        connections.map((connection) => connection.end({ timeout: 5 })),
      );
    }
  });

  it("rechaza en la base una fila cuyo día no es el de su reserva", async () => {
    await expect(
      database.insert(schema.aiSpendLedger).values({
        reservationId: randomUUID(),
        sourceId: "fixture-ai-day",
        taskRunId: randomUUID(),
        taskVersion: "ai-smoke-1.0.0",
        ladderVersion: "ai-model-ladder-1.0.0",
        rung: 1,
        requestedModel: "fixture/model-a",
        spendOn: "2026-10-14",
        status: "reserved",
        reservedNanoUsd: 100,
        reservedAt: new Date(SPEND_T0),
      }),
    ).rejects.toThrow();
  });
});
