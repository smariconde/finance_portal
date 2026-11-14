import { describeTradingRoutineStoreContract } from "@/modules/trading/application/trading-routine-store.contract";
import { createInMemoryTradingRoutineStore } from "@/modules/trading/infrastructure/in-memory-trading-routine-store";

describeTradingRoutineStoreContract("in memory", () =>
  createInMemoryTradingRoutineStore(),
);
