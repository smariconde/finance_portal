import type {
  OwnSetupRecord,
  StoredAnnotation,
  TradeAnnotationStore,
} from "@/modules/trading/application/trade-annotation-store";
import { sameAnnotation } from "@/modules/trading/domain/trade-annotation";

/** Doble en memoria del almacén de anotaciones: el mismo contrato que PostgreSQL. */
export function createInMemoryTradeAnnotationStore(
  accounts: () => readonly string[] = () => [],
): TradeAnnotationStore {
  const revisions: StoredAnnotation[] = [];
  const setups = new Map<string, OwnSetupRecord>();

  const chain = (accountKey: string, tradeKey: string) =>
    revisions
      .filter(
        (stored) =>
          stored.accountKey === accountKey && stored.tradeKey === tradeKey,
      )
      .sort((a, b) => b.revision - a.revision);

  return {
    async listCurrentAnnotations(accountKey) {
      const current = new Map<string, StoredAnnotation>();
      for (const stored of revisions) {
        if (stored.accountKey !== accountKey) continue;
        const seen = current.get(stored.tradeKey);
        if (seen === undefined || seen.revision < stored.revision) {
          current.set(stored.tradeKey, stored);
        }
      }
      return [...current.values()].sort((a, b) =>
        a.tradeKey.localeCompare(b.tradeKey),
      );
    },
    async listAnnotationRevisions(accountKey, tradeKey) {
      return chain(accountKey, tradeKey);
    },
    async saveAnnotation(input) {
      if (!accounts().includes(input.accountKey)) {
        throw new Error("The account must be recorded before it is annotated.");
      }
      const current = chain(input.accountKey, input.tradeKey)[0] ?? null;
      if ((current?.revision ?? null) !== input.baseRevision) {
        return { state: "conflict", current };
      }
      if (current !== null && sameAnnotation(current, input.annotation)) {
        return { state: "unchanged", annotation: current };
      }
      const stored: StoredAnnotation = {
        ...structuredClone(input.annotation),
        accountKey: input.accountKey,
        tradeKey: input.tradeKey,
        revision: (current?.revision ?? 0) + 1,
        version: input.version,
        recordedAt: input.recordedAt,
      };
      revisions.push(stored);
      return { state: "saved", annotation: stored };
    },
    async listOwnSetups() {
      return [...setups.values()].sort((a, b) => a.code.localeCompare(b.code));
    },
    async createOwnSetup(setup, limit) {
      if (setups.has(setup.code)) return "exists";
      if (setups.size >= limit) return "limit_reached";
      setups.set(setup.code, { ...setup });
      return "created";
    },
  };
}
