import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import type { DatasetSnapshot } from "@/modules/persistence/domain/dataset-snapshot";

export const datasetSnapshotListQuerySchema = z.object({
  datasetId: z.string().trim().min(1).max(128),
  limit: z.number().int().min(1).max(100).default(25),
});

export type DatasetSnapshotListQuery = z.input<
  typeof datasetSnapshotListQuerySchema
>;

export interface DatasetSnapshotRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  findById(snapshotId: string): Promise<DatasetSnapshot | null>;
  list(query: DatasetSnapshotListQuery): Promise<DatasetSnapshot[]>;
}

type RepositoryFactories = {
  personal: () => DatasetSnapshotRepository;
};

export function selectDatasetSnapshotRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): DatasetSnapshotRepository {
  return selectPersonalDependency(mode, "dataset-snapshot", factories.personal);
}

export function createDatasetSnapshotCacheIdentity(
  mode: AppMode,
  datasetId: string,
  snapshotId: string,
): readonly ["dataset-snapshot", AppMode, string, string] {
  const normalizedDatasetId = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .parse(datasetId)
    .toLowerCase();
  const parsedSnapshotId = z.uuid().parse(snapshotId);

  return ["dataset-snapshot", mode, normalizedDatasetId, parsedSnapshotId];
}
