import type { DatasetProvider } from "@/modules/ingestion/application/dataset-provider";

import {
  DEMO_ANNUAL_RECORDS,
  DEMO_BROKEN_RECORDS,
  DEMO_DATASETS,
  DEMO_PARTIAL_RECORDS,
  DEMO_RESTATED_RECORDS,
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

/**
 * La misma fuente sintética después del amendment del 2025-05-01. No es otro
 * dataset: es el estado posterior del mismo endpoint, así que una corrida con
 * otro vintage descubre la revisión sin inventar un identificador nuevo.
 */
export const DEMO_RESTATED_DATASET_CATALOG: FakeDatasetCatalog = Object.freeze({
  [DEMO_SOURCE_ID]: Object.freeze({
    [DEMO_DATASETS.annual]: {
      kind: "records",
      records: DEMO_RESTATED_RECORDS,
      sourceDocumentId: "fixtureco-fy2024-annual-report-amendment",
    },
  }),
} satisfies FakeDatasetCatalog);

export function createDemoRestatedDatasetProvider(
  now: () => string = () => new Date().toISOString(),
): DatasetProvider {
  return createFakeDatasetProvider({
    providerId: "demo-fixture-provider",
    catalog: DEMO_RESTATED_DATASET_CATALOG,
    now,
  });
}
