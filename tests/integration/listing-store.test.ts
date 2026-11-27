import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseListingCapture } from "@/modules/real-estate/domain/listing-capture";
import { PRICE_CUTS_TWICE } from "@/modules/real-estate/infrastructure/synthetic-listings";
import { createInMemoryListingStore } from "@/modules/real-estate/infrastructure/in-memory-listing-store";
import { createPostgresListingStore } from "@/server/db/postgres-listing-store";
import * as schema from "@/server/db/schema";

const client = postgres(process.env.DATABASE_TEST_URL!.trim(), {
  max: 4,
  onnotice: () => {},
});
const database = drizzle(client, { schema });
const RECORDED_AT = "2026-11-27T21:00:00.000Z";

const captures = PRICE_CUTS_TWICE.captures.map((raw) => {
  const parsed = parseListingCapture(raw);
  if (!parsed.ok) throw new Error("fixture capture must parse");
  return parsed.capture;
});
const { source, externalId } = captures[0];

async function cleanup() {
  const rows = await database
    .select({ listingId: schema.reListings.listingId })
    .from(schema.reListings)
    .where(inArray(schema.reListings.externalId, [externalId]));
  const ids = rows.map((row) => row.listingId);
  if (ids.length === 0) return;
  await database
    .delete(schema.reListingRevisions)
    .where(inArray(schema.reListingRevisions.listingId, ids));
  await database
    .delete(schema.reListings)
    .where(inArray(schema.reListings.listingId, ids));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await client.end();
});

/**
 * El store de avisos (`F13-02`) contra PostgreSQL hace exactamente lo que su
 * doble en memoria: la misma regla del dominio, ida y vuelta exacta de los
 * decimales y los conjuntos, y la idempotencia de un reenvío.
 */
describe("PostgreSQL listing store (ADR 0089)", () => {
  it("aplica la cadena como el doble y la relee igual", async () => {
    const store = createPostgresListingStore(database);
    const memory = createInMemoryListingStore();

    const outcomes = [];
    const expected = [];
    for (const capture of captures) {
      outcomes.push(await store.applyCapture(capture, RECORDED_AT));
      expected.push(await memory.applyCapture(capture, RECORDED_AT));
    }
    expect(outcomes).toEqual(expected);

    const stored = await store.readListing(source, externalId);
    const reference = await memory.readListing(source, externalId);
    expect(stored).toEqual(reference);

    // Reenviar la última captura es `out_of_order` y no agrega revisiones.
    expect(await store.applyCapture(captures.at(-1)!, RECORDED_AT)).toBe(
      "out_of_order",
    );
    expect(
      (await store.readListing(source, externalId))?.revisions,
    ).toHaveLength(reference!.revisions.length);

    const recent = await store.listRecent(5);
    const mine = recent.find((listing) => listing.externalId === externalId);
    expect(mine?.latest).toEqual(reference!.revisions.at(-1));
  });

  it("dos envíos simultáneos del mismo aviso nuevo dejan una sola revisión 1", async () => {
    await cleanup();
    const store = createPostgresListingStore(database);
    const results = await Promise.all([
      store.applyCapture(captures[0], RECORDED_AT),
      store.applyCapture(captures[0], RECORDED_AT),
    ]);
    expect([...results].sort()).toEqual(["new_listing", "out_of_order"]);
    expect(
      (await store.readListing(source, externalId))?.revisions,
    ).toHaveLength(1);
  });
});
