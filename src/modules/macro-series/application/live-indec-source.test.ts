import { describe, expect, it } from "vitest";

import type {
  EgressFetch,
  EgressFetchRequest,
} from "@/modules/ingestion/application/egress-fetch";
import { sourceRegistryEntrySchema } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";

import { argentinaIndicatorSchema } from "../domain/argentina-indicator";
import { declaredArgentinaIndicator } from "../domain/declared-argentina-indicators";
import { declaredIndecExpandedIndicator } from "../domain/declared-indec-expanded-indicators";
import { publishedMonthlyRateIndicator } from "../domain/indec-monthly-reconciliation";

import { createLiveIndecSource } from "./live-indec-source";

const emae = declaredArgentinaIndicator("emae_original")!;

function rows(start: number, count: number): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, index) => {
      const month = start + index;
      const year = 2004 + Math.floor(month / 12);
      const mes = (month % 12) + 1;
      return {
        tipo_de_indicador_descripcion: "Índice serie original",
        anio: year,
        mes,
        periodo: `${year}${String(mes).padStart(2, "0")}`,
        tipo_de_indicador: "Índice base 2004=100",
        valor: 100 + month,
        valor_null: null,
        observaciones: null,
      };
    }),
  );
}

function harness(
  bodies: readonly { status: number; body: string }[],
  registry = createInMemorySourceRegistryRepository(DEMO_SOURCE_REGISTRY),
) {
  const requests: EgressFetchRequest[] = [];
  const fetch: EgressFetch = async (request) => {
    const next = bodies[requests.length];
    requests.push(request);
    if (!next) throw new Error("unexpected request");
    const body = new TextEncoder().encode(next.body);
    return {
      status: next.status,
      body,
      byteLength: body.byteLength,
      fetchedAt: "2026-11-03T21:00:00.000Z",
    };
  };
  return {
    requests,
    source: createLiveIndecSource({ sourceRegistry: registry, fetch }),
  };
}

describe("live INDEC source", () => {
  it("checks rights before the first socket", async () => {
    const entry = DEMO_SOURCE_REGISTRY.find(
      (row) => row.sourceId === "indec-api",
    )!;
    const registry = createInMemorySourceRegistryRepository([
      ...DEMO_SOURCE_REGISTRY.filter((row) => row.sourceId !== "indec-api"),
      sourceRegistryEntrySchema.parse({
        ...entry,
        approvalStatus: "rights_review_pending",
      }),
    ]);
    const { requests, source } = harness([], registry);
    await expect(source.load(emae)).rejects.toMatchObject({
      code: "rights_not_approved",
    });
    expect(requests).toHaveLength(0);
  });

  it("pages by offset until a short page and keeps the series ascending", async () => {
    const { requests, source } = harness([
      { status: 200, body: rows(0, 1000) },
      { status: 200, body: rows(1000, 5) },
    ]);
    const fetched = await source.load(emae);
    expect(fetched.points).toHaveLength(1005);
    expect(fetched.points[0]).toEqual({
      periodOn: "2004-01-01",
      value: "100",
      note: null,
    });
    expect(
      requests.map((request) =>
        new URL(request.url).searchParams.get("offset"),
      ),
    ).toEqual(["0", "1000"]);
    expect(requests.every((request) => request.sourceId === "indec-api")).toBe(
      true,
    );
    expect(fetched.requests).toBe(2);
  });

  it("names an expired token, a rename that empties the series and a reshaped page", async () => {
    await expect(
      harness([{ status: 401, body: "{}" }]).source.load(emae),
    ).rejects.toMatchObject({ code: "unauthorized" });
    await expect(
      harness([{ status: 200, body: "[]" }]).source.load(emae),
    ).rejects.toMatchObject({ code: "no_rows" });
    await expect(
      harness([{ status: 200, body: '[{"valor":1}]' }]).source.load(emae),
    ).rejects.toMatchObject({
      code: "schema_changed",
      detail: "schema_changed",
    });
    await expect(
      harness([{ status: 429, body: "{}" }]).source.load(emae),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("refuses a series outside the declared set", async () => {
    const { requests, source } = harness([]);
    const undeclared = argentinaIndicatorSchema.parse({
      ...emae,
      id: "emae_other",
    });
    await expect(source.load(undeclared)).rejects.toMatchObject({
      code: "not_declared",
    });
    expect(requests).toHaveLength(0);
  });

  it("admits an expanded IPC series but refuses a modified region before fetching", async () => {
    const ipc = declaredIndecExpandedIndicator("ipc_nacional")!;
    const sample = (periodo: string, valor: number, rate = false) => ({
      ...(rate ? publishedMonthlyRateIndicator(ipc).filters : ipc.filters),
      periodo,
      anio: Number(periodo.slice(0, 4)),
      mes: Number(periodo.slice(4)),
      valor,
      valor_null: null,
      observaciones: null,
    });
    const { requests, source } = harness([
      {
        status: 200,
        body: JSON.stringify([
          sample("202608", 12276.766),
          sample("202609", 12514.1508),
        ]),
      },
      { status: 200, body: JSON.stringify([sample("202609", 1.9, true)]) },
    ]);
    const fetched = await source.load(ipc);
    expect(fetched.points).toEqual([
      { periodOn: "2026-08-01", value: "12276.766", note: null },
      { periodOn: "2026-09-01", value: "12514.1508", note: null },
    ]);
    expect(fetched.reconciliation).toMatchObject({
      status: "matched",
      published: "1.9",
    });
    expect(requests).toHaveLength(2);
    await expect(
      source.load({ ...ipc, filters: { ...ipc.filters, region: "GBA" } }),
    ).rejects.toMatchObject({ code: "not_declared" });
    expect(requests).toHaveLength(2);
  });

  it("refuses an expanded publication when its monthly rate disagrees", async () => {
    const ipc = declaredIndecExpandedIndicator("ipc_nacional")!;
    const row = (periodo: string, valor: number, rate = false) => ({
      ...(rate ? publishedMonthlyRateIndicator(ipc).filters : ipc.filters),
      periodo,
      anio: Number(periodo.slice(0, 4)),
      mes: Number(periodo.slice(4)),
      valor,
      valor_null: null,
      observaciones: null,
    });
    const { requests, source } = harness([
      {
        status: 200,
        body: JSON.stringify([
          row("202608", 12276.766),
          row("202609", 12514.1508),
        ]),
      },
      { status: 200, body: JSON.stringify([row("202609", 3.5, true)]) },
    ]);
    await expect(source.load(ipc)).rejects.toMatchObject({
      code: "reconciliation_failed",
      detail: "published_mismatch",
    });
    expect(requests).toHaveLength(2);
  });

  it("refuses a corrupt older IPC level before requesting the monthly rate", async () => {
    const ipc = declaredIndecExpandedIndicator("ipc_nacional")!;
    const row = (periodo: string, valor: number) => ({
      ...ipc.filters,
      periodo,
      anio: Number(periodo.slice(0, 4)),
      mes: Number(periodo.slice(4)),
      valor,
      valor_null: null,
      observaciones: null,
    });
    const { requests, source } = harness([
      {
        status: 200,
        body: JSON.stringify([
          row("202607", -1),
          row("202608", 100),
          row("202609", 102),
        ]),
      },
    ]);
    await expect(source.load(ipc)).rejects.toMatchObject({
      code: "schema_changed",
      detail: "invalid_value",
    });
    expect(requests).toHaveLength(1);
  });
});
