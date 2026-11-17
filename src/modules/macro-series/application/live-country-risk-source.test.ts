import { describe, expect, it } from "vitest";

import type {
  EgressFetch,
  EgressFetchRequest,
} from "@/modules/ingestion/application/egress-fetch";
import { sourceRegistryEntrySchema } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";

import { DECLARED_COUNTRY_RISK } from "../domain/declared-country-risk";
import { DECLARED_SOY_INDICATORS } from "../domain/declared-soy-indicators";

import { createLiveCountryRiskSource } from "./live-country-risk-source";

const FETCHED_AT = "2026-11-17T21:40:00.000Z";
const now = () => new Date(FETCHED_AT);
const registry = createInMemorySourceRegistryRepository(DEMO_SOURCE_REGISTRY);

/** Synthetic: the shape measured on 2026-11-17, not a captured payload. */
function history(rows: readonly (readonly [string, string])[]): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([["Fecha", "Puntos"], ...rows]),
  );
}

function fakeFetch(
  respond: (request: EgressFetchRequest) => {
    readonly status?: number;
    readonly body: Uint8Array;
    readonly retryAfter?: string;
  },
) {
  const requests: EgressFetchRequest[] = [];
  const fetch: EgressFetch = async (request) => {
    requests.push(request);
    const { status = 200, body, retryAfter } = respond(request);
    return {
      status,
      body,
      byteLength: body.byteLength,
      fetchedAt: FETCHED_AT,
      ...(retryAfter === undefined ? {} : { retryAfter }),
    };
  };
  return { fetch, requests };
}

describe("live country risk source (ADR 0080)", () => {
  it("is personal only: no public display, export, AI nor owner assistant", () => {
    const entry = DEMO_SOURCE_REGISTRY.find(
      (row) => row.sourceId === "ambito-riesgo-pais",
    )!;
    expect(entry.rights).toMatchObject({
      automatedAccess: "owner_accepted",
      rawStorage: "restricted",
      normalizedStorage: "owner_accepted",
      publicDisplay: "restricted",
      export: "restricted",
      aiTransfer: "restricted",
      ownerAssistant: "restricted",
    });
  });

  it("checks the source's rights before opening a socket", async () => {
    const entry = DEMO_SOURCE_REGISTRY.find(
      (row) => row.sourceId === "ambito-riesgo-pais",
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
    await expect(
      createLiveCountryRiskSource({ sourceRegistry: pending, fetch, now }).load(
        DECLARED_COUNTRY_RISK,
      ),
    ).rejects.toMatchObject({ code: "rights_not_approved" });
    expect(requests).toHaveLength(0);
  });

  it("refuses an indicator it was not declared for", async () => {
    const { fetch, requests } = fakeFetch(() => {
      throw new Error("should not fetch");
    });
    await expect(
      createLiveCountryRiskSource({
        sourceRegistry: registry,
        fetch,
        now,
      }).load(DECLARED_SOY_INDICATORS[0]!),
    ).rejects.toMatchObject({ code: "not_declared" });
    expect(requests).toHaveLength(0);
  });

  it("asks the whole history of closes up to today, once, and names a refused day", async () => {
    const { fetch, requests } = fakeFetch(() => ({
      body: history([
        ["16-11-2026", "855,00"],
        ["13-11-2026", "830,00"],
        ["22-02-2021", "1509,00"],
        ["22-02-2021", "1501,00"],
      ]),
    }));
    const fetched = await createLiveCountryRiskSource({
      sourceRegistry: registry,
      fetch,
      now,
    }).load(DECLARED_COUNTRY_RISK);
    expect(requests).toEqual([
      {
        sourceId: "ambito-riesgo-pais",
        url: "https://mercados.ambito.com/riesgopais/historico-general/1990-01-01/2026-11-17",
        accept: "application/json",
      },
    ]);
    expect(fetched).toEqual({
      points: [
        { periodOn: "2026-11-13", value: "830" },
        { periodOn: "2026-11-16", value: "855" },
      ],
      observedAt: FETCHED_AT,
      requests: 1,
      bytes: expect.any(Number),
      rejectedDays: ["2021-02-22"],
    });
  });

  it.each([
    [429, "rate_limited"],
    [503, "rate_limited"],
    [404, "unexpected_status"],
  ])("names a %i without reading the body", async (status, code) => {
    const { fetch } = fakeFetch(() => ({
      status,
      body: new TextEncoder().encode("<html>"),
    }));
    await expect(
      createLiveCountryRiskSource({
        sourceRegistry: registry,
        fetch,
        now,
      }).load(DECLARED_COUNTRY_RISK),
    ).rejects.toMatchObject({ code });
  });

  it("names a changed layout by the parser's own reason", async () => {
    const { fetch } = fakeFetch(() => ({
      body: new TextEncoder().encode(JSON.stringify([["Date", "Points"]])),
    }));
    await expect(
      createLiveCountryRiskSource({
        sourceRegistry: registry,
        fetch,
        now,
      }).load(DECLARED_COUNTRY_RISK),
    ).rejects.toMatchObject({
      code: "schema_changed",
      detail: "layout_changed",
    });
  });

  it("keeps the door's code and never a message", async () => {
    const fetch: EgressFetch = async () => {
      throw Object.assign(new Error("https://mercados.ambito.com/secret"), {
        code: "daily_budget_exhausted",
      });
    };
    const error = await createLiveCountryRiskSource({
      sourceRegistry: registry,
      fetch,
      now,
    })
      .load(DECLARED_COUNTRY_RISK)
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      code: "fetch_failed",
      detail: "daily_budget_exhausted",
    });
    expect(String((error as Error).message)).not.toContain("ambito.com");
  });
});
