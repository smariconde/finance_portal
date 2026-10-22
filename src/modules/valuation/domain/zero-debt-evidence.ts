import { z } from "zod";

import { utcTimestampSchema } from "@/modules/temporal/domain/temporal-version";
import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

import {
  DEBT_GUARD_ITEMS,
  type AnnualFundamentals,
  type LineItemId,
  type LineItemValue,
} from "./annual-fundamentals";
import {
  divide,
  engineDecimalSchema,
  parseDecimal,
  ZERO,
  type Dec,
} from "./decimal-policy";
import {
  ebitWithInterest,
  freezeInterest,
  frozenInterestSchema,
  frozenInterestValue,
  interestExpenseOf,
} from "./interest-expense";
import { conceptFactSchema, type ConceptFact } from "./valuation-facts";

/**
 * Deuda cero con evidencia (`F6-15`,
 * [ADR 0054](../../../../docs/architecture/adr/0054-zero-debt-evidence-derived-ebit.md)).
 *
 * Que no se publique deuda no prueba que no haya (`TM-05`): D.R. Horton no
 * publica ningún componente de la receta y debe unos 5.000 M. Pero Intuitive
 * Surgical o Align no tienen deuda financiera, y sin esta regla no se valúan.
 * La evidencia son los **cinco ejercicios** más recientes de la serie, cada uno
 * con ventas, y en todos:
 *
 * - ningún componente de préstamos ni partida de la guardia (`1.4.0` de la
 *   serie: cronograma de vencimientos, pagarés, línea de crédito usada) con un
 *   monto distinto de cero. Los arrendamientos financieros no cuentan: son
 *   deuda, y la receta los toma como tal (`finance_leases_only`);
 * - gasto de intereses nulo, ausente o con una cobertura `EBIT / intereses` en
 *   la banda más alta de la tabla de rating sintético de la corrida: son las
 *   comisiones de una línea sin usar o los intereses de los arrendamientos, no
 *   el servicio de una deuda material.
 *
 * Lo que se congela son los hechos que la regla leyó, con su provenance; la
 * ausencia de las demás partidas es lo que la serie no tenía al corte, con la
 * selección que la corrida registra. El monto de los intereses y del EBIT se
 * recalcula siempre desde los hechos.
 */
export const ZERO_DEBT_EVIDENCE_VERSION = "zero-debt-evidence-1.0.0";

/** Ejercicios que la evidencia exige: la ventana de la ADR 0017. */
export const ZERO_DEBT_FISCAL_YEARS = 5;

/** Los componentes de préstamos de la serie, viejos y nuevos. */
const BORROWING_ITEMS: readonly LineItemId[] = [
  "long_term_debt",
  "debt_current",
  "short_term_borrowings",
  "debt_long_term_total",
  "debt_long_term_noncurrent",
  "debt_long_term_current",
  "debt_current_total",
  "debt_short_term_borrowings",
  "debt_commercial_paper",
];

const amount = engineDecimalSchema;

/** El piso de la banda más alta, con la release y la fila de donde salió. */
export const coverageFloorSchema = z.object({
  value: amount,
  datasetId: z.string().max(64),
  releaseId: z.uuid(),
  rowKey: z.string().max(128),
  availableAt: utcTimestampSchema,
});

export type CoverageFloor = z.infer<typeof coverageFloorSchema>;

export const frozenEbitSchema = z.discriminatedUnion("basis", [
  z.object({ basis: z.literal("operating_income"), fact: conceptFactSchema }),
  z.object({
    basis: z.literal("pretax_plus_interest"),
    pretaxIncome: conceptFactSchema,
    interest: frozenInterestSchema,
  }),
]);

export type FrozenEbit = z.infer<typeof frozenEbitSchema>;

export const zeroDebtEvidenceSchema = z.object({
  version: z.literal(ZERO_DEBT_EVIDENCE_VERSION),
  coverageFloor: coverageFloorSchema,
  /** Del ejercicio base hacia atrás. */
  fiscalYears: z
    .array(
      z.object({
        fiscalYearEnd: calendarDateSchema,
        /** Las ventas prueban que el ejercicio está en la serie. */
        revenue: conceptFactSchema,
        /** Componentes o partidas de la guardia publicados en cero. */
        reportedAtZero: z.array(conceptFactSchema).max(24),
        /** `null`: ninguna base de `interest-expense-1.0.0` cerró. */
        interest: frozenInterestSchema.nullable(),
        /** Sólo cuando hay intereses que medir contra el piso. */
        ebit: frozenEbitSchema.nullable(),
      }),
    )
    .length(ZERO_DEBT_FISCAL_YEARS),
});

export type ZeroDebtEvidence = z.infer<typeof zeroDebtEvidenceSchema>;

export const zeroDebtShortfallSchema = z.enum([
  /** Menos de cinco ejercicios con ventas. */
  "insufficient_history",
  /** Un componente de préstamos o una partida de la guardia distinta de cero. */
  "borrowing_reported",
  /** Intereses sin EBIT con qué medirlos. */
  "interest_without_ebit",
  /** Una cobertura por debajo de la banda más alta. */
  "interest_material",
  /** Sin tabla de ratings al corte no hay piso. */
  "coverage_floor_unavailable",
]);

export type ZeroDebtShortfall = z.infer<typeof zeroDebtShortfallSchema>;

export type ZeroDebtAssessment =
  | { readonly status: "met"; readonly evidence: ZeroDebtEvidence }
  | { readonly status: "not_met"; readonly reason: ZeroDebtShortfall };

function frozenEbitValue(ebit: FrozenEbit): Dec {
  return ebit.basis === "operating_income"
    ? parseDecimal(ebit.fact.value, "ebit.fact")
    : parseDecimal(ebit.pretaxIncome.value, "ebit.pretaxIncome").plus(
        frozenInterestValue(ebit.interest),
      );
}

/**
 * Qué falla de una evidencia congelada, o `null` si sostiene la deuda cero.
 * Pura: es lo que el motor recalcula desde el snapshot.
 */
export function zeroDebtShortfall(
  evidence: ZeroDebtEvidence,
): ZeroDebtShortfall | null {
  const floor = parseDecimal(evidence.coverageFloor.value, "coverageFloor");

  for (const year of evidence.fiscalYears) {
    if (
      year.reportedAtZero.some(
        (fact) => !parseDecimal(fact.value, "reportedAtZero").isZero(),
      )
    ) {
      return "borrowing_reported";
    }

    const interest =
      year.interest === null ? ZERO : frozenInterestValue(year.interest);

    if (!interest.greaterThan(ZERO)) {
      continue;
    }

    if (year.ebit === null) {
      return "interest_without_ebit";
    }

    if (
      divide(frozenEbitValue(year.ebit), interest, "coverage").lessThan(floor)
    ) {
      return "interest_material";
    }
  }

  return null;
}

/** ¿Algún ejercicio de la evidencia tiene un gasto de intereses? */
export function zeroDebtEvidenceHasInterest(
  evidence: ZeroDebtEvidence,
): boolean {
  return evidence.fiscalYears.some(
    (year) =>
      year.interest !== null &&
      frozenInterestValue(year.interest).greaterThan(ZERO),
  );
}

/**
 * Arma y evalúa la evidencia desde la serie al corte. `toFact` le pone la
 * provenance de la fuente a cada partida.
 */
export function assessZeroDebtEvidence(
  series: AnnualFundamentals,
  coverageFloor: CoverageFloor | null,
  toFact: (item: LineItemValue) => ConceptFact,
): ZeroDebtAssessment {
  const years = series.fiscalYears.slice(0, ZERO_DEBT_FISCAL_YEARS);

  if (
    years.length < ZERO_DEBT_FISCAL_YEARS ||
    years.some((year) => year.items.revenue === undefined)
  ) {
    return { status: "not_met", reason: "insufficient_history" };
  }

  const fiscalYears = years.map((year) => {
    const seen = new Set<string>();
    const reported = [...BORROWING_ITEMS, ...DEBT_GUARD_ITEMS]
      .map((id) => year.items[id])
      .filter((line): line is LineItemValue => {
        if (line === undefined || seen.has(line.observationId)) return false;
        seen.add(line.observationId);
        return true;
      });
    const interest = interestExpenseOf(year);
    const charged = interest !== null && interest.value.greaterThan(ZERO);
    const ebit = charged ? ebitWithInterest(year) : null;

    return {
      fiscalYearEnd: year.fiscalYearEnd,
      revenue: toFact(year.items.revenue!),
      reportedAtZero: reported.map(toFact),
      interest: interest === null ? null : freezeInterest(interest, toFact),
      ebit:
        ebit === null
          ? null
          : ebit.ebit.basis === "operating_income"
            ? {
                basis: "operating_income" as const,
                fact: toFact(ebit.ebit.inputs[0]!),
              }
            : {
                basis: "pretax_plus_interest" as const,
                pretaxIncome: toFact(ebit.ebit.inputs[0]!),
                interest: freezeInterest(ebit.interest!, toFact),
              },
    };
  });

  if (
    fiscalYears.some((year) =>
      year.reportedAtZero.some(
        (fact) => !parseDecimal(fact.value, "reportedAtZero").isZero(),
      ),
    )
  ) {
    return { status: "not_met", reason: "borrowing_reported" };
  }

  if (coverageFloor === null) {
    return { status: "not_met", reason: "coverage_floor_unavailable" };
  }

  const evidence = zeroDebtEvidenceSchema.parse({
    version: ZERO_DEBT_EVIDENCE_VERSION,
    coverageFloor,
    fiscalYears,
  });
  const reason = zeroDebtShortfall(evidence);

  return reason === null
    ? { status: "met", evidence }
    : { status: "not_met", reason };
}

/** Los hechos de la evidencia con su ruta y el cierre que deben tener. */
export function listZeroDebtEvidenceFacts(
  evidence: ZeroDebtEvidence,
  prefix: string,
): readonly { path: string; fact: ConceptFact; asOf: string }[] {
  return evidence.fiscalYears.flatMap((year, index) => {
    const at = `${prefix}.fiscalYears.${index}`;
    const asOf = year.fiscalYearEnd;
    const ebit = year.ebit;

    return [
      { path: `${at}.revenue`, fact: year.revenue, asOf },
      ...year.reportedAtZero.map((fact, factIndex) => ({
        path: `${at}.reportedAtZero.${factIndex}`,
        fact,
        asOf,
      })),
      ...(year.interest?.facts ?? []).map((fact, factIndex) => ({
        path: `${at}.interest.facts.${factIndex}`,
        fact,
        asOf,
      })),
      ...(ebit === null
        ? []
        : ebit.basis === "operating_income"
          ? [{ path: `${at}.ebit.fact`, fact: ebit.fact, asOf }]
          : [
              {
                path: `${at}.ebit.pretaxIncome`,
                fact: ebit.pretaxIncome,
                asOf,
              },
              ...ebit.interest.facts.map((fact, factIndex) => ({
                path: `${at}.ebit.interest.facts.${factIndex}`,
                fact,
                asOf,
              })),
            ]),
    ];
  });
}

/**
 * Lo que no cierra de una evidencia guardada, como rutas: el ejercicio base,
 * el orden, el cierre de cada hecho y la regla misma.
 */
export function zeroDebtEvidenceMismatches(
  evidence: ZeroDebtEvidence,
  baseFiscalYearEnd: string,
  prefix: string,
): string[] {
  const mismatches: string[] = [];

  if (evidence.fiscalYears[0]?.fiscalYearEnd !== baseFiscalYearEnd) {
    mismatches.push(`${prefix}.fiscalYears.0`);
  }

  evidence.fiscalYears.forEach((year, index) => {
    const previous = evidence.fiscalYears[index - 1];
    if (
      previous !== undefined &&
      year.fiscalYearEnd >= previous.fiscalYearEnd
    ) {
      mismatches.push(`${prefix}.fiscalYears.${index}`);
    }
  });

  for (const entry of listZeroDebtEvidenceFacts(evidence, prefix)) {
    if (entry.fact.asOf !== entry.asOf) {
      mismatches.push(entry.path);
    }
  }

  if (zeroDebtShortfall(evidence) !== null) {
    mismatches.push(prefix);
  }

  return mismatches;
}
