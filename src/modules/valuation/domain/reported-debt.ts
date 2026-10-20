import { z } from "zod";

import {
  engineDecimalSchema,
  formatDecimal,
  parseDecimal,
  sum,
  ZERO,
} from "./decimal-policy";

/**
 * Deuda reportada del ejercicio base (`F4-03`,
 * [ADR 0038](../../../../docs/architecture/adr/0038-reported-adjusted-normalization.md),
 * decisión 4).
 *
 * La taxonomía no tiene un concepto para «la deuda», y los que hay se solapan:
 * `LongTermDebt` incluye los vencimientos corrientes y `LongTermDebtNoncurrent`
 * no; `DebtCurrent` es toda la deuda corriente; Devon etiqueta los mismos 998 M
 * como vencimientos corrientes y como préstamos de corto plazo. Sumar lo que
 * haya cuenta dos veces. Por eso la deuda sale de la **primera receta** cuyos
 * componentes requeridos están, y la salida nombra la receta, lo que sumó y lo
 * que dejó afuera con su motivo.
 *
 * Sin receta, `unresolved`: la ausencia de una etiqueta no prueba que no haya
 * deuda, así que nunca vale cero (`TM-05`).
 */
export const REPORTED_DEBT_VERSION = "reported-debt-1.0.0";

/**
 * La no corriente que ya incluye los arrendamientos financieros: con ella, la
 * partida de arrendamientos financieros no se suma otra vez.
 */
export const NONCURRENT_INCLUDING_FINANCE_LEASES =
  "us-gaap:LongTermDebtAndCapitalLeaseObligations";

export const debtComponentKeySchema = z.enum([
  "longTermTotal",
  "longTermNoncurrent",
  "longTermCurrent",
  "currentTotal",
  "shortTermBorrowings",
  "commercialPaper",
  "financeLeases",
]);

export type DebtComponentKey = z.infer<typeof debtComponentKeySchema>;

export const DEBT_COMPONENT_KEYS = debtComponentKeySchema.options;

export const debtRecipeSchema = z.enum([
  "current_plus_noncurrent",
  "long_term_total_plus_short_term",
  "noncurrent_plus_current_maturities",
]);

export type DebtRecipe = z.infer<typeof debtRecipeSchema>;

export const debtExclusionReasonSchema = z.enum([
  /** Igual al centavo a los vencimientos corrientes: el mismo saldo dos veces. */
  "equals_current_maturities",
  /** La no corriente publicada ya incluye los arrendamientos financieros. */
  "included_in_noncurrent",
  /** Con préstamos de corto plazo publicados, los papeles no se suman aparte. */
  "short_term_borrowings_preferred",
  /** Publicado, pero la receta elegida no lo lee: otra partida ya lo cubre. */
  "not_in_recipe",
]);

const conceptSchema = z.string().trim().min(1).max(256);

export const reportedDebtSchema = z.discriminatedUnion("status", [
  z.object({
    version: z.literal(REPORTED_DEBT_VERSION),
    status: z.literal("resolved"),
    recipe: debtRecipeSchema,
    included: z
      .array(
        z.object({
          component: debtComponentKeySchema,
          concept: conceptSchema,
          amount: engineDecimalSchema,
        }),
      )
      .min(1)
      .max(7),
    excluded: z
      .array(
        z.object({
          component: debtComponentKeySchema,
          concept: conceptSchema,
          reason: debtExclusionReasonSchema,
        }),
      )
      .max(7),
    total: engineDecimalSchema,
  }),
  z.object({
    version: z.literal(REPORTED_DEBT_VERSION),
    status: z.literal("unresolved"),
    reason: z.enum(["no_recipe", "negative_component"]),
    /** Componentes publicados: dice qué había cuando ninguna receta cerró. */
    present: z.array(debtComponentKeySchema).max(7),
  }),
]);

export type ReportedDebt = z.infer<typeof reportedDebtSchema>;

export type DebtComponentValue = {
  readonly value: string;
  readonly concept: string;
};

export type ReportedDebtInput = Readonly<
  Record<DebtComponentKey, DebtComponentValue | null>
>;

/** Componentes que cada receta exige, en el orden en que se prueban. */
const RECIPES: readonly {
  recipe: DebtRecipe;
  required: readonly DebtComponentKey[];
}[] = [
  {
    recipe: "current_plus_noncurrent",
    required: ["currentTotal", "longTermNoncurrent"],
  },
  { recipe: "long_term_total_plus_short_term", required: ["longTermTotal"] },
  {
    recipe: "noncurrent_plus_current_maturities",
    required: ["longTermNoncurrent", "longTermCurrent"],
  },
];

/** Aplica la primera receta que cierra. Pura. */
export function resolveReportedDebt(input: ReportedDebtInput): ReportedDebt {
  const present = DEBT_COMPONENT_KEYS.filter((key) => input[key] !== null);
  const chosen = RECIPES.find(({ required }) =>
    required.every((key) => input[key] !== null),
  );

  if (chosen === undefined) {
    return {
      version: REPORTED_DEBT_VERSION,
      status: "unresolved",
      reason: "no_recipe",
      present,
    };
  }

  const included = new Set<DebtComponentKey>(chosen.required);
  const excluded = new Map<
    DebtComponentKey,
    z.infer<typeof debtExclusionReasonSchema>
  >();

  // La deuda de corto plazo que no son vencimientos: la primera receta ya la
  // tiene dentro de `DebtCurrent`; las otras dos la suman aparte.
  if (chosen.recipe !== "current_plus_noncurrent") {
    const shortTerm: DebtComponentKey | null =
      input.shortTermBorrowings !== null
        ? "shortTermBorrowings"
        : input.commercialPaper !== null
          ? "commercialPaper"
          : null;

    if (shortTerm === "shortTermBorrowings" && input.commercialPaper !== null) {
      excluded.set("commercialPaper", "short_term_borrowings_preferred");
    }

    if (shortTerm !== null) {
      const maturities = input.longTermCurrent;
      const value = parseDecimal(input[shortTerm]!.value, `debt.${shortTerm}`);

      if (
        maturities !== null &&
        !value.isZero() &&
        value.eq(parseDecimal(maturities.value, "debt.longTermCurrent"))
      ) {
        excluded.set(shortTerm, "equals_current_maturities");
      } else {
        included.add(shortTerm);
      }
    }
  }

  if (input.financeLeases !== null) {
    if (
      included.has("longTermNoncurrent") &&
      input.longTermNoncurrent?.concept === NONCURRENT_INCLUDING_FINANCE_LEASES
    ) {
      excluded.set("financeLeases", "included_in_noncurrent");
    } else {
      included.add("financeLeases");
    }
  }

  for (const key of present) {
    if (!included.has(key) && !excluded.has(key)) {
      excluded.set(key, "not_in_recipe");
    }
  }

  const ordered = DEBT_COMPONENT_KEYS.filter((key) => included.has(key));
  const amounts = ordered.map((key) =>
    parseDecimal(input[key]!.value, `debt.${key}`),
  );

  if (amounts.some((amount) => amount.lessThan(ZERO))) {
    return {
      version: REPORTED_DEBT_VERSION,
      status: "unresolved",
      reason: "negative_component",
      present,
    };
  }

  return {
    version: REPORTED_DEBT_VERSION,
    status: "resolved",
    recipe: chosen.recipe,
    included: ordered.map((key, index) => ({
      component: key,
      concept: input[key]!.concept,
      amount: formatDecimal(amounts[index]!, `debt.${key}`),
    })),
    excluded: DEBT_COMPONENT_KEYS.filter((key) => excluded.has(key)).map(
      (key) => ({
        component: key,
        concept: input[key]!.concept,
        reason: excluded.get(key)!,
      }),
    ),
    total: formatDecimal(sum(amounts), "debt.total"),
  };
}
