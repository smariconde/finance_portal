import type {
  RoutineItem,
  StoredRoutine,
  TradingRoutineStore,
} from "@/modules/trading/application/trading-routine-store";
import { sameRoutineEntry } from "@/modules/trading/domain/trading-routine";

/** Doble en memoria del almacén de la rutina: el mismo contrato que PostgreSQL. */
export function createInMemoryTradingRoutineStore(): TradingRoutineStore {
  const items: RoutineItem[] = [];
  const revisions: StoredRoutine[] = [];

  const current = (session: string, phase: string) =>
    revisions
      .filter((stored) => stored.session === session && stored.phase === phase)
      .sort((a, b) => b.revision - a.revision)[0] ?? null;

  return {
    async listItems() {
      return items.map((item) => ({ ...item }));
    },
    async addItem(item, limit) {
      const open = items.filter(
        (candidate) =>
          candidate.phase === item.phase && candidate.retiredAt === null,
      );
      if (open.length >= limit) return "limit_reached";
      items.push({ ...item, retiredAt: null });
      return "created";
    },
    async retireItem(itemId, at) {
      const index = items.findIndex(
        (item) => item.itemId === itemId && item.retiredAt === null,
      );
      if (index < 0) return false;
      items[index] = { ...items[index]!, retiredAt: at };
      return true;
    },
    async listRoutines(from, to) {
      const latest = new Map<string, StoredRoutine>();
      for (const stored of revisions) {
        if (stored.session < from || stored.session > to) continue;
        const key = `${stored.session}:${stored.phase}`;
        const seen = latest.get(key);
        if (seen === undefined || seen.revision < stored.revision) {
          latest.set(key, stored);
        }
      }
      return [...latest.values()].sort(
        (a, b) =>
          a.session.localeCompare(b.session) || a.phase.localeCompare(b.phase),
      );
    },
    async saveRoutine(input) {
      const stored = current(input.session, input.phase);
      if ((stored?.revision ?? null) !== input.baseRevision) {
        return { state: "conflict", current: stored };
      }
      if (stored !== null && sameRoutineEntry(stored, input.entry)) {
        return { state: "unchanged", routine: stored };
      }
      const routine: StoredRoutine = {
        checked: [...input.entry.checked],
        note: input.entry.note,
        session: input.session,
        phase: input.phase,
        revision: (stored?.revision ?? 0) + 1,
        version: input.version,
        recordedAt: input.recordedAt,
      };
      revisions.push(routine);
      return { state: "saved", routine };
    },
  };
}
