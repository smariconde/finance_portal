import {
  createDecimalOperations,
  HUNDRED,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";

/**
 * Dos lecturas de la cuenta en vivo que Schwab no publica hechas
 * (`live-account-figures-1.0.0`): cuánto cambió el valor de liquidación desde la
 * apertura y cuánto rinde una posición sobre su costo. Son lecturas para la
 * pantalla, en decimal; no entran en ninguna regla de riesgo.
 */
export const LIVE_ACCOUNT_FIGURES_VERSION = "live-account-figures-1.0.0";

const { parseDecimal, divide, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);
const PATH = "live-account-figures";
const parse = (value: string) => parseDecimal(value, PATH);

/**
 * Valor de liquidación ahora menos al abrir. Un depósito o un retiro del día
 * también lo mueve: es el cambio de la cuenta, no el P&L. Sin valor positivo al
 * abrir, el porcentaje es `null`, nunca un infinito.
 */
export function accountDayChange(input: {
  readonly liquidationValue: string;
  readonly liquidationValueAtOpen: string;
}): { readonly amount: string; readonly percent: string | null } {
  const now = parse(input.liquidationValue);
  const open = parse(input.liquidationValueAtOpen);
  const amount = now.minus(open);
  return {
    amount: formatDecimal(amount, PATH),
    percent: open.greaterThan(ZERO)
      ? formatDecimal(divide(amount.times(HUNDRED), open, PATH), PATH)
      : null,
  };
}

/**
 * El P&L abierto sobre el costo (`precio medio × cantidad`). `null` sin P&L de
 * Schwab, sin costo positivo o en una opción, cuyo costo lleva un multiplicador
 * que esta lectura no mide.
 */
export function positionOpenReturn(input: {
  readonly averagePrice: string;
  readonly quantity: string;
  readonly openProfitLoss: string | null;
  readonly optionMultiplier: string | null;
}): string | null {
  if (input.openProfitLoss === null || input.optionMultiplier !== null)
    return null;
  const cost = parse(input.averagePrice).times(parse(input.quantity));
  if (!cost.greaterThan(ZERO)) return null;
  return formatDecimal(
    divide(parse(input.openProfitLoss).times(HUNDRED), cost, PATH),
    PATH,
  );
}
