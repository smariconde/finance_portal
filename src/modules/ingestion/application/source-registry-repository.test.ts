import { describe, expect, it, vi } from "vitest";

import { isRuntimeLockedError } from "@/modules/configuration/domain/runtime-lock";

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
  it("constructs personal storage only for personal mode", () => {
    const personal = vi.fn(() => sourceRegistry("personal-postgres"));

    expect(
      selectSourceRegistryRepository("personal", { personal }).storage,
    ).toBe("personal-postgres");
    expect(personal).toHaveBeenCalledOnce();
  });

  it("refuses to build a registry while the runtime is locked", () => {
    const personal = vi.fn(() => sourceRegistry("personal-postgres"));

    try {
      selectSourceRegistryRepository("locked", { personal });
      throw new Error("Expected a locked runtime rejection.");
    } catch (error) {
      expect(isRuntimeLockedError(error)).toBe(true);
    }

    expect(personal).not.toHaveBeenCalled();
  });
});

describe("selectIngestionRunRepository", () => {
  it("refuses to record a run while the runtime is locked", () => {
    const personal = vi.fn(() => ingestionRuns("personal-postgres"));

    try {
      selectIngestionRunRepository("locked", { personal });
      throw new Error("Expected a locked runtime rejection.");
    } catch (error) {
      expect(isRuntimeLockedError(error)).toBe(true);
    }

    expect(personal).not.toHaveBeenCalled();
  });
});

describe("cache identities", () => {
  it("namespaces the source registry by effective mode", () => {
    expect(
      createSourceRegistryCacheIdentity("locked", "sec-edgar"),
    ).not.toEqual(createSourceRegistryCacheIdentity("personal", "sec-edgar"));
  });

  it("namespaces ingestion runs by effective mode", () => {
    expect(
      createIngestionRunCacheIdentity(
        "locked",
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
