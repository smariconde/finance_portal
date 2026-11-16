import { describeFinvizStrategyStoreContract } from "@/modules/finviz-screener/application/finviz-strategy-store.contract";
import { createInMemoryFinvizStrategyStore } from "@/modules/finviz-screener/infrastructure/in-memory-finviz-strategy-store";

describeFinvizStrategyStoreContract("in memory", () =>
  createInMemoryFinvizStrategyStore(),
);
