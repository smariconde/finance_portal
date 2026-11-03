import { describe, expect, it } from "vitest";

import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import { sourceRegistryEntrySchema } from "@/modules/ingestion/domain/source-registry-entry";

import { DECLARED_ARGENTINA_INDICATORS } from "../domain/declared-argentina-indicators";

import {
  ArgentinaSeriesSourceError,
  createLiveArgentinaSeriesSource,
} from "./live-argentina-series-source";

const indicator = DECLARED_ARGENTINA_INDICATORS.find(
  (item) => item.sourceId === "argentina-series-tiempo",
)!;

function body(points: readonly [string, number][], total = points.length) {
  return new TextEncoder().encode(
    JSON.stringify({
      data: points,
      count: total,
      meta: [
        {
          frequency: "month",
          start_date: points[0]?.[0] ?? "2025-01-01",
          end_date: points.at(-1)?.[0] ?? "2025-01-01",
        },
        {
          dataset: { source: "Synthetic INDEC" },
          field: { id: indicator.externalId, units: indicator.unit },
        },
      ],
      params: { ids: indicator.externalId },
    }),
  );
}

describe("live Argentina Series source", () => {
  it("checks rights before the first socket", async () => {
    const entry = DEMO_SOURCE_REGISTRY.find(
      (row) => row.sourceId === "argentina-series-tiempo",
    )!;
    const registry = createInMemorySourceRegistryRepository([
      ...DEMO_SOURCE_REGISTRY.filter((row) => row.sourceId !== entry.sourceId),
      sourceRegistryEntrySchema.parse({
        ...entry,
        approvalStatus: "rights_review_pending",
      }),
    ]);
    let calls = 0;
    const fetch: EgressFetch = async () => {
      calls += 1;
      throw new Error("should not fetch");
    };
    const source = createLiveArgentinaSeriesSource({
      sourceRegistry: registry,
      fetch,
    });
    await expect(source.load(indicator)).rejects.toMatchObject({
      code: "rights_not_approved",
    });
    expect(calls).toBe(0);
  });

  it("reads a complete page and names its source and observation time", async () => {
    const registry =
      createInMemorySourceRegistryRepository(DEMO_SOURCE_REGISTRY);
    const encoded = body([
      ["2025-01-01", 10],
      ["2025-02-01", 12],
    ]);
    const requests: string[] = [];
    const fetch: EgressFetch = async (request) => {
      requests.push(request.url);
      return {
        status: 200,
        body: encoded,
        byteLength: encoded.byteLength,
        fetchedAt: "2026-11-03T12:00:00Z",
      };
    };
    const source = createLiveArgentinaSeriesSource({
      sourceRegistry: registry,
      fetch,
    });
    const result = await source.load(indicator);
    expect(result.points).toEqual([
      { periodOn: "2025-01-01", value: "10" },
      { periodOn: "2025-02-01", value: "12" },
    ]);
    expect(result).toMatchObject({
      observedAt: "2026-11-03T12:00:00Z",
      sourceName: "Synthetic INDEC",
      requests: 1,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("start=0");
  });

  it("stops on a rate limit and does not publish a partial response", async () => {
    const registry =
      createInMemorySourceRegistryRepository(DEMO_SOURCE_REGISTRY);
    const fetch: EgressFetch = async () => ({
      status: 429,
      body: new Uint8Array(),
      byteLength: 0,
      fetchedAt: "2026-11-03T12:00:00Z",
      retryAfter: "60",
    });
    const source = createLiveArgentinaSeriesSource({
      sourceRegistry: registry,
      fetch,
    });
    await expect(source.load(indicator)).rejects.toMatchObject({
      code: "rate_limited",
      retryAfter: "60",
    });
  });

  it("refuses a tampered declaration", async () => {
    const registry =
      createInMemorySourceRegistryRepository(DEMO_SOURCE_REGISTRY);
    const fetch: EgressFetch = async () => {
      throw new Error("should not fetch");
    };
    const source = createLiveArgentinaSeriesSource({
      sourceRegistry: registry,
      fetch,
    });
    await expect(
      source.load({ ...indicator, unit: "new base" }),
    ).rejects.toBeInstanceOf(ArgentinaSeriesSourceError);
  });
});
