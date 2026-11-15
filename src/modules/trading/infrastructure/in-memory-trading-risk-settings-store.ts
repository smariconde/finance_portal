import type {
  StoredRiskSettings,
  TradingRiskSettingsStore,
} from "@/modules/trading/application/trading-risk-settings-store";
import { sameRiskSettings } from "@/modules/trading/domain/trading-rules";

/** Doble en memoria del almacén de las reglas: el mismo contrato que PostgreSQL. */
export function createInMemoryTradingRiskSettingsStore(): TradingRiskSettingsStore {
  const revisions: StoredRiskSettings[] = [];
  const current = () => revisions.at(-1) ?? null;

  return {
    async readCurrent() {
      const stored = current();
      return stored === null ? null : { ...stored };
    },
    async save(input) {
      const stored = current();
      if ((stored?.revision ?? null) !== input.baseRevision) {
        return { state: "conflict", current: stored };
      }
      if (stored !== null && sameRiskSettings(stored, input.settings)) {
        return { state: "unchanged", settings: stored };
      }
      const next: StoredRiskSettings = {
        ...input.settings,
        revision: (stored?.revision ?? 0) + 1,
        version: input.version,
        recordedAt: input.recordedAt,
      };
      revisions.push(next);
      return { state: "saved", settings: next };
    },
  };
}
