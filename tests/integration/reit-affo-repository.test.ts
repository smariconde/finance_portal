import { createHash, randomUUID } from "node:crypto";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresReitAffoRepository } from "@/server/db/postgres-reit-affo-repository";
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

describe("PostgreSQL REIT AFFO proposal", () => {
  it("records an abstention with exact evidence and honors the recorded cutoff", async () => {
    const repository = createPostgresReitAffoRepository(database);
    const legalEntityId = randomUUID();
    const excerpt =
      "FFO reconciled, but the issuer does not report an annual AFFO.";
    const stored = {
      proposal: {
        proposalId: randomUUID(),
        legalEntityId,
        cik: "0001045609",
        accessionNumber: "0001193125-26-051453",
        fiscalYearEnd: "2025-12-31",
        taskVersion: "reit-affo-1.0.0",
        promptVersion: "reit-affo-prompt-1.0.0",
        policyVersion: "reit-affo-policy-1.1.0",
        extractVersion: "sec-10k-reit-affo-1.0.0",
        expectedCommonIncome: "8000000",
        commonIncomeObservationId: randomUUID(),
        commonIncomeSourceDocumentId: "0001193125-26-051453",
        outcome: "abstained" as const,
        transcription: null,
        reason: "different_definition",
        acceptedRung: null,
        respondedModel: null,
        proposedAt: "2026-02-13T12:00:00.000Z",
        recordedAt: "2026-02-13T12:00:01.000Z",
      },
      evidence: {
        sourceId: "sec-edgar" as const,
        documentUrl:
          "https://www.sec.gov/Archives/edgar/data/1045609/000119312526051453/pld-20251231.htm",
        accessionNumber: "0001193125-26-051453",
        documentAcceptedAt: "2026-02-12T17:00:00.000Z",
        sha256: createHash("sha256").update(excerpt).digest("hex"),
        byteLength: Buffer.byteLength(excerpt),
        truncated: false,
        excerpt,
      },
    };
    await repository.record(stored);
    expect(await repository.latestForSubject(legalEntityId)).toEqual(stored);
    expect(
      await repository.acceptedAsKnown(
        legalEntityId,
        "2026-02-14T00:00:00.000Z",
      ),
    ).toBeNull();
  });
});
