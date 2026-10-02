import type {
  AnnualFundamentals,
  FiscalYear,
  LineItemId,
} from "./annual-fundamentals";

/**
 * Perfil de completitud de una empresa (`F3-02`): qué existe de verdad en la
 * base para valuarla, medido sobre la serie anual y sin estimar lo ausente.
 *
 * Es la entrada del nivel de rigor (`F3-03`) y reemplaza al booleano de
 * preflight del selector: cada comprobación tiene nombre, estado y qué faltó,
 * de modo que conseguir un dato y volver a evaluar sea una acción concreta.
 *
 * Un dato ausente es `missing`, nunca cero. Una comprobación que este sistema
 * todavía no puede hacer —la industria antes de `F3-05`— es `not_evaluated`, que
 * tampoco es un `met`.
 */
export const COMPLETENESS_PROFILE_VERSION = "completeness-profile-1.0.0";

export const completenessCheckIds = [
  /** Lo mínimo para que el motor FCFF empiece, en el último ejercicio. */
  "structural_inputs",
  /** Ejercicios consecutivos con ventas y EBIT, desde el último. */
  "history_years",
  /** Caja y deuda separadas en el último balance. */
  "cash_and_debt",
  /** Pasivo por arrendamientos para tratarlos como deuda. */
  "leases",
  /** Historia de I+D para capitalizarla. */
  "research_development",
  /** Capex y depreciación del último ejercicio. */
  "reinvestment_inputs",
  /** Resultado antes de impuestos e impuesto del último ejercicio. */
  "tax_rate_inputs",
  /** Industria del dataset de Damodaran (`F3-05`). */
  "industry_mapping",
  /** Mix geográfico de ingresos para ponderar riesgo país. */
  "geographic_revenue_mix",
] as const;

export type CompletenessCheckId = (typeof completenessCheckIds)[number];

export type CompletenessStatus =
  "met" | "partial" | "missing" | "not_evaluated";

export type CompletenessCheck = {
  readonly check: CompletenessCheckId;
  readonly status: CompletenessStatus;
  /** Partidas o condiciones que faltaron, con nombre estable. */
  readonly missing: readonly string[];
  /** Medidas que sostienen el estado: años, cantidad de partidas. */
  readonly measures: Readonly<Record<string, number>>;
};

/** Qué dijo el mapeo a industria; `null` mientras no exista esa evaluación. */
export type IndustryMappingStatus = "mapped" | "ambiguous" | "unmapped";

export type CompletenessContext = {
  readonly industryMapping: IndustryMappingStatus | null;
};

export type CompletenessProfile = {
  readonly version: typeof COMPLETENESS_PROFILE_VERSION;
  readonly latestFiscalYearEnd: string | null;
  readonly checks: readonly CompletenessCheck[];
};

/** Años de historia que pide `full` y los que pide `standard`. */
export const FULL_HISTORY_YEARS = 5;
export const STANDARD_HISTORY_YEARS = 3;
/** Ejercicios con I+D publicada que permiten capitalizarla. */
export const RESEARCH_HISTORY_YEARS = 3;

function has(year: FiscalYear | undefined, item: LineItemId): boolean {
  return year?.items[item] !== undefined;
}

function hasEbit(year: FiscalYear | undefined): boolean {
  return (
    has(year, "operating_income") ||
    (has(year, "pretax_income") && has(year, "interest_expense"))
  );
}

function check(
  id: CompletenessCheckId,
  status: CompletenessStatus,
  missing: readonly string[] = [],
  measures: Record<string, number> = {},
): CompletenessCheck {
  return { check: id, status, missing, measures };
}

function itemsCheck(
  id: CompletenessCheckId,
  year: FiscalYear | undefined,
  required: readonly (readonly [string, boolean])[],
): CompletenessCheck {
  const missing = required
    .filter(([, present]) => !present)
    .map(([name]) => name);
  const status =
    missing.length === 0
      ? "met"
      : year === undefined || missing.length === required.length
        ? "missing"
        : "partial";

  return check(id, status, missing, {
    present: required.length - missing.length,
    required: required.length,
  });
}

/**
 * Años consecutivos desde el último con ventas y EBIT. Un hueco corta la cuenta:
 * cinco ejercicios con uno faltante en el medio no son cinco años de historia.
 */
function consecutiveYears(series: AnnualFundamentals): number {
  let count = 0;

  for (const [index, year] of series.fiscalYears.entries()) {
    const previous = series.fiscalYears[index - 1];

    if (previous !== undefined) {
      const gapDays =
        (Date.parse(`${previous.fiscalYearEnd}T00:00:00.000Z`) -
          Date.parse(`${year.fiscalYearEnd}T00:00:00.000Z`)) /
        86_400_000;

      if (gapDays > 380) {
        break;
      }
    }

    if (!has(year, "revenue") || !hasEbit(year)) {
      break;
    }

    count += 1;
  }

  return count;
}

export function measureCompleteness(
  series: AnnualFundamentals | null,
  context: CompletenessContext,
): CompletenessProfile {
  const latest = series?.fiscalYears[0];
  const years = series === null ? 0 : consecutiveYears(series);
  const researchYears =
    series?.fiscalYears.filter((year) => has(year, "research_development"))
      .length ?? 0;

  const checks: CompletenessCheck[] = [
    latest === undefined
      ? check("structural_inputs", "missing", ["annual_fundamentals"])
      : itemsCheck("structural_inputs", latest, [
          ["revenue", has(latest, "revenue")],
          ["operating_income", hasEbit(latest)],
          ["income_tax", has(latest, "income_tax")],
          ["diluted_shares", has(latest, "diluted_shares")],
        ]),
    check(
      "history_years",
      years >= FULL_HISTORY_YEARS
        ? "met"
        : years >= STANDARD_HISTORY_YEARS
          ? "partial"
          : "missing",
      years >= FULL_HISTORY_YEARS
        ? []
        : [`fiscal_years_with_revenue_and_ebit.${FULL_HISTORY_YEARS}`],
      { years },
    ),
    itemsCheck("cash_and_debt", latest, [
      ["cash", has(latest, "cash")],
      [
        "debt",
        has(latest, "long_term_debt") ||
          has(latest, "debt_current") ||
          has(latest, "short_term_borrowings"),
      ],
    ]),
    itemsCheck("leases", latest, [
      ["operating_lease_liability", has(latest, "operating_lease_liability")],
    ]),
    check(
      "research_development",
      researchYears >= RESEARCH_HISTORY_YEARS
        ? "met"
        : researchYears > 0
          ? "partial"
          : "missing",
      researchYears >= RESEARCH_HISTORY_YEARS
        ? []
        : researchYears > 0
          ? [`research_development.${RESEARCH_HISTORY_YEARS}_fiscal_years`]
          : ["research_development.not_reported"],
      { years: researchYears },
    ),
    itemsCheck("reinvestment_inputs", latest, [
      ["capital_expenditure", has(latest, "capital_expenditure")],
      ["depreciation_amortization", has(latest, "depreciation_amortization")],
    ]),
    itemsCheck("tax_rate_inputs", latest, [
      ["pretax_income", has(latest, "pretax_income")],
      ["income_tax", has(latest, "income_tax")],
    ]),
    context.industryMapping === null
      ? check("industry_mapping", "not_evaluated", ["industry_mapping"])
      : check(
          "industry_mapping",
          context.industryMapping === "mapped"
            ? "met"
            : context.industryMapping === "ambiguous"
              ? "partial"
              : "missing",
          context.industryMapping === "mapped"
            ? []
            : [`industry_mapping.${context.industryMapping}`],
        ),
    // companyfacts publica hechos sin dimensiones: el mix por país no llega a la
    // base por ningún camino, y decirlo es distinto de decir que no existe.
    check("geographic_revenue_mix", "missing", [
      "geographic_revenue_mix.not_ingested",
    ]),
  ];

  return {
    version: COMPLETENESS_PROFILE_VERSION,
    latestFiscalYearEnd: latest?.fiscalYearEnd ?? null,
    checks,
  };
}

export function completenessCheck(
  profile: CompletenessProfile,
  id: CompletenessCheckId,
): CompletenessCheck {
  return profile.checks.find((candidate) => candidate.check === id)!;
}
