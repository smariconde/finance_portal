import "server-only";

import {
  routineSessionOf,
  stepRoutineSession,
  type RoutinePhase,
  type RoutinePhaseReading,
  type RoutineReading,
} from "@/modules/trading/domain/trading-routine";
import { getTradingRoutineStore } from "@/server/persistence/trading/get-trading-routine-store";

/** La rutina de una sesión (`trading-routine-1.0.0`), leída de la base de trading. */
export async function readRoutine(
  session: string,
  now: string,
): Promise<RoutineReading> {
  const store = getTradingRoutineStore();
  const [items, routines] = await Promise.all([
    store.listItems(),
    store.listRoutines(session, session),
  ]);
  const phaseReading = (phase: RoutinePhase): RoutinePhaseReading => {
    const stored = routines.find((routine) => routine.phase === phase) ?? null;
    const checked = new Set(stored?.checked ?? []);
    return {
      items: items
        .filter(
          (item) =>
            item.phase === phase &&
            (item.retiredAt === null || checked.has(item.itemId)),
        )
        .map(({ itemId, label, retiredAt }) => ({ itemId, label, retiredAt })),
      revision: stored?.revision ?? null,
      recordedAt: stored?.recordedAt ?? null,
      checked: stored?.checked ?? [],
      note: stored?.note ?? "",
    };
  };
  const phases = {
    pre_open: phaseReading("pre_open"),
    close: phaseReading("close"),
  };
  return {
    session,
    previous: stepRoutineSession(session, -1, now),
    next: stepRoutineSession(session, 1, now),
    phases,
  };
}

/** Las sesiones con alguna rutina hecha entre `from` y `to`, para el calendario. */
export async function routineSessionsBetween(
  from: string,
  to: string,
): Promise<string[]> {
  const routines = await getTradingRoutineStore().listRoutines(from, to);
  return [
    ...new Set(
      routines
        .filter((routine) => routine.checked.length > 0 || routine.note !== "")
        .map((routine) => routine.session),
    ),
  ];
}

export { routineSessionOf, type RoutineReading };
