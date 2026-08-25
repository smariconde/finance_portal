import { describe, expect, it } from "vitest";

import {
  buildDemoValuationRun,
  buildDemoValuationRunBeforeAmendment,
} from "../infrastructure/demo-valuation-run";
import { runValuation } from "../application/run-valuation";
import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { valuationInputSchema, type ValuationInput } from "./valuation-input";
import {
  annotateSensitivity,
  classifyFreshness,
  collectDeclaredAbsences,
  collectReportedFacts,
  FRESHNESS_POLICY_VERSION,
  listTransformations,
  resolveKnowledgeCutoff,
} from "./valuation-report";

const run = buildDemoValuationRun();

function runWith(mutate: (input: ValuationInput) => void) {
  const candidate = structuredClone(DEMO_VALUATION_INPUT);
  mutate(candidate);

  return runValuation(valuationInputSchema.parse(candidate), {
    now: () => "2026-08-24T12:00:00.000Z",
    newValuationRunId: () => "6f2a1c58-0d94-4d1b-9c3f-2b7a5e10c4ff",
  });
}

describe("freshness classification", () => {
  it("measures the gap between the measured period and the valuation date", () => {
    expect(
      classifyFreshness({
        factAsOf: "2025-06-30",
        factAvailableAt: "2025-07-15T12:00:00.000Z",
        valuationAsOf: "2025-06-30",
        knowledgeCutoff: "2025-06-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      policyVersion: FRESHNESS_POLICY_VERSION,
      coverageGapDays: 0,
      level: "current",
    });
  });

  it("separates current, aging and stale at declared thresholds", () => {
    const at = (factAsOf: string) =>
      classifyFreshness({
        factAsOf,
        factAvailableAt: "2025-01-01T00:00:00.000Z",
        valuationAsOf: "2025-06-30",
        knowledgeCutoff: "2025-06-01T00:00:00.000Z",
      }).level;

    // 180 días exactos siguen siendo `current`; 181 ya no. 365 sigue siendo
    // `aging`; 366 ya es `stale`. Los bordes se prueban, no se suponen.
    expect(at("2025-01-01")).toBe("current");
    expect(at("2024-12-31")).toBe("aging");
    expect(at("2024-06-30")).toBe("aging");
    expect(at("2024-06-29")).toBe("stale");
  });

  it("flags a fact dated after the valuation instead of calling it fresh", () => {
    expect(
      classifyFreshness({
        factAsOf: "2025-09-30",
        factAvailableAt: "2025-10-01T00:00:00.000Z",
        valuationAsOf: "2025-06-30",
        knowledgeCutoff: "2025-06-01T00:00:00.000Z",
      }),
    ).toMatchObject({ coverageGapDays: -92, level: "posterior" });
  });

  it("reports how long a fact had been knowable at the cutoff", () => {
    expect(
      classifyFreshness({
        factAsOf: "2024-12-31",
        factAvailableAt: "2025-05-01T00:00:00.000Z",
        valuationAsOf: "2025-06-30",
        knowledgeCutoff: "2025-06-01T00:00:00.000Z",
      }).knowledgeAgeDays,
    ).toBe(31);
  });
});

describe("reported facts and declared absences", () => {
  const facts = collectReportedFacts(run);

  it("lists every fact with the provenance that makes it explainable", () => {
    expect(facts.map((fact) => fact.id)).toStrictEqual([
      "baseRevenue",
      "bridge.excessCash",
      "bridge.debt",
      "dilutedShares",
    ]);

    expect(facts[0]).toMatchObject({
      unit: "monetary",
      value: "96000000",
      currency: "USD",
      asOf: "2024-12-31",
      availableAt: "2025-05-01T14:00:00.000Z",
      sourceDocumentId: "fixtureco-fy2024-annual-report-amendment",
      qualityFlags: ["restated_by_source"],
      freshness: { level: "aging", coverageGapDays: 181 },
    });
  });

  it("keeps a share count without a currency instead of inventing one", () => {
    const shares = facts.at(-1);

    expect(shares).toMatchObject({
      id: "dilutedShares",
      unit: "shares",
      currency: null,
      freshness: { level: "current", coverageGapDays: 0 },
    });
  });

  it("never lists a declared absence as a reported fact worth zero", () => {
    expect(facts.some((fact) => fact.value === "0")).toBe(false);

    expect(collectDeclaredAbsences(run)).toStrictEqual([
      {
        id: "bridge.nonOperatingAssets",
        rationale:
          "FixtureCo no reporta activos no operativos separables en FY2024.",
      },
      {
        id: "bridge.minorityInterest",
        rationale: "FixtureCo consolida sin participaciones no controlantes.",
      },
      {
        id: "bridge.otherClaims",
        rationale:
          "No hay opciones vivas ni claims preferentes declaradas en FY2024.",
      },
    ]);
  });

  it("reads facts against the knowledge cutoff the run declared", () => {
    expect(resolveKnowledgeCutoff(run)).toBe("2025-06-01T00:00:00.000Z");
    expect(resolveKnowledgeCutoff(buildDemoValuationRunBeforeAmendment())).toBe(
      "2025-03-01T00:00:00.000Z",
    );
  });

  it("shows the earlier vintage as a different fact, not a corrected one", () => {
    const earlier = collectReportedFacts(
      buildDemoValuationRunBeforeAmendment(),
    );

    expect(earlier[0]).toMatchObject({
      value: "100000000",
      sourceDocumentId: "fixtureco-fy2024-annual-report",
      qualityFlags: [],
    });
  });
});

describe("transformations", () => {
  it("lists only the reinvestment convention this run actually used", () => {
    const ids = listTransformations(run).map((step) => step.id);

    expect(ids).toContain("reinvestment_sales_to_capital");
    expect(ids).not.toContain("reinvestment_return_on_capital");
    expect(ids.at(-1)).toBe("value_per_share");
  });

  it("follows the other convention when the snapshot declares it", () => {
    const ids = listTransformations(
      runWith((input) => {
        for (const period of input.periods) {
          period.reinvestment = {
            convention: "return_on_capital",
            returnOnCapital: "0.12",
          };
        }
      }),
    ).map((step) => step.id);

    expect(ids).toContain("reinvestment_return_on_capital");
    expect(ids).not.toContain("reinvestment_sales_to_capital");
  });
});

describe("annotated sensitivity", () => {
  const grid = annotateSensitivity(run);

  it("marks exactly one base cell and measures every scenario against it", () => {
    expect(grid).not.toBeNull();
    expect(grid?.baseIsComparable).toBe(true);
    expect(grid?.baseValuePerShare).toBe(run.result?.valuePerShare);

    const cells = grid?.rows.flatMap((row) => row.cells) ?? [];
    const base = cells.filter((cell) => cell.isBase);

    expect(base).toHaveLength(1);
    expect(base[0]).toMatchObject({
      status: "computed",
      wacc: "0.09",
      terminalGrowth: "0.02",
      deltaVsBase: "0",
    });
  });

  it("moves down as the cost of capital rises and up as growth rises", () => {
    const cells = grid?.rows.flatMap((row) => row.cells) ?? [];
    const at = (wacc: string, growth: string) =>
      cells.find(
        (cell) => cell.wacc === wacc && cell.terminalGrowth === growth,
      );

    const higherWacc = at("0.11", "0.02");
    const higherGrowth = at("0.09", "0.03");

    expect(higherWacc?.status === "computed" && higherWacc.deltaVsBase).toMatch(
      /^-/u,
    );
    expect(
      higherGrowth?.status === "computed" && higherGrowth.deltaVsBase,
    ).toMatch(/^[^-]/u);
  });

  it("keeps a rejected cell visible with its reason and without a delta", () => {
    const rejected =
      grid?.rows
        .flatMap((row) => row.cells)
        .filter((cell) => cell.status === "rejected") ?? [];

    expect(rejected).toHaveLength(2);
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      reason: "terminal_growth_versus_wacc",
      wacc: "0.03",
    });
    expect(rejected.every((cell) => !("deltaVsBase" in cell))).toBe(true);
  });

  it("refuses to name a base cell when the cost of capital is not flat", () => {
    const annotated = annotateSensitivity(
      runWith((input) => {
        // La grilla reemplaza el WACC de todos los períodos: con un WACC que
        // varía, ninguna celda reproduce el caso base.
        input.periods[0].wacc = "0.1";
      }),
    );

    expect(annotated?.baseIsComparable).toBe(false);
    expect(annotated?.baseValuePerShare).toBeNull();
    expect(
      annotated?.rows.flatMap((row) => row.cells).some((cell) => cell.isBase),
    ).toBe(false);
    expect(
      annotated?.rows
        .flatMap((row) => row.cells)
        .every(
          (cell) => cell.status !== "computed" || cell.deltaVsBase === null,
        ),
    ).toBe(true);
  });

  it("returns nothing when the snapshot declares no grid", () => {
    expect(
      annotateSensitivity(
        runWith((input) => {
          input.sensitivity = null;
        }),
      ),
    ).toBeNull();
  });
});

describe("demo run determinism", () => {
  it("produces the same run, hash and value on every build", () => {
    const repeated = buildDemoValuationRun();

    expect(repeated).toStrictEqual(run);
    expect(run.status).toBe("computed");
    expect(run.result?.valuePerShare).toBe(
      "13.54613115387460161790309586190624",
    );
  });

  it("treats the earlier knowledge cutoff as another run, not a recalculation", () => {
    const earlier = buildDemoValuationRunBeforeAmendment();

    expect(earlier.inputHash).not.toBe(run.inputHash);
    expect(earlier.resultHash).not.toBe(run.resultHash);
    expect(earlier.result?.valuePerShare).toBe(
      "14.170553285286043351982391522819",
    );
  });

  it("does not open the network to render a run", async () => {
    const { vi } = await import("vitest");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    buildDemoValuationRun();
    collectReportedFacts(run);
    annotateSensitivity(run);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
