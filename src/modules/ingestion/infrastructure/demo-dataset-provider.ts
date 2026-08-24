import type { DatasetProvider } from "@/modules/ingestion/application/dataset-provider";

import {
  DEMO_ANNUAL_RECORDS,
  DEMO_BROKEN_RECORDS,
  DEMO_DATASETS,
  DEMO_PARTIAL_RECORDS,
  DEMO_SOURCE_ID,
} from "./demo-ingestion-fixtures";
import {
  createFakeDatasetProvider,
  type FakeDatasetCatalog,
} from "./fake-dataset-provider";

export const DEMO_DATASET_CATALOG: FakeDatasetCatalog = Object.freeze({
  [DEMO_SOURCE_ID]: Object.freeze({
    [DEMO_DATASETS.annual]: {
      kind: "records",
      records: DEMO_ANNUAL_RECORDS,
      sourceDocumentId: "fixtureco-fy2024-annual-report",
    },
    [DEMO_DATASETS.partial]: {
      kind: "records",
      records: DEMO_PARTIAL_RECORDS,
      sourceDocumentId: "fixtureco-fy2024-annual-report",
    },
    [DEMO_DATASETS.empty]: { kind: "records", records: [] },
    [DEMO_DATASETS.broken]: { kind: "records", records: DEMO_BROKEN_RECORDS },
    [DEMO_DATASETS.unavailable]: {
      kind: "unavailable",
      message: "La fuente sintética simula una caída del proveedor.",
    },
  }),
} satisfies FakeDatasetCatalog);

export function createDemoDatasetProvider(
  now: () => string = () => new Date().toISOString(),
): DatasetProvider {
  return createFakeDatasetProvider({
    providerId: "demo-fixture-provider",
    catalog: DEMO_DATASET_CATALOG,
    now,
  });
}
