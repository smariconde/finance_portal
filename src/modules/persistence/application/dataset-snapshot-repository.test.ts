import { describe, expect, it, vi } from "vitest";

import { isRuntimeLockedError } from "@/modules/configuration/domain/runtime-lock";

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
  it("constructs personal storage only for personal mode", () => {
    const personal = vi.fn(() => repository("personal-postgres"));

    expect(
      selectDatasetSnapshotRepository("personal", { personal }).storage,
    ).toBe("personal-postgres");
    expect(personal).toHaveBeenCalledOnce();
  });

  it("refuses to build a repository while the runtime is locked", () => {
    const personal = vi.fn(() => repository("personal-postgres"));

    try {
      selectDatasetSnapshotRepository("locked", { personal });
      throw new Error("Expected a locked runtime rejection.");
    } catch (error) {
      expect(isRuntimeLockedError(error)).toBe(true);
    }

    // Lo importante no es sólo el error: un runtime trabado tampoco abre la
    // conexión personal para averiguar si podía.
    expect(personal).not.toHaveBeenCalled();
  });

  it("namespaces cache identities by effective mode", () => {
    const snapshotId = "0198c7b4-6f18-7a12-933f-1972477dc769";

    expect(
      createDatasetSnapshotCacheIdentity("locked", "Demo.Catalog", snapshotId),
    ).not.toEqual(
      createDatasetSnapshotCacheIdentity(
        "personal",
        "Demo.Catalog",
        snapshotId,
      ),
    );
  });
});
