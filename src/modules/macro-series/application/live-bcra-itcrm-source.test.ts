import { describe, expect, it } from "vitest";

import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { sourceRegistryEntrySchema } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import { buildXlsx } from "@/modules/reference-data/infrastructure/fixture-xlsx";

import { DECLARED_ITCRM } from "../domain/declared-argentina-indicators";

import { createLiveBcraItcrmSource } from "./live-bcra-itcrm-source";

const fixture = buildXlsx([
  {
    name: "ITCRM y bilaterales",
    rows: [
      ["Índices con base 17-12-15=100"],
      ["Período", "ITCRM ", "ITCRB Brasil"],
      ...Array.from({ length: 1_000 }, (_, i) => [
        { n: String(35_431 + i) },
        { n: "86.348001144279905" },
        { n: "120" },
      ]),
    ],
  },
]);

function source(fetch: EgressFetch, approved = true) {
  const entries = approved
    ? DEMO_SOURCE_REGISTRY
    : DEMO_SOURCE_REGISTRY.map((entry) =>
        entry.sourceId === "bcra-itcrm-xlsx"
          ? sourceRegistryEntrySchema.parse({
              ...entry,
              approvalStatus: "rights_review_pending",
            })
          : entry,
      );
  return createLiveBcraItcrmSource({
    sourceRegistry: createInMemorySourceRegistryRepository(entries),
    fetch,
  });
}

describe("BCRA ITCRM source", () => {
  it("checks rights before opening a socket", async () => {
    let calls = 0;
    await expect(
      source(async () => {
        calls++;
        throw new Error("unexpected request");
      }, false).load(DECLARED_ITCRM),
    ).rejects.toMatchObject({ code: "rights_not_approved" });
    expect(calls).toBe(0);
  });

  it("reads only its declared workbook through one metered request", async () => {
    const requests: string[] = [];
    const fetched = await source(async (request) => {
      requests.push(`${request.sourceId} ${request.url} ${request.accept}`);
      return {
        status: 200,
        body: fixture,
        byteLength: fixture.byteLength,
        fetchedAt: "2026-11-12T12:00:00Z",
      };
    }).load(DECLARED_ITCRM);
    expect(requests).toEqual([
      "bcra-itcrm-xlsx https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/itcrm-serie.xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]);
    expect(fetched.points[0]).toEqual({
      periodOn: "1997-01-01",
      value: "86.348001144279905",
    });
    expect(fetched.points).toHaveLength(1_000);
    expect(fetched.observedAt).toBe("2026-11-12T12:00:00Z");
  });

  it("names rate limits and malformed workbooks", async () => {
    await expect(
      source(async () => ({
        status: 429,
        body: new Uint8Array(),
        byteLength: 0,
        fetchedAt: "2026-11-12T12:00:00Z",
        retryAfter: "60",
      })).load(DECLARED_ITCRM),
    ).rejects.toMatchObject({ code: "rate_limited", detail: "60" });
    await expect(
      source(async () => ({
        status: 200,
        body: new Uint8Array([1, 2, 3]),
        byteLength: 3,
        fetchedAt: "2026-11-12T12:00:00Z",
      })).load(DECLARED_ITCRM),
    ).rejects.toMatchObject({
      code: "schema_changed",
      detail: "xlsx_not_a_zip",
    });
  });
});
