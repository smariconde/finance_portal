import { randomUUID } from "node:crypto";

import { describeIngestionJobStoreContract } from "@/modules/ingestion/application/ingestion-job-store.contract";

import { createInMemoryIngestionJobStore } from "./in-memory-ingestion-job-store";

describeIngestionJobStoreContract("in-memory", () => ({
  store: createInMemoryIngestionJobStore({ newId: randomUUID }),
  createIngestionRun: async () => randomUUID(),
}));
