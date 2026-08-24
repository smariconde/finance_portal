import { describe, expect, it } from "vitest";

import {
  createFakeDatasetProvider,
  FakeProviderContractError,
  FakeProviderUnavailableError,
  type FakeDatasetCatalog,
} from "./fake-dataset-provider";

const FIXED_NOW = "2026-08-23T10:00:00.000Z";

const CATALOG: FakeDatasetCatalog = {
  "fixture-demo-fundamentals": {
    "demo.fundamentals.annual": {
      kind: "records",
      records: [{ id: 1 }, { id: 2 }, { id: 3 }],
    },
    "demo.fundamentals.unavailable": {
      kind: "unavailable",
      message: "fuente caída",
    },
  },
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: "fixture-demo-fundamentals",
    datasetId: "demo.fundamentals.annual",
    parserVersion: "fixture-1.0.0",
    requestedAsOf: null,
    cursor: null,
    maxRecords: 500,
    ...overrides,
  };
}

describe("createFakeDatasetProvider", () => {
  const provider = createFakeDatasetProvider({
    catalog: CATALOG,
    now: () => FIXED_NOW,
  });

  it("returns an identical response for an identical request", async () => {
    const first = await provider.fetchDataset(request());
    const second = await provider.fetchDataset(request());

    expect(second).toStrictEqual(first);
    expect(first.fetchedAt).toBe(FIXED_NOW);
    expect(first.nextCursor).toBeNull();
  });

  it("paginates with a deterministic offset cursor", async () => {
    const first = await provider.fetchDataset(request({ maxRecords: 2 }));

    expect(first.records).toHaveLength(2);
    expect(first.nextCursor).toBe("offset:2");

    const second = await provider.fetchDataset(
      request({ maxRecords: 2, cursor: first.nextCursor }),
    );

    expect(second.records).toStrictEqual([{ id: 3 }]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor instead of silently restarting", async () => {
    await expect(
      provider.fetchDataset(request({ cursor: "page-2" })),
    ).rejects.toBeInstanceOf(FakeProviderContractError);
  });

  it("rejects a dataset that is not in the catalog", async () => {
    await expect(
      provider.fetchDataset(request({ datasetId: "demo.unknown" })),
    ).rejects.toBeInstanceOf(FakeProviderContractError);
  });

  it("simulates a source outage explicitly", async () => {
    await expect(
      provider.fetchDataset(
        request({ datasetId: "demo.fundamentals.unavailable" }),
      ),
    ).rejects.toBeInstanceOf(FakeProviderUnavailableError);
  });

  it("validates its own request contract", async () => {
    await expect(
      provider.fetchDataset(request({ maxRecords: 0 })),
    ).rejects.toThrow();
  });
});
