import { randomUUID } from "node:crypto";

import { inArray } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  describeRefreshStateStoreContract,
  REFRESH_DATASET_ID,
  REFRESH_SOURCE_ID,
  REFRESH_T0,
  REFRESH_T1,
  REFRESH_T2,
  uniqueRefreshSubjectKey,
} from "@/modules/ingestion/application/refresh-state-store.contract";
import { refreshStateSchema } from "@/modules/ingestion/application/refresh-state-store";
import { createPostgresRefreshStateStore } from "@/server/db/postgres-refresh-state-store";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

let client: Sql;
let database: PostgresJsDatabase<typeof schema>;
const createdRunIds: string[] = [];
const createdSubjectKeys: string[] = [];

/**
 * La marca referencia corridas reales, así que el harness tiene que crearlas.
 * Van como `empty`: es terminal, no es publicable y por eso no toca el índice
 * único de claves de idempotencia.
 */
async function createRunId(): Promise<string> {
  const runId = randomUUID();
  const instant = new Date(REFRESH_T0);

  await database.insert(schema.ingestionRuns).values({
    runId,
    sourceId: REFRESH_SOURCE_ID,
    datasetId: "sec.submissions",
    parserVersion: "sec-refresh-probe-1.0.0",
    idempotencyKey: randomUUID().replaceAll("-", "").repeat(2),
    status: "empty",
    startedAt: instant,
    finishedAt: instant,
    contentHash: "0".repeat(64),
    recordedAt: instant,
  });
  createdRunIds.push(runId);

  return runId;
}

function trackSubject(subjectKey: string): string {
  createdSubjectKeys.push(subjectKey);

  return subjectKey;
}

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
  if (database) {
    if (createdSubjectKeys.length > 0) {
      await database
        .delete(schema.ingestionRefreshState)
        .where(
          inArray(schema.ingestionRefreshState.subjectKey, createdSubjectKeys),
        );
    }
    await database
      .delete(schema.ingestionRefreshState)
      .where(inArray(schema.ingestionRefreshState.probeRunId, createdRunIds));
    if (createdRunIds.length > 0) {
      await database
        .delete(schema.ingestionRuns)
        .where(inArray(schema.ingestionRuns.runId, createdRunIds));
    }
  }
  await client?.end({ timeout: 5 });
});

describeRefreshStateStoreContract("postgres", {
  createStore: () => createPostgresRefreshStateStore(database),
  createRunId: async () => {
    const runId = await createRunId();
    return runId;
  },
});

/**
 * Lo que sólo se puede probar contra la base: las invariantes de la fila las
 * sostiene PostgreSQL, no sólo el schema de Zod, y dos procesos que sondean a la
 * vez no pueden dejar dos marcas del mismo sujeto.
 */
describe("marca de agua del refresh sobre PostgreSQL", () => {
  it("niega en la base una marca cuyo cambio es posterior a la mirada", async () => {
    const runId = await createRunId();
    const subjectKey = trackSubject(uniqueRefreshSubjectKey());

    await expect(
      database.insert(schema.ingestionRefreshState).values({
        sourceId: REFRESH_SOURCE_ID,
        datasetId: REFRESH_DATASET_ID,
        subjectKey,
        watermarkAcceptedAt: new Date("2026-07-31T10:01:02.000Z"),
        watermarkAccession: "0000320193-26-000079",
        formSelectionVersion: "sec-companyfacts-forms-1.0.0",
        probeVersion: "sec-refresh-probe-1.0.0",
        lastCheckedAt: new Date(REFRESH_T0),
        lastChangedAt: new Date(REFRESH_T2),
        probeRunId: runId,
        refreshRunId: runId,
        updatedAt: new Date(REFRESH_T0),
      }),
    ).rejects.toThrow();
  });

  it("niega un accession que no tiene la forma de la SEC", async () => {
    const runId = await createRunId();
    const subjectKey = trackSubject(uniqueRefreshSubjectKey());

    await expect(
      database.insert(schema.ingestionRefreshState).values({
        sourceId: REFRESH_SOURCE_ID,
        datasetId: REFRESH_DATASET_ID,
        subjectKey,
        watermarkAcceptedAt: new Date("2026-07-31T10:01:02.000Z"),
        watermarkAccession: "no-es-un-accession",
        formSelectionVersion: "sec-companyfacts-forms-1.0.0",
        probeVersion: "sec-refresh-probe-1.0.0",
        lastCheckedAt: new Date(REFRESH_T0),
        lastChangedAt: new Date(REFRESH_T0),
        probeRunId: runId,
        refreshRunId: runId,
        updatedAt: new Date(REFRESH_T0),
      }),
    ).rejects.toThrow();
  });

  it("dos sondeos simultáneos dejan una sola fila y la más nueva gana", async () => {
    const subjectKey = trackSubject(uniqueRefreshSubjectKey());
    const older = refreshStateSchema.parse({
      sourceId: REFRESH_SOURCE_ID,
      datasetId: REFRESH_DATASET_ID,
      subjectKey,
      watermarkAcceptedAt: "2026-07-31T10:01:02.000Z",
      watermarkAccession: "0000320193-26-000079",
      formSelectionVersion: "sec-companyfacts-forms-1.0.0",
      probeVersion: "sec-refresh-probe-1.0.0",
      lastCheckedAt: REFRESH_T0,
      lastChangedAt: REFRESH_T0,
      probeRunId: await createRunId(),
      refreshRunId: await createRunId(),
      updatedAt: REFRESH_T0,
    });
    const newer = refreshStateSchema.parse({
      ...older,
      watermarkAcceptedAt: "2026-10-30T18:04:11.000Z",
      watermarkAccession: "0000320193-26-000101",
      lastCheckedAt: REFRESH_T1,
      lastChangedAt: REFRESH_T1,
      probeRunId: await createRunId(),
      refreshRunId: await createRunId(),
      updatedAt: REFRESH_T1,
    });

    const stores = Array.from({ length: 2 }, () =>
      createPostgresRefreshStateStore(
        drizzle(
          postgres(databaseTestUrl, {
            max: 1,
            prepare: false,
            connect_timeout: 10,
          }),
          { schema },
        ),
      ),
    );

    await Promise.all([stores[0]!.record(newer), stores[1]!.record(older)]);

    const store = createPostgresRefreshStateStore(database);

    await expect(
      store.find({
        sourceId: REFRESH_SOURCE_ID,
        datasetId: REFRESH_DATASET_ID,
        subjectKey,
      }),
    ).resolves.toEqual(newer);
  });
});
