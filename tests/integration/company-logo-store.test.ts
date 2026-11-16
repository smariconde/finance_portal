import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresCompanyLogoStore } from "@/server/db/postgres-company-logo-store";
import * as schema from "@/server/db/schema";

const client = postgres(process.env.DATABASE_TEST_URL!.trim(), {
  max: 4,
  prepare: false,
});
const database = drizzle(client, { schema });
const store = createPostgresCompanyLogoStore(database);
const symbols: string[] = [];
const symbol = () => {
  const value = `L${randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase()}`;
  symbols.push(value);
  return value;
};
const now = "2026-11-16T12:00:00.000Z";
const later = "2026-11-16T12:01:01.000Z";
const logo = {
  bytes: new Uint8Array(
    readFileSync(
      new URL(
        "../../src/server/company-logos/fixtures/company-logo.png",
        import.meta.url,
      ),
    ),
  ),
  contentHash: "a".repeat(64),
  fetchedAt: now,
};
afterAll(async () => {
  if (symbols.length)
    await database
      .delete(schema.companyLogoAssets)
      .where(inArray(schema.companyLogoAssets.providerSymbol, symbols));
  await client.end();
});

describe("PostgreSQL durable logo and reservation", () => {
  it("supports the paired rollback and a clean reapply on the disposable test database", async () => {
    const down = readFileSync(
      "drizzle/rollback/0051_futuristic_the_fallen.down.sql",
      "utf8",
    );
    const up = readFileSync("drizzle/0051_futuristic_the_fallen.sql", "utf8");
    await expect(
      database.transaction(async (transaction) => {
        await transaction.execute(sql.raw(down));
        const [absent] = await transaction.execute(
          sql`select to_regclass('public.company_logo_assets') as name`,
        );
        expect(absent!.name).toBeNull();
        for (const statement of up.split("--> statement-breakpoint")) {
          await transaction.execute(sql.raw(statement));
        }
        const [present] = await transaction.execute(
          sql`select to_regclass('public.company_logo_assets') as name`,
        );
        expect(present!.name).toBe("company_logo_assets");
        // Restituye todo el estado del test: nunca se ejecuta sobre la base personal.
        throw new Error("rollback-test-complete");
      }),
    ).rejects.toThrow("rollback-test-complete");
  });
  it("allows only one of two concurrent claims and round-trips binary bytes", async () => {
    const ticker = symbol();
    const tokens = [randomUUID(), randomUUID()];
    const claims = await Promise.all(
      tokens.map((token) => store.claim(ticker, token, now)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.read(ticker)).toBeNull();
    await store.save(ticker, tokens[claims.indexOf(true)]!, logo);
    expect(await createPostgresCompanyLogoStore(database).read(ticker)).toEqual(
      logo,
    );
    expect(
      await store.claim(ticker, randomUUID(), "2027-01-01T00:00:00.000Z"),
    ).toBe(false);
  });
  it("recovers an expired lease and fences off a stale writer and deferred failure", async () => {
    const ticker = symbol();
    const old = randomUUID();
    const current = randomUUID();
    expect(await store.claim(ticker, old, now)).toBe(true);
    expect(await store.claim(ticker, current, later)).toBe(true);
    await store.save(ticker, old, logo);
    expect(await store.read(ticker)).toBeNull();
    await store.defer(ticker, old, "2028-01-01T00:00:00.000Z");
    await store.save(ticker, current, logo);
    await store.save(ticker, old, { ...logo, bytes: new Uint8Array([0]) });
    expect(await store.read(ticker)).toEqual(logo);
  });
  it("persists a negative cache across store instances and retries at its boundary", async () => {
    const ticker = symbol();
    const token = randomUUID();
    await store.claim(ticker, token, now);
    await store.defer(ticker, token, "2026-11-17T12:00:00.000Z");
    const next = createPostgresCompanyLogoStore(database);
    expect(await next.claim(ticker, randomUUID(), later)).toBe(false);
    expect(
      await next.claim(ticker, randomUUID(), "2026-11-17T12:00:00.000Z"),
    ).toBe(true);
  });
  it("rejects a partial stored image at the database boundary", async () => {
    const ticker = symbol();
    await expect(
      database.insert(schema.companyLogoAssets).values({
        assetId: randomUUID(),
        providerSymbol: ticker,
        sourceId: "logo-dev",
        parserVersion: "company-logo-png-1.0.0",
        retryAt: new Date(now),
        png: Buffer.from([1]),
      }),
    ).rejects.toThrow();
  });
});
