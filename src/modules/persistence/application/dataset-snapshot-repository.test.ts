import { describe, expect, it, vi } from "vitest";

import type { DatasetSnapshotRepository } from "./dataset-snapshot-repository";
import {
  createDatasetSnapshotCacheIdentity,
  selectDatasetSnapshotRepository,
} from "./dataset-snapshot-repository";

function repository(
  storage: DatasetSnapshotRepository["storage"],
): DatasetSnapshotRepository {
  return {
    storage,
    findById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
  };
}

describe("selectDatasetSnapshotRepository", () => {
  it("does not construct personal storage for demo mode", () => {
    const demo = vi.fn(() => repository("demo-fixture"));
    const personal = vi.fn(() => repository("personal-postgres"));

    expect(
      selectDatasetSnapshotRepository("demo", { demo, personal }).storage,
    ).toBe("demo-fixture");
    expect(demo).toHaveBeenCalledOnce();
    expect(personal).not.toHaveBeenCalled();
  });

  it("does not construct fixture storage for personal mode", () => {
    const demo = vi.fn(() => repository("demo-fixture"));
    const personal = vi.fn(() => repository("personal-postgres"));

    expect(
      selectDatasetSnapshotRepository("personal", { demo, personal }).storage,
    ).toBe("personal-postgres");
    expect(personal).toHaveBeenCalledOnce();
    expect(demo).not.toHaveBeenCalled();
  });

  it("namespaces cache identities by effective mode", () => {
    const snapshotId = "0198c7b4-6f18-7a12-933f-1972477dc769";

    expect(
      createDatasetSnapshotCacheIdentity("demo", "Demo.Catalog", snapshotId),
    ).not.toEqual(
      createDatasetSnapshotCacheIdentity(
        "personal",
        "Demo.Catalog",
        snapshotId,
      ),
    );
  });
});
