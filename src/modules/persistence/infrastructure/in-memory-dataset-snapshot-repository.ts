import {
  datasetSnapshotListQuerySchema,
  type DatasetSnapshotRepository,
} from "@/modules/persistence/application/dataset-snapshot-repository";
import {
  datasetSnapshotSchema,
  type DatasetSnapshot,
} from "@/modules/persistence/domain/dataset-snapshot";

export function createDemoDatasetSnapshotRepository(
  fixtureSnapshots: readonly DatasetSnapshot[] = [],
): DatasetSnapshotRepository {
  const snapshots = fixtureSnapshots.map((snapshot) =>
    datasetSnapshotSchema.parse(snapshot),
  );

  return {
    storage: "demo-fixture",
    async findById(snapshotId) {
      return (
        snapshots.find((snapshot) => snapshot.snapshotId === snapshotId) ?? null
      );
    },
    async list(query) {
      const parsedQuery = datasetSnapshotListQuerySchema.parse(query);

      return snapshots
        .filter((snapshot) => snapshot.datasetId === parsedQuery.datasetId)
        .slice(0, parsedQuery.limit);
    },
  };
}
