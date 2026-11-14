import type {
  RoutineEntry,
  RoutinePhase,
} from "@/modules/trading/domain/trading-routine";

/**
 * La rutina de cada sesión en la base de trading (`trading-routine-1.0.0`,
 * `F11-07`): los ítems que escribe el owner y, por sesión y fase, lo tildado y
 * una nota, como revisiones append-only.
 */
export type RoutineItem = {
  readonly itemId: string;
  readonly phase: RoutinePhase;
  readonly label: string;
  readonly createdAt: string;
  /** Retirado: no aparece en la lista nueva, pero las sesiones lo siguen nombrando. */
  readonly retiredAt: string | null;
};

export type StoredRoutine = RoutineEntry & {
  readonly session: string;
  readonly phase: RoutinePhase;
  readonly revision: number;
  readonly version: string;
  readonly recordedAt: string;
};

export type SaveRoutineResult =
  | { readonly state: "saved" | "unchanged"; readonly routine: StoredRoutine }
  | { readonly state: "conflict"; readonly current: StoredRoutine | null };

export interface TradingRoutineStore {
  /** Todos los ítems, retirados incluidos, en orden de creación. */
  listItems(): Promise<RoutineItem[]>;
  /** `limit_reached` si la fase ya tiene `limit` ítems vigentes. */
  addItem(
    item: Omit<RoutineItem, "retiredAt">,
    limit: number,
  ): Promise<"created" | "limit_reached">;
  /** `false` si no existe o ya estaba retirado. */
  retireItem(itemId: string, at: string): Promise<boolean>;
  /** Lo vigente de cada sesión y fase entre `from` y `to`, inclusive. */
  listRoutines(from: string, to: string): Promise<StoredRoutine[]>;
  saveRoutine(input: {
    readonly session: string;
    readonly phase: RoutinePhase;
    readonly baseRevision: number | null;
    readonly entry: RoutineEntry;
    readonly version: string;
    readonly recordedAt: string;
  }): Promise<SaveRoutineResult>;
}
