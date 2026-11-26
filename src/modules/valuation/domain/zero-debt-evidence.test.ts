import { describe, expect, it } from "vitest";

import {
  LINE_ITEMS,
  type AnnualFundamentals,
  type LineItemId,
  type LineItemValue,
} from "./annual-fundamentals";
import type { ConceptFact } from "./valuation-facts";
import {
  assessZeroDebtEvidence,
  listZeroDebtEvidenceFacts,
  LOSS_YEAR_INTEREST_RULE_VERSION,
  ZERO_DEBT_EVIDENCE_SHORT_HISTORY_VERSION,
  ZERO_DEBT_EVIDENCE_VERSION,
  zeroDebtEvidenceHasInterest,
  zeroDebtEvidenceSchema,
  zeroDebtEvidenceMismatches,
  zeroDebtShortfall,
  type CoverageFloor,
  type ZeroDebtEvidence,
} from "./zero-debt-evidence";

const ENDS = [
  "2025-12-31",
  "2024-12-31",
  "2023-12-31",
  "2022-12-31",
  "2021-12-31",
];

const FLOOR: CoverageFloor = {
  value: "8.5",
  datasetId: "damodaran.synthetic-ratings",
  releaseId: "6f1d1f4e-2a0b-4c55-8e0a-0f7d8f6a7b10",
  rowKey: "large-nonfinancial-aaa",
  availableAt: "2026-01-10T12:00:00.000Z",
};

let sequence = 0;

function line(item: LineItemId, value: string, asOf: string): LineItemValue {
  sequence += 1;
  return {
    item,
    concept: LINE_ITEMS.find((definition) => definition.item === item)!
      .concepts[0]!,
    value,
    unit: "USD",
    currency: "USD",
    asOf,
    observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    availableAt: `${Number(asOf.slice(0, 4)) + 1}-02-01T21:00:00.000Z`,
    recordedAt: `${Number(asOf.slice(0, 4)) + 1}-02-02T00:00:00.000Z`,
    sourceDocumentId: "0000000000-26-000001",
  };
}

/** Cinco ejercicios con ventas 1.000 y EBIT 300; `extra` agrega partidas por año. */
function series(
  extra: (
    end: string,
    index: number,
  ) => Partial<Record<LineItemId, string>> = () => ({}),
  years = ENDS,
): AnnualFundamentals {
  return {
    version: "annual-fundamentals-1.11.0",
    fiscalYears: years.map((end, index) => {
      const items: Partial<Record<LineItemId, string>> = {
        revenue: "1000",
        operating_income: "300",
        ...extra(end, index),
      };
      return {
        fiscalYearEnd: end,
        items: Object.fromEntries(
          Object.entries(items).map(([id, value]) => [
            id,
            line(id as LineItemId, value, end),
          ]),
        ),
      };
    }),
  };
}

function withoutOperatingIncome(
  items: AnnualFundamentals["fiscalYears"][number]["items"],
) {
  return Object.fromEntries(
    Object.entries(items).filter(([id]) => id !== "operating_income"),
  );
}

function toFact(item: LineItemValue): ConceptFact {
  return {
    value: item.value,
    currency: "USD",
    unit: "monetary",
    asOf: item.asOf,
    availableAt: item.availableAt,
    sourceId: "sec-edgar",
    sourceDocumentId: item.sourceDocumentId,
    observationId: item.observationId,
    qualityFlags: [],
    concept: item.concept,
  };
}

function met(input: AnnualFundamentals): ZeroDebtEvidence {
  const result = assessZeroDebtEvidence(input, FLOOR, toFact);
  if (result.status !== "met") throw new Error(result.reason);
  return result.evidence;
}

describe(ZERO_DEBT_EVIDENCE_VERSION, () => {
  it("holds with no borrowing and no interest in five fiscal years (Intuitive Surgical)", () => {
    const evidence = met(series());

    expect(evidence.fiscalYears.map((year) => year.fiscalYearEnd)).toEqual(
      ENDS,
    );
    expect(evidence.fiscalYears.every((year) => year.interest === null)).toBe(
      true,
    );
    expect(zeroDebtEvidenceHasInterest(evidence)).toBe(false);
    expect(zeroDebtShortfall(evidence)).toBeNull();
    expect(zeroDebtEvidenceMismatches(evidence, ENDS[0]!, "e")).toEqual([]);
  });

  it("accepts interest whose coverage is in the top rating band (Deckers' undrawn facility)", () => {
    const evidence = met(
      series((_, index) => (index === 0 ? { interest_expense: "2.5" } : {})),
    );

    expect(zeroDebtEvidenceHasInterest(evidence)).toBe(true);
    expect(evidence.fiscalYears[0]?.ebit).toMatchObject({
      basis: "operating_income",
    });
  });

  it("measures interest against a derived EBIT when operating income is missing", () => {
    const input = series((_, index) =>
      index === 2 ? { interest_expense: "20" } : {},
    );
    const year = input.fiscalYears[2]!;
    const rest = withoutOperatingIncome(year.items);
    const derived = {
      ...input,
      fiscalYears: input.fiscalYears.map((candidate, index) =>
        index === 2
          ? {
              ...candidate,
              items: {
                ...rest,
                pretax_income: line("pretax_income", "280", year.fiscalYearEnd),
              },
            }
          : candidate,
      ),
    };

    const evidence = met(derived);

    // 280 + 20 = 300 de EBIT contra 20 de intereses: 15 veces, sobre el piso.
    expect(evidence.fiscalYears[2]?.ebit).toMatchObject({
      basis: "pretax_plus_interest",
    });
  });

  it("rejects interest below the top band: that is debt being serviced", () => {
    expect(
      assessZeroDebtEvidence(
        series((_, index) => (index === 3 ? { interest_expense: "40" } : {})),
        FLOOR,
        toFact,
      ),
    ).toEqual({ status: "not_met", reason: "interest_material" });
  });

  it("measures a loss year's interest against revenue (PLTR, loss-year-interest-1.0.0)", () => {
    // PLTR 2021–2022: EBIT -411 M y -161 M, intereses de 3,6 M y 4,1 M sobre
    // ventas de 1.542 M y 1.906 M (0,23 % y 0,22 %); 2023 con EBIT 120 M.
    const pltr = series((_, index) =>
      index === 4
        ? { operating_income: "-411", interest_expense: "3.6", revenue: "1542" }
        : index === 3
          ? {
              operating_income: "-161",
              interest_expense: "4.1",
              revenue: "1906",
            }
          : index === 2
            ? { operating_income: "120", interest_expense: "3.5" }
            : {},
    );
    const evidence = met(pltr);

    expect(evidence.version).toBe(ZERO_DEBT_EVIDENCE_VERSION);
    expect(evidence.lossYearInterest).toEqual({
      version: LOSS_YEAR_INTEREST_RULE_VERSION,
      ceiling: "0.005",
    });
    expect(zeroDebtShortfall(evidence)).toBeNull();
  });

  it("still rejects a loss year whose interest exceeds 0.5 % of revenue", () => {
    expect(
      assessZeroDebtEvidence(
        series((_, index) =>
          index === 1
            ? { operating_income: "-50", interest_expense: "5.01" }
            : {},
        ),
        FLOOR,
        toFact,
      ),
    ).toEqual({ status: "not_met", reason: "interest_material" });
    expect(
      met(
        series((_, index) =>
          index === 1 ? { operating_income: "0", interest_expense: "5" } : {},
        ),
      ).lossYearInterest,
    ).toBeDefined();
  });

  it("does not freeze the loss-year rule when no year uses it", () => {
    expect(
      met(
        series((_, index) => (index === 0 ? { interest_expense: "2.5" } : {})),
      ),
    ).not.toHaveProperty("lossYearInterest");
  });

  it("reads a stored evidence without the rule as coverage only", () => {
    const evidence = met(
      series((_, index) =>
        index === 1 ? { operating_income: "-50", interest_expense: "1" } : {},
      ),
    );
    const stored: ZeroDebtEvidence = { ...evidence };
    delete stored.lossYearInterest;

    expect(evidence.lossYearInterest).toBeDefined();
    expect(zeroDebtShortfall(stored)).toBe("interest_material");
  });

  it("rejects a scheduled maturity even with no recipe component (D.R. Horton)", () => {
    expect(
      assessZeroDebtEvidence(
        series((_, index) =>
          index === 0
            ? {
                debt_maturity_year_five: "0",
                debt_maturity_after_year_five: "2400",
              }
            : {},
        ),
        FLOOR,
        toFact,
      ),
    ).toEqual({ status: "not_met", reason: "borrowing_reported" });
  });

  it("rejects a borrowing reported in an earlier year of the window", () => {
    expect(
      assessZeroDebtEvidence(
        series((_, index) =>
          index === 4 ? { debt_long_term_noncurrent: "590" } : {},
        ),
        FLOOR,
        toFact,
      ),
    ).toEqual({ status: "not_met", reason: "borrowing_reported" });
  });

  it("keeps a borrowing reported at zero as evidence, not as debt", () => {
    const evidence = met(
      series((_, index) => (index === 4 ? { short_term_borrowings: "0" } : {})),
    );

    expect(
      evidence.fiscalYears[4]?.reportedAtZero.map((fact) => fact.concept),
    ).toEqual(["us-gaap:ShortTermBorrowings"]);
  });

  it("does not count finance leases as borrowings: they are the debt", () => {
    expect(
      assessZeroDebtEvidence(
        series(() => ({ finance_lease_liability: "112" })),
        FLOOR,
        toFact,
      ).status,
    ).toBe("met");
  });

  it("freezes five fiscal years as 1.0.0, byte for byte", () => {
    expect(met(series()).version).toBe(ZERO_DEBT_EVIDENCE_VERSION);
  });

  // RDDT, 2026-11-18: cuatro ejercicios desde su salida a bolsa.
  it("proves a young company with all its fiscal years, three or four (1.1.0)", () => {
    for (const count of [4, 3]) {
      const evidence = met(series(() => ({}), ENDS.slice(0, count)));

      expect(evidence.version).toBe(ZERO_DEBT_EVIDENCE_SHORT_HISTORY_VERSION);
      expect(evidence.fiscalYears).toHaveLength(count);
      expect(zeroDebtEvidenceMismatches(evidence, ENDS[0]!, "e")).toEqual([]);
    }
  });

  it("needs at least three fiscal years with revenue", () => {
    expect(
      assessZeroDebtEvidence(
        series(() => ({}), ENDS.slice(0, 2)),
        FLOOR,
        toFact,
      ),
    ).toEqual({ status: "not_met", reason: "insufficient_history" });
  });

  it("refuses a stored 1.0.0 evidence with fewer than five years", () => {
    const evidence = met(series(() => ({}), ENDS.slice(0, 4)));

    expect(() =>
      zeroDebtEvidenceSchema.parse({
        ...evidence,
        version: ZERO_DEBT_EVIDENCE_VERSION,
      }),
    ).toThrow();
  });

  it("needs EBIT to measure interest", () => {
    const input = series((_, index) =>
      index === 1 ? { interest_expense: "1" } : {},
    );
    const rest = withoutOperatingIncome(input.fiscalYears[1]!.items);
    const withoutEbit = {
      ...input,
      fiscalYears: input.fiscalYears.map((year, index) =>
        index === 1 ? { ...year, items: rest } : year,
      ),
    };

    expect(assessZeroDebtEvidence(withoutEbit, FLOOR, toFact)).toEqual({
      status: "not_met",
      reason: "interest_without_ebit",
    });
  });

  it("needs a rating table at the cutoff", () => {
    expect(assessZeroDebtEvidence(series(), null, toFact)).toEqual({
      status: "not_met",
      reason: "coverage_floor_unavailable",
    });
  });

  it("recomputes a stored evidence and names what was tampered with", () => {
    const evidence = met(
      series((_, index) => (index === 0 ? { interest_expense: "2.5" } : {})),
    );
    const raised = structuredClone(evidence);
    raised.fiscalYears[0]!.interest!.facts[0]!.value = "200";
    const shifted = structuredClone(evidence);
    shifted.fiscalYears[1]!.revenue.asOf = ENDS[0]!;
    const borrowed = structuredClone(evidence);
    borrowed.fiscalYears[2]!.reportedAtZero.push({
      ...borrowed.fiscalYears[2]!.revenue,
      concept: "us-gaap:LineOfCredit",
    });

    expect(zeroDebtEvidenceMismatches(raised, ENDS[0]!, "e")).toEqual(["e"]);
    expect(zeroDebtEvidenceMismatches(shifted, ENDS[0]!, "e")).toEqual([
      "e.fiscalYears.1.revenue",
    ]);
    expect(zeroDebtEvidenceMismatches(borrowed, ENDS[0]!, "e")).toEqual(["e"]);
    expect(zeroDebtEvidenceMismatches(evidence, ENDS[1]!, "e")).toEqual([
      "e.fiscalYears.0",
    ]);
  });

  it("lists every fact it read with the close it must have", () => {
    const evidence = met(
      series((_, index) => (index === 0 ? { interest_expense: "2.5" } : {})),
    );
    const paths = listZeroDebtEvidenceFacts(evidence, "e").map(
      (entry) => entry.path,
    );

    expect(paths).toContain("e.fiscalYears.0.interest.facts.0");
    expect(paths).toContain("e.fiscalYears.0.ebit.fact");
    expect(paths.filter((path) => path.endsWith(".revenue"))).toHaveLength(5);
  });
});
