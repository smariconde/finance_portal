import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

/**
 * Qué cambió entre dos corridas del mismo ticker (`F6-02`,
 * [ADR 0047](../../../../docs/architecture/adr/0047-valuation-run-history.md)).
 *
 * Compara los snapshots sección por sección con su hash canónico. Nunca
 * compara valores del resultado: lo que el historial dice es por qué la
 * corrida nueva es otra, no cuánto vale. Pura y sin reloj.
 *
 * El corte —`knowledge` y `asOf`— cambia en cada pedido, así que va aparte: un
 * refresco que sólo movió el corte es «sin cambios en los datos».
 */
export const VALUATION_RUN_COMPARISON_VERSION =
  "valuation-run-comparison-1.0.0";

/** Secciones con nombre estable, en el orden en que se muestran. */
export const COMPARISON_SECTIONS = [
  "baseRevenue",
  "normalization",
  "capitalization",
  "costOfCapital",
  "qualitativeDecisions",
  "assessment",
  "failureRisk",
  "employeeEquity",
  "bridge",
  "assumptions",
  "versions",
  "subject",
] as const;

export type ComparisonSection = (typeof COMPARISON_SECTIONS)[number];

/** A qué sección pertenece cada clave del snapshot. */
const SECTION_OF_KEY: Readonly<Record<string, ComparisonSection | "cutoff">> = {
  asOf: "cutoff",
  knowledge: "cutoff",
  baseRevenue: "baseRevenue",
  normalization: "normalization",
  capitalization: "capitalization",
  costOfCapital: "costOfCapital",
  currency: "costOfCapital",
  qualitativeDecisions: "qualitativeDecisions",
  assessment: "assessment",
  assetProfile: "assessment",
  method: "assessment",
  failureRisk: "failureRisk",
  employeeEquity: "employeeEquity",
  bridge: "bridge",
  periods: "assumptions",
  terminal: "assumptions",
  sensitivity: "assumptions",
  scenarios: "assumptions",
  derivedAssumptions: "assumptions",
  reinvestmentConventionBridge: "assumptions",
  cycleNormalization: "assumptions",
  revenueMargin: "assumptions",
  engineVersion: "versions",
  methodologyVersion: "versions",
  decimalPolicy: "versions",
  subject: "subject",
};

export type ValuationRunComparison =
  | { readonly kind: "same_run" }
  | {
      readonly kind: "changed";
      readonly cutoffChanged: boolean;
      /** Vacío: sólo cambió el corte. */
      readonly sections: readonly ComparisonSection[];
    };

/**
 * Una clave que el snapshot no declara en la tabla es una sección propia que
 * no se sabe nombrar: se reporta como `versions`, porque sólo una versión
 * nueva del snapshot agrega claves.
 */
function sectionOf(key: string): ComparisonSection | "cutoff" {
  return SECTION_OF_KEY[key] ?? "versions";
}

export function compareValuationRuns(
  previous: { readonly inputHash: string; readonly input: object },
  current: { readonly inputHash: string; readonly input: object },
): ValuationRunComparison {
  if (previous.inputHash === current.inputHash) {
    return { kind: "same_run" };
  }

  const left = previous.input as Record<string, unknown>;
  const right = current.input as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changed = new Set<ComparisonSection | "cutoff">();

  for (const key of keys) {
    const before = key in left ? computeContentHash(left[key] ?? null) : null;
    const after = key in right ? computeContentHash(right[key] ?? null) : null;

    if (before !== after) {
      changed.add(sectionOf(key));
    }
  }

  return {
    kind: "changed",
    cutoffChanged: changed.has("cutoff"),
    sections: COMPARISON_SECTIONS.filter((section) => changed.has(section)),
  };
}
