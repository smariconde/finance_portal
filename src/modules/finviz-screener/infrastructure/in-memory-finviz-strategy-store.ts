import type { FinvizStrategyStore } from "@/modules/finviz-screener/application/finviz-strategy-store";
import {
  sameStrategyFields,
  type StoredFinvizStrategy,
} from "@/modules/finviz-screener/domain/finviz-screener-strategy";

type Revision = StoredFinvizStrategy & { readonly archived: boolean };

/** Doble en memoria del almacén de estrategias: el mismo contrato que PostgreSQL. */
export function createInMemoryFinvizStrategyStore(): FinvizStrategyStore {
  const current = new Map<string, Revision>();

  const strip = ({ archived, ...strategy }: Revision): StoredFinvizStrategy => {
    void archived;
    return { ...strategy };
  };

  return {
    async listActive() {
      return [...current.values()]
        .filter((revision) => !revision.archived)
        .map(strip)
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    async save(input) {
      const stored = current.get(input.strategyId);
      if ((stored?.revision ?? null) !== input.baseRevision || stored?.archived)
        return { state: "conflict" };
      if (stored !== undefined && sameStrategyFields(stored, input.fields))
        return { state: "unchanged", strategy: strip(stored) };
      const name = input.fields.name.toLowerCase();
      if (
        [...current.values()].some(
          (revision) =>
            !revision.archived &&
            revision.strategyId !== input.strategyId &&
            revision.name.toLowerCase() === name,
        )
      )
        return { state: "name_taken" };
      const next: Revision = {
        ...input.fields,
        strategyId: input.strategyId,
        revision: (stored?.revision ?? 0) + 1,
        version: input.version,
        catalogVersion: input.catalogVersion,
        recordedAt: input.recordedAt,
        archived: false,
      };
      current.set(input.strategyId, next);
      return { state: "saved", strategy: strip(next) };
    },
    async archive(input) {
      const stored = current.get(input.strategyId);
      if (stored === undefined || stored.archived) return "conflict";
      if (stored.revision !== input.baseRevision) return "conflict";
      current.set(input.strategyId, {
        ...stored,
        revision: stored.revision + 1,
        recordedAt: input.recordedAt,
        archived: true,
      });
      return "archived";
    },
  };
}
