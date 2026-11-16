import "server-only";

import { getPreMarketStore } from "@/server/persistence/trading/get-pre-market-store";

import { safeErrorSummary } from "./safe-error";
import { loadJournalState } from "./transactions";

/** Unir los planes inequívocos de la sesión luego de publicar transacciones. */
export async function reconcilePreMarketTrades(): Promise<void> {
  try {
    const state = await loadJournalState();
    if (state.account === null) return;
    await getPreMarketStore().reconcile(
      state.account.accountKey,
      state.trades,
      new Date().toISOString(),
    );
  } catch (error) {
    console.error("pre-market reconciliation failed", safeErrorSummary(error));
  }
}
