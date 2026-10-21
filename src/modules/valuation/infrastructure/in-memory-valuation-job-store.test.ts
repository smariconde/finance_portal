import { randomUUID } from "node:crypto";

import { describeValuationJobStoreContract } from "../application/valuation-job-store.contract";
import { createInMemoryValuationJobStore } from "./in-memory-valuation-job-store";

describeValuationJobStoreContract("memory", () => ({
  store: createInMemoryValuationJobStore(),
  recordRun: async () => randomUUID(),
}));
