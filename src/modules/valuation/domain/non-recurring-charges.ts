import { z } from "zod";

import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

import {
  engineDecimalSchema,
  formatDecimal,
  parseDecimal,
} from "./decimal-policy";

/**
 * Cargos no recurrentes del ejercicio base (`F4-03`,
 * [ADR 0038](../../../../docs/architecture/adr/0038-reported-adjusted-normalization.md),
 * decisión 5).
 *
 * El cargo del ejercicio base se revierte del EBIT —con su signo: un recupero
 * no recurrente lo baja— sólo si **ninguno de los cuatro ejercicios
 * anteriores** tuvo un cargo distinto de cero de la misma categoría, y los
 * cuatro están en la serie. Un cargo que vuelve es un costo del negocio
 * (Damodaran): Salesforce reestructura todos los años desde 2023.
 *
 * Cada categoría es **un solo concepto por ejercicio**, el que la serie anual
 * eligió de su lista: los de deterioro se solapan entre filers y sumarlos
 * contaría dos veces. Quedarse corto es el error conservador, porque el ajuste
 * sube el EBIT.
 */
export const NON_RECURRING_CHARGE_VERSION = "non-recurring-charge-1.0.0";

/** Ejercicios anteriores al base que tienen que estar sin el cargo. */
export const NON_RECURRING_LOOKBACK_YEARS = 4;

export const chargeCategorySchema = z.enum(["restructuring", "impairment"]);

export type ChargeCategory = z.infer<typeof chargeCategorySchema>;

export const nonRecurringChargeSchema = z.discriminatedUnion("status", [
  z.object({
    version: z.literal(NON_RECURRING_CHARGE_VERSION),
    category: chargeCategorySchema,
    status: z.literal("applied"),
    concept: z.string().trim().min(1).max(256),
    charge: engineDecimalSchema,
    /** Lo que se suma al EBIT: el cargo, con su signo. */
    ebitAdjustment: engineDecimalSchema,
  }),
  z.object({
    version: z.literal(NON_RECURRING_CHARGE_VERSION),
    category: chargeCategorySchema,
    status: z.literal("not_applied"),
    reason: z.enum([
      "not_reported",
      "zero_charge",
      "insufficient_history",
      "recurring",
    ]),
    /** Ejercicios anteriores con cargo, cuando es `recurring`. */
    recurringIn: z.array(calendarDateSchema).max(NON_RECURRING_LOOKBACK_YEARS),
  }),
]);

export type NonRecurringCharge = z.infer<typeof nonRecurringChargeSchema>;

export type ChargeYear = {
  readonly fiscalYearEnd: string;
  /** La serie tiene el estado de resultados de ese ejercicio (sus ventas). */
  readonly covered: boolean;
  readonly charge: { readonly value: string; readonly concept: string } | null;
};

/**
 * `years` va del ejercicio base hacia atrás. Una etiqueta ausente en un
 * ejercicio cubierto cuenta como sin cargo: los cargos de un año se
 * etiquetan, y exigir el cero explícito dejaría casi todo sin evidencia.
 */
export function assessNonRecurringCharge(
  category: ChargeCategory,
  years: readonly ChargeYear[],
): NonRecurringCharge {
  const notApplied = (
    reason:
      "not_reported" | "zero_charge" | "insufficient_history" | "recurring",
    recurringIn: string[] = [],
  ): NonRecurringCharge => ({
    version: NON_RECURRING_CHARGE_VERSION,
    category,
    status: "not_applied",
    reason,
    recurringIn,
  });

  const base = years[0];

  if (base?.charge === null || base === undefined) {
    return notApplied("not_reported");
  }

  const charge = parseDecimal(base.charge.value, `${category}.charge`);

  if (charge.isZero()) {
    return notApplied("zero_charge");
  }

  const prior = years.slice(1, 1 + NON_RECURRING_LOOKBACK_YEARS);

  if (
    prior.length < NON_RECURRING_LOOKBACK_YEARS ||
    prior.some((year) => !year.covered)
  ) {
    return notApplied("insufficient_history");
  }

  const recurringIn = prior
    .filter(
      (year) =>
        year.charge !== null &&
        !parseDecimal(year.charge.value, `${category}.prior`).isZero(),
    )
    .map((year) => year.fiscalYearEnd);

  if (recurringIn.length > 0) {
    return notApplied("recurring", recurringIn);
  }

  const formatted = formatDecimal(charge, `${category}.charge`);

  return {
    version: NON_RECURRING_CHARGE_VERSION,
    category,
    status: "applied",
    concept: base.charge.concept,
    charge: formatted,
    ebitAdjustment: formatted,
  };
}
