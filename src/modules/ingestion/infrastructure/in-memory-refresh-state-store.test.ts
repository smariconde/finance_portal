import { randomUUID } from "node:crypto";

import { describeRefreshStateStoreContract } from "../application/refresh-state-store.contract";
import { createInMemoryRefreshStateStore } from "./in-memory-refresh-state-store";

describeRefreshStateStoreContract("memoria", {
  createStore: () => createInMemoryRefreshStateStore(),
  createRunId: async () => randomUUID(),
});
