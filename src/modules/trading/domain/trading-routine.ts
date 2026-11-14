import { z } from "zod";

import { notesSchema } from "./trade-annotation";
import { tradingSessionOf } from "./trading-session";

/**
 * La rutina de cada sesión (`trading-routine-1.0.0`, `F11-07`). Decisión del
 * owner: un checklist propio por fase —antes de la apertura y al cierre— y una
 * nota corta. Es liviana y opcional: nada la pide ni la bloquea.
 *
 * - **Ítems:** los escribe el owner, hasta 12 por fase. Retirar uno no lo borra:
 *   las sesiones que lo tildaron lo siguen nombrando.
 * - **Sesión:** la fecha de Nueva York. En un fin de semana la rutina es la del
 *   lunes siguiente, que es la que se prepara (`routine-session-1.0.0`).
 * - **Guardado:** revisiones append-only por sesión y fase, como las anotaciones.
 */
export const TRADING_ROUTINE_VERSION = "trading-routine-1.0.0";
export const ROUTINE_SESSION_VERSION = "routine-session-1.0.0";

export const ROUTINE_PHASES = ["pre_open", "close"] as const;
export const routinePhaseSchema = z.enum(ROUTINE_PHASES);
export type RoutinePhase = z.infer<typeof routinePhaseSchema>;

export const MAX_ROUTINE_ITEMS = 12;
export const ROUTINE_NOTE_MAX = 2000;

export const routineItemLabelSchema = z
  .string()
  .transform((value) => value.normalize("NFC").replace(/\s+/gu, " ").trim())
  .pipe(
    z
      .string()
      .min(2)
      .max(80)
      .regex(/^[\p{L}\p{N} .,:;/&+()'#%$¿?¡!-]+$/u),
  );

export const routineNoteSchema = notesSchema.pipe(
  z.string().max(ROUTINE_NOTE_MAX),
);

export const sessionSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "invalid_date");

const DAY_MS = 86_400_000;

function weekday(session: string): number {
  return new Date(`${session}T00:00:00.000Z`).getUTCDay();
}

export function addSessionDays(session: string, days: number): string {
  return new Date(Date.parse(`${session}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** La sesión hábil más cercana hacia adelante (`step` 1) o hacia atrás (−1). */
export function weekdaySession(session: string, step: 1 | -1): string {
  let current = session;
  while (weekday(current) === 0 || weekday(current) === 6) {
    current = addSessionDays(current, step);
  }
  return current;
}

/** La sesión cuya rutina toca ahora: hoy en Nueva York, o el lunes que viene. */
export function routineSessionOf(now: string): string {
  return weekdaySession(tradingSessionOf(now), 1);
}

/** La sesión hábil anterior o siguiente, nunca más allá de la de hoy. */
export function stepRoutineSession(
  session: string,
  step: 1 | -1,
  now: string,
): string | null {
  const next = weekdaySession(addSessionDays(session, step), step);
  return next > routineSessionOf(now) ? null : next;
}

export type RoutineEntry = {
  /** IDs de los ítems tildados, en el orden de la lista. */
  readonly checked: readonly string[];
  readonly note: string;
};

export function sameRoutineEntry(a: RoutineEntry, b: RoutineEntry): boolean {
  return (
    a.note === b.note &&
    a.checked.length === b.checked.length &&
    a.checked.every((id, index) => b.checked[index] === id)
  );
}

export type RoutinePhaseReading = {
  /** Los ítems a mostrar: los vigentes y los retirados que esta sesión tildó. */
  readonly items: readonly {
    readonly itemId: string;
    readonly label: string;
    readonly retiredAt: string | null;
  }[];
  readonly revision: number | null;
  readonly recordedAt: string | null;
  readonly checked: readonly string[];
  readonly note: string;
};

/** La rutina de una sesión como la lee la superficie. */
export type RoutineReading = {
  readonly session: string;
  readonly previous: string | null;
  readonly next: string | null;
  readonly phases: Readonly<Record<RoutinePhase, RoutinePhaseReading>>;
};
