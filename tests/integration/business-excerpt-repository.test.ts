import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { SEC_BUSINESS_EXCERPT_VERSION } from "@/modules/companies/domain/sec-business-excerpt";
import { createPostgresBusinessExcerptRepository } from "@/server/db/postgres-business-excerpt-repository";
import * as schema from "@/server/db/schema";

const client = postgres(process.env.DATABASE_TEST_URL!.trim(), {
  max: 1,
  prepare: false,
});
const repository = createPostgresBusinessExcerptRepository(
  drizzle(client, { schema }),
);

afterAll(async () => client.end());

describe("business excerpt repository", () => {
  it("reads the latest reviewed version only when its filing was known at the cutoff", async () => {
    const legalEntityId = randomUUID();
    const base = {
      legalEntityId,
      cik: "0000320193",
      accessionNumber: "0000320193-25-000079",
      acceptedAt: "2025-10-31T10:07:30.000Z",
      documentUrl:
        "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
      excerpt:
        "The Company designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories, and sells a variety of related services.",
      extractVersion: SEC_BUSINESS_EXCERPT_VERSION,
      recordedAt: "2026-10-29T12:00:00.000Z",
    } as const;

    await repository.record(base);
    expect(
      await repository.hasFiling(
        legalEntityId,
        base.accessionNumber,
        base.extractVersion,
      ),
    ).toBe(true);
    expect(
      (
        await repository.latestForEntities(
          [legalEntityId],
          "2025-10-31T10:07:29.000Z",
        )
      ).size,
    ).toBe(0);
    expect(
      (
        await repository.latestForEntities(
          [legalEntityId],
          "2025-10-31T10:07:30.000Z",
        )
      ).get(legalEntityId)?.excerpt,
    ).toBe(base.excerpt);
  });
});
