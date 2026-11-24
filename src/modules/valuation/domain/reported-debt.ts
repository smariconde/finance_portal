import { z } from "zod";

import type { LineItemId } from "./annual-fundamentals";
import {
  engineDecimalSchema,
  formatDecimal,
  parseDecimal,
  sum,
  ZERO,
} from "./decimal-policy";
import {
  ZERO_DEBT_EVIDENCE_SHORT_HISTORY_VERSION,
  ZERO_DEBT_EVIDENCE_VERSION,
  zeroDebtShortfall,
  type ZeroDebtEvidence,
} from "./zero-debt-evidence";

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
 *
 * `1.1.0` (`F6-15`, ADR 0054): sin receta y con la evidencia de
 * `zero-debt-evidence-1.0.0`, la deuda son los arrendamientos financieros si
 * se publican (`finance_leases_only`, Vertex) y cero si no (`zero_with_evidence`).
 * Sólo esas dos salidas llevan `1.1.0`: donde una receta cierra o no hay
 * evidencia, la salida es la de `1.0.0` byte por byte, y una corrida anterior
 * conserva su hash.
 *
 * `1.2.0` (`F6-35`/`F6-36`, decisión del owner del 2026-11-18 con CrowdStrike
 * medido): sin receta ni evidencia, la deuda es la **no corriente sola** cuando
 * el filer no publica ninguna partida corriente —ni deuda corriente, ni
 * vencimientos, ni préstamos de corto plazo, ni papeles—
 * (`noncurrent_only`). CrowdStrike publica sólo `LongTermDebtNoncurrent`
 * (746 M de bonos a 2029) y Snowflake sólo `ConvertibleDebtNoncurrent`
 * (2.284 M). Es una excepción declarada a «la ausencia no prueba nada»: se
 * confía en que no hay porción corriente, y la receta lo nombra. Sólo esa
 * salida lleva `1.2.0`.
 *
 * `1.3.0` (`F6-46`, medido en Neon el 2026-11-24): sin receta ni evidencia, la
 * deuda es la **no corriente más los préstamos de corto plazo** cuando ésa es
 * la única deuda corriente que el filer publica y la suma coincide, dentro del
 * 0,5 %, con un total de deuda que el mismo filer publica al mismo cierre
 * (`noncurrent_plus_short_term`). Netflix etiqueta los vencimientos de sus
 * bonos como `ShortTermBorrowings` y su `NotesPayable` cierra la suma en
 * diez cierres seguidos (≤ 0,003 %); Motorola, Trimble y McDonald's cierran
 * contra `DebtInstrumentCarryingAmount` o `DebtLongtermAndShorttermCombinedAmount`.
 * Sin el control no aplica: en Caterpillar los préstamos son de la financiera
 * y los vencimientos no están, y AMD queda 22,7 % lejos de su total. Sólo esa
 * salida lleva `1.3.0` y nombra el control que la cerró.
 */
export const REPORTED_DEBT_VERSION = "reported-debt-1.0.0";
export const REPORTED_DEBT_EVIDENCE_VERSION = "reported-debt-1.1.0";
export const REPORTED_DEBT_NONCURRENT_ONLY_VERSION = "reported-debt-1.2.0";
export const REPORTED_DEBT_CONTROLLED_VERSION = "reported-debt-1.3.0";

/** Cuánto puede apartarse la suma del total publicado: el redondeo impreso. */
export const DEBT_CONTROL_TOLERANCE = "0.005";

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

/**
 * Los totales de deuda que un filer publica aparte de su balance (`1.3.0`).
 * Ninguna receta los suma: sólo corroboran una suma. El orden es el de
 * preferencia cuando más de uno cierra.
 */
export const debtControlKeySchema = z.enum([
  "notesPayable",
  "debtInstrumentCarryingAmount",
  "debtCombinedTotal",
]);

export type DebtControlKey = z.infer<typeof debtControlKeySchema>;

export const DEBT_CONTROL_KEYS = debtControlKeySchema.options;

/** La partida de la serie anual —de la guardia de deuda— de cada control. */
export const DEBT_CONTROL_ITEMS: Readonly<Record<DebtControlKey, LineItemId>> =
  {
    notesPayable: "notes_payable",
    debtInstrumentCarryingAmount: "debt_instrument_carrying_amount",
    debtCombinedTotal: "debt_combined_total",
  };

export const DEBT_COMPONENT_KEYS = debtComponentKeySchema.options;

/** La partida de la serie anual que alimenta cada componente de la deuda. */
export const DEBT_ITEMS: Readonly<Record<DebtComponentKey, LineItemId>> = {
  longTermTotal: "debt_long_term_total",
  longTermNoncurrent: "debt_long_term_noncurrent",
  longTermCurrent: "debt_long_term_current",
  currentTotal: "debt_current_total",
  shortTermBorrowings: "debt_short_term_borrowings",
  commercialPaper: "debt_commercial_paper",
  financeLeases: "finance_lease_liability",
};

export const debtRecipeSchema = z.enum([
  "current_plus_noncurrent",
  "long_term_total_plus_short_term",
  "noncurrent_plus_current_maturities",
  /** Sin préstamos con evidencia: la deuda son los arrendamientos financieros. */
  "finance_leases_only",
  /** Sin ninguna partida corriente publicada: la no corriente sola (`1.2.0`). */
  "noncurrent_only",
  /** No corriente más préstamos de corto plazo, corroborada (`1.3.0`). */
  "noncurrent_plus_short_term",
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
  /** Publicado en cero, con la evidencia de deuda cero (`1.1.0`). */
  "reported_zero",
]);

const conceptSchema = z.string().trim().min(1).max(256);

export const reportedDebtSchema = z.discriminatedUnion("status", [
  z.object({
    version: z.enum([
      REPORTED_DEBT_VERSION,
      REPORTED_DEBT_EVIDENCE_VERSION,
      REPORTED_DEBT_NONCURRENT_ONLY_VERSION,
      REPORTED_DEBT_CONTROLLED_VERSION,
    ]),
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
    /** El total publicado que cerró la suma; sólo en `1.3.0`. */
    control: z
      .object({
        key: debtControlKeySchema,
        concept: conceptSchema,
        amount: engineDecimalSchema,
      })
      .optional(),
  }),
  z.object({
    version: z.literal(REPORTED_DEBT_VERSION),
    status: z.literal("unresolved"),
    reason: z.enum(["no_recipe", "negative_component"]),
    /** Componentes publicados: dice qué había cuando ninguna receta cerró. */
    present: z.array(debtComponentKeySchema).max(7),
  }),
  z.object({
    version: z.literal(REPORTED_DEBT_EVIDENCE_VERSION),
    status: z.literal("zero_with_evidence"),
    evidence: z.enum([
      ZERO_DEBT_EVIDENCE_VERSION,
      ZERO_DEBT_EVIDENCE_SHORT_HISTORY_VERSION,
    ]),
    /** Componentes del ejercicio base publicados en cero. */
    reportedZero: z.array(debtComponentKeySchema).max(7),
    total: engineDecimalSchema,
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

export type ReportedDebtControls = Readonly<
  Record<DebtControlKey, DebtComponentValue | null>
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

/**
 * Sin receta: con evidencia de deuda cero, los arrendamientos financieros o
 * cero; sin ella, `no_recipe`. Un componente de préstamos publicado con monto
 * no deja usar la evidencia, aunque la evidencia diga que no lo hay.
 */
function withoutRecipe(
  input: ReportedDebtInput,
  present: DebtComponentKey[],
  evidence: ZeroDebtEvidence | null,
  controls: ReportedDebtControls | null,
): ReportedDebt {
  const unresolved: ReportedDebt = {
    version: REPORTED_DEBT_VERSION,
    status: "unresolved",
    reason: "no_recipe",
    present,
  };

  const fallback = () =>
    noncurrentOnly(input, present) ??
    noncurrentPlusShortTerm(input, present, controls) ??
    unresolved;

  if (evidence === null || zeroDebtShortfall(evidence) !== null) {
    return fallback();
  }

  const borrowings = present.filter((key) => key !== "financeLeases");
  const amounts = new Map(
    present.map((key) => [key, parseDecimal(input[key]!.value, `debt.${key}`)]),
  );

  if (borrowings.some((key) => !amounts.get(key)!.isZero())) {
    return fallback();
  }

  const leases = amounts.get("financeLeases");

  if (leases !== undefined && leases.lessThan(ZERO)) {
    return {
      version: REPORTED_DEBT_VERSION,
      status: "unresolved",
      reason: "negative_component",
      present,
    };
  }

  if (leases === undefined || leases.isZero()) {
    return {
      version: REPORTED_DEBT_EVIDENCE_VERSION,
      status: "zero_with_evidence",
      evidence: evidence.version,
      reportedZero: present,
      total: formatDecimal(ZERO, "debt.total"),
    };
  }

  return {
    version: REPORTED_DEBT_EVIDENCE_VERSION,
    status: "resolved",
    recipe: "finance_leases_only",
    included: [
      {
        component: "financeLeases",
        concept: input.financeLeases!.concept,
        amount: formatDecimal(leases, "debt.financeLeases"),
      },
    ],
    excluded: borrowings.map((key) => ({
      component: key,
      concept: input[key]!.concept,
      reason: "reported_zero" as const,
    })),
    total: formatDecimal(leases, "debt.total"),
  };
}

const CURRENT_COMPONENTS: readonly DebtComponentKey[] = [
  "currentTotal",
  "longTermCurrent",
  "shortTermBorrowings",
  "commercialPaper",
];

/**
 * `noncurrent_only` (`1.2.0`): la no corriente, más los arrendamientos
 * financieros si se publican aparte, cuando no hay ninguna partida corriente.
 * `null` si no aplica.
 */
function noncurrentOnly(
  input: ReportedDebtInput,
  present: DebtComponentKey[],
): ReportedDebt | null {
  // Un cero publicado sigue el camino de la evidencia de deuda cero: esta
  // receta no prueba ausencias, sólo suma una deuda que sí se publica.
  if (
    input.longTermNoncurrent === null ||
    input.longTermTotal !== null ||
    CURRENT_COMPONENTS.some((key) => input[key] !== null) ||
    !parseDecimal(
      input.longTermNoncurrent.value,
      "debt.longTermNoncurrent",
    ).greaterThan(ZERO)
  ) {
    return null;
  }

  const included: DebtComponentKey[] = ["longTermNoncurrent"];
  const excluded: {
    component: DebtComponentKey;
    concept: string;
    reason: z.infer<typeof debtExclusionReasonSchema>;
  }[] = [];

  if (input.financeLeases !== null) {
    if (
      input.longTermNoncurrent.concept === NONCURRENT_INCLUDING_FINANCE_LEASES
    ) {
      excluded.push({
        component: "financeLeases",
        concept: input.financeLeases.concept,
        reason: "included_in_noncurrent",
      });
    } else {
      included.push("financeLeases");
    }
  }

  const amounts = included.map((key) =>
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
    version: REPORTED_DEBT_NONCURRENT_ONLY_VERSION,
    status: "resolved",
    recipe: "noncurrent_only",
    included: included.map((key, index) => ({
      component: key,
      concept: input[key]!.concept,
      amount: formatDecimal(amounts[index]!, `debt.${key}`),
    })),
    excluded,
    total: formatDecimal(sum(amounts), "debt.total"),
  };
}

/**
 * `noncurrent_plus_short_term` (`1.3.0`): la no corriente más los préstamos de
 * corto plazo, cuando ninguna otra partida corriente se publica y la suma
 * coincide con un total publicado al mismo cierre. Los papeles comerciales
 * quedan dentro de los préstamos, como en las otras recetas. Los
 * arrendamientos financieros se suman aparte, salvo que la no corriente ya los
 * incluya; el control se compara sin ellos. `null` si no aplica.
 */
function noncurrentPlusShortTerm(
  input: ReportedDebtInput,
  present: DebtComponentKey[],
  controls: ReportedDebtControls | null,
): ReportedDebt | null {
  if (
    controls === null ||
    input.longTermNoncurrent === null ||
    input.shortTermBorrowings === null ||
    input.longTermTotal !== null ||
    input.currentTotal !== null ||
    input.longTermCurrent !== null
  ) {
    return null;
  }

  const noncurrent = parseDecimal(
    input.longTermNoncurrent.value,
    "debt.longTermNoncurrent",
  );
  const shortTerm = parseDecimal(
    input.shortTermBorrowings.value,
    "debt.shortTermBorrowings",
  );

  if (!noncurrent.greaterThan(ZERO) || shortTerm.lessThan(ZERO)) {
    return null;
  }

  const borrowed = noncurrent.plus(shortTerm);
  const tolerance = borrowed.times(
    parseDecimal(DEBT_CONTROL_TOLERANCE, "debt.controlTolerance"),
  );
  const control = DEBT_CONTROL_KEYS.map((key) => ({
    key,
    value: controls[key],
  })).find(
    ({ value }) =>
      value !== null &&
      parseDecimal(value.value, "debt.control")
        .minus(borrowed)
        .abs()
        .lte(tolerance),
  );

  if (control === undefined) {
    return null;
  }

  const included: DebtComponentKey[] = [
    "longTermNoncurrent",
    "shortTermBorrowings",
  ];
  const excluded: {
    component: DebtComponentKey;
    concept: string;
    reason: z.infer<typeof debtExclusionReasonSchema>;
  }[] = [];

  if (input.commercialPaper !== null) {
    excluded.push({
      component: "commercialPaper",
      concept: input.commercialPaper.concept,
      reason: "short_term_borrowings_preferred",
    });
  }

  if (input.financeLeases !== null) {
    if (
      input.longTermNoncurrent.concept === NONCURRENT_INCLUDING_FINANCE_LEASES
    ) {
      excluded.push({
        component: "financeLeases",
        concept: input.financeLeases.concept,
        reason: "included_in_noncurrent",
      });
    } else {
      included.push("financeLeases");
    }
  }

  const amounts = included.map((key) =>
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
    version: REPORTED_DEBT_CONTROLLED_VERSION,
    status: "resolved",
    recipe: "noncurrent_plus_short_term",
    included: included.map((key, index) => ({
      component: key,
      concept: input[key]!.concept,
      amount: formatDecimal(amounts[index]!, `debt.${key}`),
    })),
    excluded: DEBT_COMPONENT_KEYS.flatMap((key) =>
      excluded.filter((entry) => entry.component === key),
    ),
    total: formatDecimal(sum(amounts), "debt.total"),
    control: {
      key: control.key,
      concept: control.value!.concept,
      amount: formatDecimal(
        parseDecimal(control.value!.value, "debt.control"),
        "debt.control",
      ),
    },
  };
}

/**
 * Aplica la primera receta que cierra; sin ninguna, la evidencia de deuda cero
 * si la hay (`1.1.0`), la no corriente sola (`1.2.0`) o la no corriente más
 * los préstamos corroborada por un control (`1.3.0`). Pura.
 */
export function resolveReportedDebt(
  input: ReportedDebtInput,
  evidence: ZeroDebtEvidence | null = null,
  controls: ReportedDebtControls | null = null,
): ReportedDebt {
  const present = DEBT_COMPONENT_KEYS.filter((key) => input[key] !== null);
  const chosen = RECIPES.find(({ required }) =>
    required.every((key) => input[key] !== null),
  );

  if (chosen === undefined) {
    return withoutRecipe(input, present, evidence, controls);
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
