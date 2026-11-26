import { formatDecimal, parseDecimal, ZERO } from "./decimal-policy";

/**
 * Capitalización de los arrendamientos operativos (`F4-01`,
 * [ADR 0037](../../../../docs/architecture/adr/0037-lease-rd-capitalization.md),
 * decisión 1).
 *
 * Desde ASC 842 el balance publica el valor presente de los compromisos
 * descontado a la tasa incremental del arrendatario: es la deuda que el método
 * completo de Damodaran reconstruye desde el cronograma. Lo que el EBIT
 * reportado todavía resta es el gasto lineal del arrendamiento, que mezcla
 * depreciación e interés, así que el ajuste le devuelve el interés implícito:
 *
 *     lease_debt       = pasivo por arrendamientos operativos al cierre base
 *     imputed_interest = lease_debt × pre_tax_cost_of_debt
 *     ebit            += imputed_interest
 *     capital         += lease_debt
 *     deuda           += lease_debt
 *
 * Es pura: recibe los montos ya leídos y no completa nada. Un pasivo que no se
 * puede leer deja los arrendamientos sin capitalizar con su motivo, nunca en
 * cero; un pasivo reportado en cero es un hecho y capitaliza cero.
 */
export const LEASE_CAPITALIZATION_VERSION = "lease-capitalization-1.0.0";

/**
 * `1.1.0` (`F6-55`, ADR 0087): un emisor IFRS no tiene arrendamientos
 * operativos. Bajo IFRS 16 todo arrendamiento es un pasivo financiero cuyo
 * interés ya está en los costos financieros, debajo del EBIT: imputarle interés
 * lo contaría dos veces. Su pasivo entra a la deuda reportada como un
 * arrendamiento financiero (`reported-debt-1.0.0`), y esta regla lo nombra
 * (`ifrs16_lease_in_debt`) en vez de decir que no hay pasivo. Sólo esa salida
 * lleva `1.1.0`.
 */
export const IFRS16_LEASE_CAPITALIZATION_VERSION = "lease-capitalization-1.1.0";

/** El pasivo por arrendamientos de IFRS 16, total corriente más no corriente. */
export const IFRS16_LEASE_CONCEPT = "ifrs-full:LeaseLiabilities";

export type LeaseCapitalizationInput = {
  /** `OperatingLeaseLiability` del cierre base. */
  readonly totalLiability: string | null;
  /** `OperatingLeaseLiabilityCurrent` del mismo cierre. */
  readonly currentLiability: string | null;
  /** `OperatingLeaseLiabilityNoncurrent` del mismo cierre. */
  readonly noncurrentLiability: string | null;
  /** `costOfCapital.preTaxCostOfDebt` de la corrida. */
  readonly preTaxCostOfDebt: string | null;
  /** `ifrs-full:LeaseLiabilities` del cierre base, sólo de un emisor IFRS. */
  readonly ifrs16Liability?: string | null;
};

export type LeaseLiabilityBasis =
  /** El emisor publica el total. */
  | "reported_total"
  /** El emisor publica sólo las dos partes, del mismo cierre. */
  | "sum_of_parts";

export type LeaseNotCapitalizedReason =
  /** Ni el total ni ninguna de las partes. */
  | "lease_liability_missing"
  /** Una sola de las dos partes: no es el pasivo. */
  | "lease_liability_partial"
  /** Un pasivo negativo no es un pasivo. */
  | "lease_liability_negative"
  /** Sin costo de deuda no hay interés que imputar. */
  | "cost_of_debt_missing"
  /** IFRS 16: el pasivo ya es deuda y su interés ya está debajo del EBIT. */
  | "ifrs16_lease_in_debt";

export type LeaseCapitalization =
  | {
      readonly version: typeof LEASE_CAPITALIZATION_VERSION;
      readonly status: "capitalized";
      readonly liabilityBasis: LeaseLiabilityBasis;
      readonly leaseDebt: string;
      readonly preTaxCostOfDebt: string;
      readonly imputedInterest: string;
      readonly ebitAdjustment: string;
      readonly investedCapitalAdjustment: string;
      readonly debtAdjustment: string;
    }
  | {
      readonly version:
        | typeof LEASE_CAPITALIZATION_VERSION
        | typeof IFRS16_LEASE_CAPITALIZATION_VERSION;
      readonly status: "not_capitalized";
      readonly reason: LeaseNotCapitalizedReason;
    };

const notCapitalized = (
  reason: LeaseNotCapitalizedReason,
): LeaseCapitalization => ({
  version: LEASE_CAPITALIZATION_VERSION,
  status: "not_capitalized",
  reason,
});

export function capitalizeOperatingLeases(
  input: LeaseCapitalizationInput,
): LeaseCapitalization {
  let liabilityBasis: LeaseLiabilityBasis;
  let leaseDebt;

  if (input.totalLiability !== null) {
    liabilityBasis = "reported_total";
    leaseDebt = parseDecimal(input.totalLiability, "lease.totalLiability");
  } else if (
    input.currentLiability !== null &&
    input.noncurrentLiability !== null
  ) {
    liabilityBasis = "sum_of_parts";
    leaseDebt = parseDecimal(
      input.currentLiability,
      "lease.currentLiability",
    ).plus(
      parseDecimal(input.noncurrentLiability, "lease.noncurrentLiability"),
    );
  } else if (
    input.currentLiability === null &&
    input.noncurrentLiability === null &&
    input.ifrs16Liability !== undefined &&
    input.ifrs16Liability !== null
  ) {
    return {
      version: IFRS16_LEASE_CAPITALIZATION_VERSION,
      status: "not_capitalized",
      reason: "ifrs16_lease_in_debt",
    };
  } else {
    return notCapitalized(
      input.currentLiability === null && input.noncurrentLiability === null
        ? "lease_liability_missing"
        : "lease_liability_partial",
    );
  }

  if (leaseDebt.lessThan(ZERO)) {
    return notCapitalized("lease_liability_negative");
  }

  if (input.preTaxCostOfDebt === null) {
    return notCapitalized("cost_of_debt_missing");
  }

  const costOfDebt = parseDecimal(
    input.preTaxCostOfDebt,
    "lease.preTaxCostOfDebt",
  );
  const imputedInterest = leaseDebt.times(costOfDebt);
  const debt = formatDecimal(leaseDebt, "lease.leaseDebt");

  return {
    version: LEASE_CAPITALIZATION_VERSION,
    status: "capitalized",
    liabilityBasis,
    leaseDebt: debt,
    preTaxCostOfDebt: formatDecimal(costOfDebt, "lease.preTaxCostOfDebt"),
    imputedInterest: formatDecimal(imputedInterest, "lease.imputedInterest"),
    ebitAdjustment: formatDecimal(imputedInterest, "lease.ebitAdjustment"),
    investedCapitalAdjustment: debt,
    debtAdjustment: debt,
  };
}
