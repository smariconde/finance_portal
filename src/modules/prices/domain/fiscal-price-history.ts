import {
  subtractCalendarYears,
  subtractDays,
} from "@/modules/temporal/domain/calendar-date";

/**
 * Historia de precios para la vista a cinco años de las divergencias (`F8-02`).
 *
 * La matriz de riesgo pide cinco años y dos semanas; el cierre fiscal de hace
 * cinco ejercicios queda antes, porque el último ejercicio cerró hasta un año
 * atrás. Siete años lo alcanzan. La corrida que los pide registra la versión y
 * el inicio pedido (`selectionAnchorOn`), como la SEC registra su ancla: es lo
 * que dice hasta dónde se fue a buscar, y por eso una security que no cotizaba
 * todavía en ese cierre no se vuelve a pedir.
 */
export const FISCAL_PRICE_HISTORY_VERSION = "fiscal-price-history-1.0.0";
export const FISCAL_PRICE_HISTORY_YEARS = 7;
const FISCAL_PRICE_HISTORY_MARGIN_DAYS = 14;

/** Primer día que pide una descarga de siete años hecha `today`. */
export function fiscalPriceHistoryStart(today: string): string {
  return subtractDays(
    subtractCalendarYears(today, FISCAL_PRICE_HISTORY_YEARS),
    FISCAL_PRICE_HISTORY_MARGIN_DAYS,
  );
}

export type FiscalPriceHistoryNeed =
  | { readonly status: "covered" }
  | { readonly status: "needed"; readonly from: string }
  /** Ya se pidió desde antes de `from`: el precio no existe en la fuente. */
  | { readonly status: "already_requested"; readonly from: string }
  /** Ni siete años alcanzan: pedirlo no lo traería y se pediría siempre. */
  | { readonly status: "beyond_history_window"; readonly from: string };

/**
 * Si hay que pedir la historia larga de una security. `from` es el primer día
 * en que un cierre sirve para el ejercicio (`fiscalYearEnd − maxLagDays`).
 */
export function assessFiscalPriceHistory(input: {
  readonly fiscalYearEnd: string;
  readonly maxLagDays: number;
  /** El precio ya está a la vista en ese cierre. */
  readonly priceFound: boolean;
  /** Inicio pedido por la última corrida anclada, o `null` si nunca hubo. */
  readonly requestedFrom: string | null;
  readonly today: string;
}): FiscalPriceHistoryNeed {
  if (input.priceFound) {
    return { status: "covered" };
  }

  const from = subtractDays(input.fiscalYearEnd, input.maxLagDays);

  if (input.requestedFrom !== null && input.requestedFrom <= from) {
    return { status: "already_requested", from };
  }

  if (fiscalPriceHistoryStart(input.today) > from) {
    return { status: "beyond_history_window", from };
  }

  return { status: "needed", from };
}
