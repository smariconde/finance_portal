import {
  createDecimalOperations,
  sum,
} from "@/modules/numeric/domain/decimal-policy";

import type { SchwabPosition } from "./schwab-account";

/**
 * Lo abierto del día (`open-day-pnl-1.0.0`, `F11-06`): la suma de lo que Schwab
 * publica por posición, `currentDayProfitLoss` para el día y el P&L abierto del
 * lado de la posición para el total. Son cifras de Schwab tal cual; no se
 * recalculan con una cotización. Una posición plana no cuenta, y si una abierta
 * no trae la cifra, la suma es `null` con cuántas faltan: sumar las demás
 * mostraría como total un parcial.
 */
export const OPEN_DAY_PNL_VERSION = "open-day-pnl-1.0.0";

const { parseDecimal, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

export type OpenAmount =
  | { readonly value: string; readonly missing: 0 }
  | { readonly value: null; readonly missing: number };

export type OpenDayPnl = {
  readonly positions: number;
  readonly day: OpenAmount;
  readonly open: OpenAmount;
};

function total(values: readonly (string | null)[]): OpenAmount {
  const missing = values.filter((value) => value === null).length;
  if (missing > 0) return { value: null, missing };
  const path = "open-day-pnl";
  return {
    value: formatDecimal(
      sum(values.map((value) => parseDecimal(value!, path))),
      path,
    ),
    missing: 0,
  };
}

export function openDayPnl(positions: readonly SchwabPosition[]): OpenDayPnl {
  const open = positions.filter((position) => position.side !== "flat");
  return {
    positions: open.length,
    day: total(open.map((position) => position.dayProfitLoss)),
    open: total(open.map((position) => position.openProfitLoss)),
  };
}

/**
 * El día entero: lo realizado más lo abierto del día. Sin la cifra abierta no
 * hay total; lo realizado solo no es el día.
 */
export function dayTotal(realized: string, open: OpenAmount): string | null {
  if (open.value === null) return null;
  const path = "open-day-pnl";
  return formatDecimal(
    parseDecimal(realized, path).plus(parseDecimal(open.value, path)),
    path,
  );
}
