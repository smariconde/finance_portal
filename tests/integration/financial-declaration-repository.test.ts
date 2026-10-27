import { randomUUID } from "node:crypto";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createPostgresFinancialDeclarationRepository } from "@/server/db/postgres-financial-declaration-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const subject = randomUUID();
let client: Sql;
let database: PostgresJsDatabase<typeof schema>;

beforeAll(() => {
  client = postgres(databaseTestUrl, { max: 1, prepare: false });
  database = drizzle(client, { schema });
});

afterAll(async () => {
  await client?.end();
});

it("reads only the latest financial declaration visible at the cutoff", async () => {
  const repository = createPostgresFinancialDeclarationRepository(database);
  const common = {
    version: "financial-declaration-1.0.0" as const,
    legalEntityId: subject,
    fiscalYearEnd: "2025-12-31",
    payout: "0.5",
    rationale: "Owner reviewed the common earnings and distributable capital.",
    sourceDocumentId: "synthetic-financial-report",
    regulatoryCapital:
      "Owner reviewed the regulatory capital ratios in the filing.",
    assetQuality: "Owner reviewed the loan portfolio and loss reserves.",
    cleanSurplus:
      "Owner reconciled other comprehensive income and common equity.",
    commonBook: {
      currentValue: "120",
      priorValue: "100",
      priorFiscalYearEnd: "2024-12-31",
      currency: "USD",
    },
  };
  const first = {
    ...common,
    declarationId: randomUUID(),
    availableAt: "2026-02-01T00:00:00.000Z",
    recordedAt: "2026-02-01T00:00:00.000Z",
  };
  const second = {
    ...common,
    declarationId: randomUUID(),
    payout: "0.4",
    availableAt: "2026-03-01T00:00:00.000Z",
    recordedAt: "2026-03-01T00:00:00.000Z",
  };
  await repository.record(first);
  await repository.record(second);
  expect(
    await repository.latestAsKnown(
      subject,
      common.fiscalYearEnd,
      "2026-01-31T23:59:59.000Z",
    ),
  ).toBeNull();
  expect(
    await repository.latestAsKnown(
      subject,
      common.fiscalYearEnd,
      "2026-02-15T00:00:00.000Z",
    ),
  ).toMatchObject({ declarationId: first.declarationId, payout: "0.5" });
  expect(
    await repository.latestAsKnown(
      subject,
      common.fiscalYearEnd,
      "2026-03-02T00:00:00.000Z",
    ),
  ).toMatchObject({
    declarationId: second.declarationId,
    commonBook: common.commonBook,
  });
});
