import type { DepositaryRatio } from "@/modules/identity/domain/identity-graph";

import { divide, formatDecimal, parseDecimal, ZERO } from "./decimal-policy";

/**
 * Valor por CEDEAR que implica una corrida (`F6-04`).
 *
 * Es una conversión de unidades, no otra valuación: el valor por acción de la
 * subyacente por las acciones que representa un CEDEAR, según el ratio vigente
 * al corte de la corrida. Queda en la moneda de la corrida. Pasarlo a pesos
 * necesita el tipo al que cotiza el CEDEAR, que sale de su precio en BYMA y es
 * otro slice.
 *
 * `valor por CEDEAR = valor por acción × unidades subyacentes ÷ CEDEAR`
 *
 * Sin valor por acción —una corrida rechazada— o sin ratio efectivo, no hay
 * número: se nombra el motivo, nunca cero. Un valor por acción negativo se
 * convierte igual: el signo es del resultado, no de la conversión.
 */
export const CEDEAR_EQUIVALENT_VERSION = "cedear-equivalent-1.0.0";

export type CedearEquivalent =
  | {
      readonly status: "computed";
      readonly version: typeof CEDEAR_EQUIVALENT_VERSION;
      readonly value: string;
      readonly currency: string;
    }
  | {
      readonly status: "unavailable";
      readonly version: typeof CEDEAR_EQUIVALENT_VERSION;
      readonly reason: "no_value_per_share" | "no_ratio" | "invalid_ratio";
    };

export function cedearEquivalent(input: {
  readonly valuePerShare: string | null;
  readonly currency: string;
  readonly ratio: Pick<
    DepositaryRatio,
    "depositaryUnits" | "underlyingUnits"
  > | null;
}): CedearEquivalent {
  const unavailable = (
    reason: Extract<CedearEquivalent, { status: "unavailable" }>["reason"],
  ): CedearEquivalent => ({
    status: "unavailable",
    version: CEDEAR_EQUIVALENT_VERSION,
    reason,
  });

  if (input.valuePerShare === null) {
    return unavailable("no_value_per_share");
  }

  if (input.ratio === null) {
    return unavailable("no_ratio");
  }

  const depositaryUnits = parseDecimal(
    input.ratio.depositaryUnits,
    "ratio.depositaryUnits",
  );
  const underlyingUnits = parseDecimal(
    input.ratio.underlyingUnits,
    "ratio.underlyingUnits",
  );

  // El esquema del ratio ya exige positivos; esto es la red por si una fila
  // llega por otro camino.
  if (
    !depositaryUnits.greaterThan(ZERO) ||
    !underlyingUnits.greaterThan(ZERO)
  ) {
    return unavailable("invalid_ratio");
  }

  const value = divide(
    parseDecimal(input.valuePerShare, "valuePerShare").times(underlyingUnits),
    depositaryUnits,
    "cedearEquivalent",
  );

  return {
    status: "computed",
    version: CEDEAR_EQUIVALENT_VERSION,
    value: formatDecimal(value, "cedearEquivalent"),
    currency: input.currency,
  };
}
