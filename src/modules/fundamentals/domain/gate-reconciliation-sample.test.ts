import { describe, expect, it } from "vitest";

import { DECLARED_GATE_SAMPLE } from "@/modules/fundamentals/application/declared-gate-sample";
import {
  assertGateSample,
  countByArchetype,
  GATE_ARCHETYPES,
  gateSampleEntrySchema,
  GateSampleError,
  selectBatch,
  type GateSampleEntry,
} from "@/modules/fundamentals/domain/gate-reconciliation-sample";

function entry(overrides: Partial<GateSampleEntry> = {}): GateSampleEntry {
  return gateSampleEntrySchema.parse({
    ticker: "AAPL",
    archetype: "mature_non_financial",
    batch: 1,
    decidedBy: "owner",
    decidedOn: "2026-09-21",
    rationale: "Una razón declarada con el largo mínimo que el schema exige.",
    ...overrides,
  });
}

/** Una muestra mínima sana: un representante por arquetipo, todos en la tanda 1. */
function completeSample(): GateSampleEntry[] {
  return GATE_ARCHETYPES.map((archetype, index) =>
    entry({ ticker: `T${index}`, archetype }),
  );
}

describe("assertGateSample", () => {
  it("accepts a sample that covers every archetype in the first batch", () => {
    expect(assertGateSample(completeSample())).toHaveLength(
      GATE_ARCHETYPES.length,
    );
  });

  it("refuses a repeated company", () => {
    const sample = [...completeSample(), entry({ ticker: "T0" })];

    expect(() => assertGateSample(sample)).toThrowError(
      expect.objectContaining({ reason: "duplicate_ticker" }),
    );
  });

  it("refuses a sample that leaves an archetype without a company", () => {
    const sample = completeSample().filter(
      (candidate) => candidate.archetype !== "distress",
    );

    try {
      assertGateSample(sample);
      throw new Error("expected the sample to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(GateSampleError);
      expect((error as GateSampleError).reason).toBe("archetype_not_covered");
      expect((error as GateSampleError).subjects).toEqual(["distress"]);
    }
  });

  it("refuses a first batch that does not reach every archetype", () => {
    // Medir sobre una tanda que no cubre los diez no dice nada del resto.
    const sample = completeSample().map((candidate) =>
      candidate.archetype === "bank"
        ? entry({ ...candidate, batch: 2 })
        : candidate,
    );

    expect(() => assertGateSample(sample)).toThrowError(
      expect.objectContaining({
        reason: "batch_leaves_archetype_uncovered",
        subjects: ["bank"],
      }),
    );
  });

  it("rejects a declaration without a real reason", () => {
    expect(() => entry({ rationale: "porque sí" })).toThrowError();
  });
});

describe("DECLARED_GATE_SAMPLE", () => {
  it("declares the thirty companies the Phase 2 gate asks for", () => {
    expect(DECLARED_GATE_SAMPLE).toHaveLength(30);
  });

  it("covers the ten archetypes, and says where it could not reach three", () => {
    const counts = countByArchetype(DECLARED_GATE_SAMPLE);

    expect(Object.values(counts).every((count) => count >= 2)).toBe(true);
    // El S&P 500 tiene pocos holdings puros y expulsa a las empresas en
    // distress: esos dos llegan a dos, y la diferencia se compensa donde más
    // reconciliación agrega evidencia.
    expect(counts.holding).toBe(2);
    expect(counts.distress).toBe(2);
    expect(counts.mature_non_financial).toBe(4);
    expect(counts.commodity).toBe(4);
  });

  it("reaches every archetype with the twelve companies of the first batch", () => {
    // Doce empresas, no trece: de los seis sujetos ya publicados, uno es el
    // antecesor de reporte de XOM y no una empresa aparte de la muestra.
    const first = selectBatch(DECLARED_GATE_SAMPLE, 1);

    expect(first).toHaveLength(12);
    expect(new Set(first.map((candidate) => candidate.archetype)).size).toBe(
      GATE_ARCHETYPES.length,
    );
  });

  it("keeps the already published companies in the first batch", () => {
    const first = new Set(
      selectBatch(DECLARED_GATE_SAMPLE, 1).map((candidate) => candidate.ticker),
    );

    for (const ticker of ["AAPL", "GOOGL", "DUK", "NVDA", "XOM"]) {
      expect(first.has(ticker)).toBe(true);
    }
  });
});
