import { describeSchwabTransactionStoreContract } from "@/modules/trading/application/schwab-transaction-store.contract";
import { createInMemorySchwabTransactionStore } from "@/modules/trading/infrastructure/in-memory-schwab-transaction-store";

describeSchwabTransactionStoreContract("in memory", () =>
  createInMemorySchwabTransactionStore(),
);
