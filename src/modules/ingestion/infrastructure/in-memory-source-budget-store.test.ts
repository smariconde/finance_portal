import { describeSourceBudgetStoreContract } from "@/modules/ingestion/application/source-budget-store.contract";

import { createInMemorySourceBudgetStore } from "./in-memory-source-budget-store";

describeSourceBudgetStoreContract("in-memory", {
  createStore: (budgets) => createInMemorySourceBudgetStore(budgets),
});
