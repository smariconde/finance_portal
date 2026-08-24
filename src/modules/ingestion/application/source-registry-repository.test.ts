import { describe, expect, it, vi } from "vitest";

import {
  createIngestionRunCacheIdentity,
  selectIngestionRunRepository,
  type IngestionRunRepository,
} from "./ingestion-run-repository";
import {
  createSourceRegistryCacheIdentity,
  selectSourceRegistryRepository,
  type SourceRegistryRepository,
} from "./source-registry-repository";

function sourceRegistry(
  storage: SourceRegistryRepository["storage"],
): SourceRegistryRepository {
  return {
    storage,
    findBySourceId: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
  };
}

function ingestionRuns(
  storage: IngestionRunRepository["storage"],
): IngestionRunRepository {
  return {
    storage,
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    findLatestPublishable: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    append: vi.fn(),
  };
}

describe("selectSourceRegistryRepository", () => {
  it("does not construct personal storage for demo mode", () => {
    const demo = vi.fn(() => sourceRegistry("demo-fixture"));
    const personal = vi.fn(() => sourceRegistry("personal-postgres"));

    expect(
      selectSourceRegistryRepository("demo", { demo, personal }).storage,
    ).toBe("demo-fixture");
    expect(personal).not.toHaveBeenCalled();
  });

  it("does not construct fixture storage for personal mode", () => {
    const demo = vi.fn(() => sourceRegistry("demo-fixture"));
    const personal = vi.fn(() => sourceRegistry("personal-postgres"));

    expect(
      selectSourceRegistryRepository("personal", { demo, personal }).storage,
    ).toBe("personal-postgres");
    expect(demo).not.toHaveBeenCalled();
  });
});

describe("selectIngestionRunRepository", () => {
  it("keeps demo runs out of personal storage", () => {
    const demo = vi.fn(() => ingestionRuns("demo-fixture"));
    const personal = vi.fn(() => ingestionRuns("personal-postgres"));

    expect(
      selectIngestionRunRepository("demo", { demo, personal }).storage,
    ).toBe("demo-fixture");
    expect(personal).not.toHaveBeenCalled();
  });
});

describe("cache identities", () => {
  it("namespaces the source registry by effective mode", () => {
    expect(createSourceRegistryCacheIdentity("demo", "sec-edgar")).not.toEqual(
      createSourceRegistryCacheIdentity("personal", "sec-edgar"),
    );
  });

  it("namespaces ingestion runs by effective mode", () => {
    expect(
      createIngestionRunCacheIdentity(
        "demo",
        "fixture-demo-fundamentals",
        "demo.fundamentals.annual",
      ),
    ).not.toEqual(
      createIngestionRunCacheIdentity(
        "personal",
        "fixture-demo-fundamentals",
        "demo.fundamentals.annual",
      ),
    );
  });
});
