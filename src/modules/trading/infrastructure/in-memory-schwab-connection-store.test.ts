import { describeSchwabConnectionStoreContract } from "@/modules/trading/application/schwab-connection-store.contract";
import { createInMemorySchwabConnectionStore } from "@/modules/trading/infrastructure/in-memory-schwab-connection-store";

describeSchwabConnectionStoreContract("in memory", () =>
  createInMemorySchwabConnectionStore(),
);
