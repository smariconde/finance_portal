import {
  createDecimalOperations,
  HUNDRED,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";

/**
 * Dos lecturas de la cuenta en vivo que Schwab no publica hechas
 * (`live-account-figures-1.1.0`): cuánto cambió el valor de liquidación desde la
 * apertura y cuánto rinde una posición sobre su costo. Son lecturas para la
 * pantalla, en decimal; no entran en ninguna regla de riesgo.
 *
 * `1.1.0` (2026-11-19, pedido del owner): el cambio del día descuenta los
 * depósitos y retiros de la sesión (`account-cash-flow-1.0.0`). Una
 * transferencia de US$ 590 se leía como ganancia del día.
 */
export const LIVE_ACCOUNT_FIGURES_VERSION = "live-account-figures-1.1.0";

const { parseDecimal, divide, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);
const PATH = "live-account-figures";
const parse = (value: string) => parseDecimal(value, PATH);

/**
 * Valor de liquidación ahora menos al abrir, menos el neto de depósitos y
 * retiros de la sesión: lo que la cuenta ganó o perdió, no lo que le entró.
 * Con `cashFlows` en `null` (la base de trading no se leyó) no se pueden
 * descontar: el monto es el cambio bruto y `net` lo dice. Sin valor positivo al
 * abrir, el porcentaje es `null`, nunca un infinito.
 */
export function accountDayChange(input: {
  readonly liquidationValue: string;
  readonly liquidationValueAtOpen: string;
  readonly cashFlows: string | null;
}): {
  readonly amount: string;
  readonly percent: string | null;
  /** `true` si el monto ya descuenta los depósitos y retiros. */
  readonly net: boolean;
} {
  const now = parse(input.liquidationValue);
  const open = parse(input.liquidationValueAtOpen);
  const flows = input.cashFlows === null ? ZERO : parse(input.cashFlows);
  const amount = now.minus(open).minus(flows);
  return {
    amount: formatDecimal(amount, PATH),
    net: input.cashFlows !== null,
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
