import { describeTradeAnnotationStoreContract } from "@/modules/trading/application/trade-annotation-store.contract";
import { createInMemoryTradeAnnotationStore } from "@/modules/trading/infrastructure/in-memory-trade-annotation-store";

describeTradeAnnotationStoreContract("in memory", () => {
  const accounts = new Set<string>();
  return {
    store: createInMemoryTradeAnnotationStore(() => [...accounts]),
    recordAccount: async (accountKey) => {
      accounts.add(accountKey);
    },
  };
});
