import { describe, expect, it } from "vitest";

import type {
  EgressFetch,
  EgressFetchRequest,
} from "@/modules/ingestion/application/egress-fetch";
import { sourceRegistryEntrySchema } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";

import { declaredSoyIndicator } from "../domain/declared-soy-indicators";
import {
  bnaDivisasFixture,
  cacPizarraFixture,
  magypAnnualFixture,
  magypEstimacionesFixture,
} from "../infrastructure/fixture-soy-payloads";

import {
  createLiveBnaSource,
  createLiveCacPizarraSource,
  createLiveMagypSource,
  createLiveYahooFuturesSource,
} from "./live-soy-sources";

const FETCHED_AT = "2026-11-04T14:00:00.000Z";
const now = () => new Date(FETCHED_AT);
const registry = createInMemorySourceRegistryRepository(DEMO_SOURCE_REGISTRY);

function fakeFetch(
  respond: (request: EgressFetchRequest) => {
    readonly status?: number;
    readonly body: Uint8Array;
  },
) {
  const requests: EgressFetchRequest[] = [];
  const fetch: EgressFetch = async (request) => {
    requests.push(request);
    const { status = 200, body } = respond(request);
    return { status, body, byteLength: body.byteLength, fetchedAt: FETCHED_AT };
  };
  return { fetch, requests };
}

function indicator(id: string) {
  const found = declaredSoyIndicator(id);
  if (found === null) throw new Error(id);
  return found;
}

/** A Yahoo chart for a future: the whole day is the session. */
function chart(
  closes: readonly (readonly [epoch: number, close: number | null])[],
  overrides: Record<string, unknown> = {},
) {
  return new TextEncoder().encode(
    JSON.stringify({
      chart: {
        result: [
          {
            meta: {
              currency: "USX",
              symbol: "ZS=F",
              exchangeName: "CBT",
              exchangeTimezoneName: "America/New_York",
              gmtoffset: -18000,
              regularMarketTime: 1793799896,
              currentTradingPeriod: {
                regular: { start: 1793768400, end: 1793854740 },
              },
              ...overrides,
            },
            timestamp: closes.map(([epoch]) => epoch),
            indicators: {
              quote: [{ close: closes.map(([, close]) => close) }],
            },
          },
        ],
        error: null,
      },
    }),
  );
}

describe("live soy sources", () => {
  it("checks the source's rights before opening a socket", async () => {
    const entry = DEMO_SOURCE_REGISTRY.find(
      (row) => row.sourceId === "bcr-cac-pizarra",
    )!;
    const pending = createInMemorySourceRegistryRepository([
      ...DEMO_SOURCE_REGISTRY.filter((row) => row.sourceId !== entry.sourceId),
      sourceRegistryEntrySchema.parse({
        ...entry,
        approvalStatus: "rights_review_pending",
      }),
    ]);
    const { fetch, requests } = fakeFetch(() => {
      throw new Error("should not fetch");
    });
    const source = createLiveCacPizarraSource({
      sourceRegistry: pending,
      fetch,
      now,
    });
    await expect(
      source.load(indicator("soy_rosario_pizarra")),
    ).rejects.toMatchObject({ code: "rights_not_approved" });
    expect(requests).toHaveLength(0);
  });

  it("reads the board's whole history up to today", async () => {
    const { fetch, requests } = fakeFetch(() => ({
      body: cacPizarraFixture([
        ["46324.125", "S/C"],
        ["46328.125", { n: "542000.0" }],
      ]),
    }));
    const fetched = await createLiveCacPizarraSource({
      sourceRegistry: registry,
      fetch,
      now,
    }).load(indicator("soy_rosario_pizarra"));
    expect(requests[0]!.url).toContain("product=13");
    expect(requests[0]!.url).toContain("date_end=2026-11-04");
    expect(fetched).toMatchObject({
      points: [
        { periodOn: "2026-10-29", value: null },
        { periodOn: "2026-11-02", value: "542000" },
      ],
      observedAt: FETCHED_AT,
      requests: 1,
    });
  });

  it("names the parser's reason when the board changes its layout", async () => {
    const { fetch } = fakeFetch(() => ({
      body: cacPizarraFixture([["46328.125", { n: "1" }]], {
        product: "Trigo",
      }),
    }));
    await expect(
      createLiveCacPizarraSource({ sourceRegistry: registry, fetch, now }).load(
        indicator("soy_rosario_pizarra"),
      ),
    ).rejects.toMatchObject({
      code: "schema_changed",
      detail: "product_mismatch",
    });
  });

  it("reads Banco Nación's buyer quote since 2000", async () => {
    const { fetch, requests } = fakeFetch(() => ({
      body: bnaDivisasFixture([["3/11/2026", "1542,0000", "1551,0000"]]),
    }));
    const fetched = await createLiveBnaSource({
      sourceRegistry: registry,
      fetch,
      now,
    }).load(indicator("usd_bna_divisas_buyer"));
    expect(requests[0]!.url).toContain("fechaDesde=01%2F01%2F2000");
    expect(fetched.points).toEqual([{ periodOn: "2026-11-03", value: "1542" }]);
  });

  it("keeps a futures close out until its session is over", async () => {
    // 2026-11-03 and 2026-11-04 at midnight in New York.
    const { fetch, requests } = fakeFetch(() => ({
      body: chart([
        [1793682000, 1203],
        [1793768400, 1199.5],
      ]),
    }));
    const fetched = await createLiveYahooFuturesSource({
      sourceRegistry: registry,
      fetch,
      now,
    }).load(indicator("soy_cbot_front"));
    expect(requests[0]!.url).toMatch(/\/chart\/ZS%3DF\?period1=946684800&/u);
    expect(fetched.points).toEqual([{ periodOn: "2026-11-03", value: "1203" }]);
  });

  it("refuses a chart of another instrument or unit", async () => {
    for (const overrides of [{ currency: "USD" }, { symbol: "ZC=F" }]) {
      const { fetch } = fakeFetch(() => ({
        body: chart([[1793682000, 1203]], overrides),
      }));
      await expect(
        createLiveYahooFuturesSource({
          sourceRegistry: registry,
          fetch,
          now,
        }).load(indicator("soy_cbot_front")),
      ).rejects.toMatchObject({
        code: "schema_changed",
        detail: "instrument_mismatch",
      });
    }
  });

  it("serves the four estimates from one form post and one CC BY file", async () => {
    const { fetch, requests } = fakeFetch((request) => ({
      body:
        request.sourceId === "magyp-estimaciones"
          ? magypEstimacionesFixture([
              ["2024/25", "1100000", "1080000", "3300000", "3056"],
              ["2025/26", "1050000", "1040000", "3200000", "3077"],
            ])
          : magypAnnualFixture([
              ["2024", "1100000", "1080000", "3300000", "3055.56"],
            ]),
    }));
    const source = createLiveMagypSource({
      sourceRegistry: registry,
      fetch,
      now,
    });
    const production = await source.load(indicator("soy_production"));
    const yields = await source.load(indicator("soy_yield"));
    expect(requests.map((request) => request.method ?? "GET")).toEqual([
      "POST",
      "GET",
    ]);
    expect(requests[0]!.contentType).toBe("application/x-www-form-urlencoded");
    expect(production).toMatchObject({
      points: [
        { periodOn: "2024-07-01", value: "3300000" },
        { periodOn: "2025-07-01", value: "3200000" },
      ],
      requests: 2,
    });
    expect(yields).toMatchObject({
      points: [
        { periodOn: "2024-07-01", value: "3056" },
        { periodOn: "2025-07-01", value: "3077" },
      ],
      requests: 0,
    });
  });

  it("stops every estimate of the run when the CC BY file disagrees", async () => {
    const { fetch, requests } = fakeFetch((request) => ({
      body:
        request.sourceId === "magyp-estimaciones"
          ? magypEstimacionesFixture([
              ["2024/25", "1100000", "1080000", "3300000", "3056"],
            ])
          : magypAnnualFixture([
              ["2024", "1100000", "1080000", "3400000", "3055.56"],
            ]),
    }));
    const source = createLiveMagypSource({
      sourceRegistry: registry,
      fetch,
      now,
    });
    for (const id of ["soy_production", "soy_area_sown"]) {
      await expect(source.load(indicator(id))).rejects.toMatchObject({
        code: "reconciliation_failed",
        detail: "2024/25 production_t",
      });
    }
    expect(requests).toHaveLength(2);
  });

  it("refuses an indicator that is not the declared one", async () => {
    const { fetch } = fakeFetch(() => ({ body: new Uint8Array() }));
    await expect(
      createLiveBnaSource({ sourceRegistry: registry, fetch, now }).load({
        ...indicator("usd_bna_divisas_buyer"),
        externalId: "2",
      }),
    ).rejects.toMatchObject({ code: "not_declared" });
  });
});
