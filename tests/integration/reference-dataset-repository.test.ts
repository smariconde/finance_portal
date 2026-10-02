import { randomUUID } from "node:crypto";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  planReferenceRelease,
  type ReferenceRow,
} from "@/modules/reference-data/domain/reference-release";
import { createPostgresReferenceDatasetRepository } from "@/server/db/postgres-reference-dataset-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const DATASET = "damodaran.betas-us";

let sql: Sql;
let database: PostgresJsDatabase<typeof schema>;

async function run(): Promise<string> {
  const runId = randomUUID();
  const key = runId.replace(/-/gu, "").padEnd(64, "0");

  await database.insert(schema.ingestionRuns).values({
    runId,
    sourceId: "damodaran-current-data",
    datasetId: DATASET,
    parserVersion: "damodaran-html-1.0.0",
    idempotencyKey: key,
    status: "succeeded",
    startedAt: new Date("2026-10-02T12:00:00.000Z"),
    finishedAt: new Date("2026-10-02T12:00:01.000Z"),
    fetchedCount: 1,
    acceptedCount: 1,
    rejectedCount: 0,
    duplicateCount: 0,
    contentHash: key,
    recordedAt: new Date("2026-10-02T12:00:01.000Z"),
  });

  return runId;
}

function rows(beta: string): ReferenceRow[] {
  return [
    {
      key: "software-system-and-application",
      label: "Software (System & Application)",
      values: { beta, debt_to_equity: "0.0558", hilo_risk: null },
    },
  ];
}

async function plan(
  beta: string,
  observedAt: string,
  repository: ReturnType<typeof createPostgresReferenceDatasetRepository>,
) {
  const releases = await repository.listReleases(DATASET);
  const current =
    releases.find(
      (release) => release.validTo === null && release.supersededAt === null,
    ) ?? null;

  return planReferenceRelease({
    publication: {
      ok: true,
      datasetId: DATASET,
      parserVersion: "damodaran-html-1.0.0",
      publishedLabel: "January 2026",
      rows: rows(beta),
      rejections: [],
    },
    current,
    observedAt,
    recordedAt: observedAt,
    sourceId: "damodaran-current-data",
    sourceDocumentId:
      "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/Betas.html",
    ingestionRunId: await run(),
    contentHash: computeContentHash({ DATASET, beta }),
    newId: () => randomUUID(),
  });
}

beforeAll(() => {
  sql = postgres(databaseTestUrl, { max: 2 });
  database = drizzle(sql, { schema });
});

afterAll(async () => {
  // Vecinos vacían `ingestion_runs`: una release dejada atrás lo bloquearía.
  await database.delete(schema.referenceDatasetRows);
  await database.delete(schema.referenceDatasetReleases);
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await database.delete(schema.referenceDatasetRows);
  await database.delete(schema.referenceDatasetReleases);
});

describe("reference datasets on PostgreSQL", () => {
  it("stores a release with its rows, nulls included", async () => {
    const repository = createPostgresReferenceDatasetRepository(database);
    const first = await plan("1.28", "2026-10-02T12:00:00.000Z", repository);
    if (first.status !== "opened") throw new Error("expected a new release");

    await repository.applyReleasePlan(first);

    const [release] = await repository.listReleases(DATASET);
    expect(release).toMatchObject({
      datasetId: DATASET,
      publishedLabel: "January 2026",
      availableAt: "2026-10-02T12:00:00.000Z",
      supersededAt: null,
    });
    expect(await repository.loadRows(release!.releaseId)).toEqual(rows("1.28"));
  });

  it("supersedes the open release in the same transaction that opens the next", async () => {
    const repository = createPostgresReferenceDatasetRepository(database);
    const first = await plan("1.28", "2026-10-02T12:00:00.000Z", repository);
    if (first.status !== "opened") throw new Error("expected a new release");
    await repository.applyReleasePlan(first);

    const second = await plan("1.40", "2026-11-02T12:00:00.000Z", repository);
    if (second.status !== "opened") throw new Error("expected a new release");
    await repository.applyReleasePlan(second);

    const releases = await repository.listReleases(DATASET);
    expect(releases.map((release) => release.supersededAt)).toEqual([
      "2026-11-02T12:00:00.000Z",
      null,
    ]);
  });

  it("refuses a second open release and leaves the first intact", async () => {
    const repository = createPostgresReferenceDatasetRepository(database);
    const first = await plan("1.28", "2026-10-02T12:00:00.000Z", repository);
    if (first.status !== "opened") throw new Error("expected a new release");
    await repository.applyReleasePlan(first);

    // Un plan calculado sin ver la vigente intenta abrir otra al lado.
    const stale = {
      ...first,
      release: { ...first.release, releaseId: randomUUID() },
    };
    await expect(repository.applyReleasePlan(stale)).rejects.toThrow();
    expect(await repository.listReleases(DATASET)).toHaveLength(1);
  });
});
