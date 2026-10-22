import type { ConceptFact } from "../domain/valuation-facts";
import {
  ZERO_DEBT_EVIDENCE_VERSION,
  ZERO_DEBT_FISCAL_YEARS,
  type CoverageFloor,
  type ZeroDebtEvidence,
} from "../domain/zero-debt-evidence";

/** El piso de la banda `Aaa/AAA` de una tabla de ratings sintética. */
export const FIXTURE_COVERAGE_FLOOR: CoverageFloor = {
  value: "8.5",
  datasetId: "damodaran.synthetic-ratings",
  releaseId: "6f1d1f4e-2a0b-4c55-8e0a-0f7d8f6a7b10",
  rowKey: "large-nonfinancial-aaa",
  availableAt: "2026-01-10T12:00:00.000Z",
};

function fact(value: string, concept: string, asOf: string): ConceptFact {
  return {
    value,
    currency: "USD",
    unit: "monetary",
    asOf,
    availableAt: `${Number(asOf.slice(0, 4)) + 1}-02-15T21:00:00.000Z`,
    sourceId: "sec-edgar",
    sourceDocumentId: "0000000000-26-000001",
    observationId: null,
    qualityFlags: [],
    concept: `us-gaap:${concept}`,
  };
}

/**
 * Una evidencia de deuda cero sintética: cinco ejercicios anuales desde
 * `baseFiscalYearEnd` con ventas y sin préstamos. Con `interest`, el ejercicio
 * base paga ese monto contra un EBIT de 300.
 */
export function zeroDebtEvidenceFixture(
  baseFiscalYearEnd: string,
  options: { interest?: string; floor?: CoverageFloor } = {},
): ZeroDebtEvidence {
  const baseYear = Number(baseFiscalYearEnd.slice(0, 4));

  return {
    version: ZERO_DEBT_EVIDENCE_VERSION,
    coverageFloor: options.floor ?? FIXTURE_COVERAGE_FLOOR,
    fiscalYears: Array.from({ length: ZERO_DEBT_FISCAL_YEARS }, (_, index) => {
      const end = `${baseYear - index}${baseFiscalYearEnd.slice(4)}`;
      const charged = index === 0 && options.interest !== undefined;

      return {
        fiscalYearEnd: end,
        revenue: fact("10000", "Revenues", end),
        reportedAtZero: [],
        interest: charged
          ? {
              basis: "gross" as const,
              facts: [fact(options.interest!, "InterestExpense", end)],
            }
          : null,
        ebit: charged
          ? {
              basis: "operating_income" as const,
              fact: fact("300", "OperatingIncomeLoss", end),
            }
          : null,
      };
    }),
  };
}
