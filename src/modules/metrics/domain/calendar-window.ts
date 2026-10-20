import {
  calendarDaysBetween,
  subtractCalendarYears,
} from "@/modules/temporal/domain/calendar-date";

import type { ReturnClose } from "./total-return";

/**
 * Ventana de calendario de una serie diaria que termina en el `as_of`
 * ([ADR 0028](../../../../docs/architecture/adr/0028-sortino-parameters-total-return.md)):
 * va de la misma fecha `n` años antes hasta el `as_of`, y su base es el último
 * cierre en o antes de ese inicio. La comparten las fórmulas que leen una
 * ventana —Sortino, volatilidad—, para que «cinco años» signifique lo mismo en
 * todas.
 *
 * Todo cierre posterior al `as_of` se ignora; nunca se acorta la ventana ni se
 * compone un retorno sobre un hueco.
 */
export const MAX_GAP_CALENDAR_DAYS = 5;

export type CalendarWindowNullReason =
  /** No hay cierre en el `as_of`: la ventana no termina donde las demás. */
  | "no_close_at_as_of"
  /** No hay cierre en o antes del inicio de la ventana: no se la acorta. */
  | "insufficient_history"
  /** Dos cierres consecutivos más separados que la tolerancia. */
  | "missing_period";

export type CalendarWindow =
  | {
      readonly status: "selected";
      readonly windowStart: string;
      /** Desde la base hasta el `as_of`, ordenados. */
      readonly closes: readonly ReturnClose[];
    }
  | {
      readonly status: "null";
      readonly windowStart: string;
      readonly reason: CalendarWindowNullReason;
      readonly marketDate: string | null;
    };

export function selectCalendarWindow(input: {
  readonly asOf: string;
  readonly windowYears: number;
  readonly closes: readonly ReturnClose[];
}): CalendarWindow {
  const windowStart = subtractCalendarYears(input.asOf, input.windowYears);
  const unavailable = (
    reason: CalendarWindowNullReason,
    marketDate: string | null,
  ): CalendarWindow => ({ status: "null", windowStart, reason, marketDate });

  const known = [...input.closes]
    .filter((close) => close.marketDate <= input.asOf)
    .sort((left, right) => (left.marketDate < right.marketDate ? -1 : 1));

  if (known.at(-1)?.marketDate !== input.asOf) {
    return unavailable("no_close_at_as_of", known.at(-1)?.marketDate ?? null);
  }

  const baseIndex = known.findLastIndex(
    (close) => close.marketDate <= windowStart,
  );

  if (baseIndex === -1) {
    return unavailable("insufficient_history", known[0]?.marketDate ?? null);
  }

  const closes = known.slice(baseIndex);

  for (let index = 1; index < closes.length; index += 1) {
    const gap = calendarDaysBetween(
      closes[index - 1]!.marketDate,
      closes[index]!.marketDate,
    );

    if (gap > MAX_GAP_CALENDAR_DAYS) {
      return unavailable("missing_period", closes[index]!.marketDate);
    }
  }

  return { status: "selected", windowStart, closes };
}
