import {
  storedSettingsMatch,
  type StoredRiskSettings,
  type TradingRiskSettingsStore,
} from "@/modules/trading/application/trading-risk-settings-store";

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
      if (stored !== null && storedSettingsMatch(stored, input.settings)) {
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
