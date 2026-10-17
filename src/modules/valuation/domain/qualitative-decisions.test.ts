import { describe, expect, it } from "vitest";

import { runValuation } from "../application/run-valuation";
import {
  DEMO_AI_COST_OF_CAPITAL,
  DEMO_AI_QUALITATIVE_DECISIONS,
  DEMO_AI_RESOLUTION_ID,
  DEMO_AI_VALUATION_INPUT,
} from "../infrastructure/demo-ai-valuation-fixtures";
import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";

import { mapIndustry } from "./industry-mapping";
import type { OperationsMixProposal } from "./operations-mix";
import {
  industryDecisionOf,
  industryDecisionSchema,
  operationsMixDecisionOfDeclaration,
  operationsMixDecisionOfProposal,
  operationsMixDecisionSchema,
  operationsMixReadingOf,
  qualitativeDecisionMismatches,
  type QualitativeDecisions,
} from "./qualitative-decisions";
import {
  computeValuationInputHash,
  type ValuationInput,
} from "./valuation-input";

const AI_MIX = DEMO_AI_QUALITATIVE_DECISIONS.operationsMix!;
const AI_INDUSTRY = DEMO_AI_QUALITATIVE_DECISIONS.industry!;

if (AI_MIX.source !== "ai_proposal" || AI_INDUSTRY.basis !== "ai_resolution") {
  throw new Error("the AI fixture carries AI decisions");
}

function run(input: ValuationInput) {
  return runValuation(input, {
    now: () => "2026-10-16T12:00:00.000Z",
    newValuationRunId: () => "6f2a1c58-0d94-4d1b-9c3f-2b7a5e10c4ff",
  });
}

function withDecisions(decisions: QualitativeDecisions): ValuationInput {
  return { ...DEMO_AI_VALUATION_INPUT, qualitativeDecisions: decisions };
}

describe("qualitative decisions", () => {
  it("derives the operations weights from the transcribed lines", () => {
    expect(operationsMixReadingOf(AI_MIX)).toEqual({
      source: "ai_proposal",
      proposalId: AI_MIX.proposal.proposalId,
      weightsVersion: "operations-mix-weights-1.0.0",
      exposures: [
        {
          exposureKeys: ["united-states"],
          basis: "name_match",
          weight: "0.7",
        },
        { exposureKeys: [], basis: "rest_of_world", weight: "0.3" },
      ],
    });
  });

  it("values a snapshot whose AI decisions explain its cost of capital", () => {
    expect(
      qualitativeDecisionMismatches(
        DEMO_AI_QUALITATIVE_DECISIONS,
        DEMO_AI_COST_OF_CAPITAL,
      ),
    ).toEqual([]);

    const aiRun = run(DEMO_AI_VALUATION_INPUT);
    const reference = run(DEMO_VALUATION_INPUT);

    expect(aiRun.status).toBe("computed");
    expect(aiRun.result?.checks).toContainEqual(
      expect.objectContaining({
        id: "qualitative_decisions_drive_cost_of_capital",
        status: "passed",
      }),
    );
    // Mismo WACC, mismo valor; otro snapshot, otro hash.
    expect(aiRun.result?.valuePerShare).toBe(reference.result?.valuePerShare);
    expect(aiRun.inputHash).not.toBe(reference.inputHash);
  });

  it("rejects a line whose amount does not come from its printed figure", () => {
    const lines = AI_MIX.lines.map((line, index) =>
      index === 0 ? { ...line, amount: "800000" } : line,
    );
    const outcome = run(
      withDecisions({
        ...DEMO_AI_QUALITATIVE_DECISIONS,
        operationsMix: { ...AI_MIX, lines },
      }),
    );

    expect(outcome.status).toBe("rejected");
    expect(outcome.failure).toMatchObject({
      code: "policy_check_failed",
      subjects: ["qualitativeDecisions.operationsMix.lines.0"],
    });
  });

  it("rejects a printed figure that is not in its quote", () => {
    const lines = AI_MIX.lines.map((line, index) =>
      index === 1 ? { ...line, quote: "Rest of world 299,000" } : line,
    );

    expect(
      qualitativeDecisionMismatches(
        {
          ...DEMO_AI_QUALITATIVE_DECISIONS,
          operationsMix: { ...AI_MIX, lines },
        },
        DEMO_AI_COST_OF_CAPITAL,
      ),
    ).toEqual(["qualitativeDecisions.operationsMix.lines.1"]);
  });

  it("rejects weights that are not the ones the lines derive", () => {
    const exposure = DEMO_AI_COST_OF_CAPITAL.operationsExposure!;
    const tampered = {
      ...DEMO_AI_COST_OF_CAPITAL,
      operationsExposure: {
        ...exposure,
        exposures: [
          { ...exposure.exposures[0]!, weight: "0.6" },
          { ...exposure.exposures[1]!, weight: "0.4" },
        ],
      },
    };

    expect(
      qualitativeDecisionMismatches(DEMO_AI_QUALITATIVE_DECISIONS, tampered),
    ).toEqual(["costOfCapital.operationsExposure"]);
  });

  it("rejects an exposure from another proposal", () => {
    const tampered = {
      ...DEMO_AI_COST_OF_CAPITAL,
      operationsExposure: {
        ...DEMO_AI_COST_OF_CAPITAL.operationsExposure!,
        proposalId: "00000000-0000-4000-8000-0000000000ff",
      },
    };

    expect(
      qualitativeDecisionMismatches(DEMO_AI_QUALITATIVE_DECISIONS, tampered),
    ).toEqual(["costOfCapital.operationsExposure"]);
  });

  it("rejects a mix on one side only", () => {
    expect(
      qualitativeDecisionMismatches(
        { ...DEMO_AI_QUALITATIVE_DECISIONS, operationsMix: null },
        DEMO_AI_COST_OF_CAPITAL,
      ),
    ).toEqual([
      "qualitativeDecisions.operationsMix",
      "costOfCapital.operationsExposure",
    ]);
    expect(
      qualitativeDecisionMismatches(DEMO_AI_QUALITATIVE_DECISIONS, {
        ...DEMO_AI_COST_OF_CAPITAL,
        operationsExposure: null,
      }),
    ).toEqual([
      "qualitativeDecisions.operationsMix",
      "costOfCapital.operationsExposure",
    ]);
  });

  it("rejects an industry other than the cost of capital's", () => {
    const outcome = run(
      withDecisions({
        ...DEMO_AI_QUALITATIVE_DECISIONS,
        industry: { ...AI_INDUSTRY, industryKey: "telecom-equipment" },
      }),
    );

    expect(outcome.failure?.subjects).toEqual([
      "qualitativeDecisions.industry.industryKey",
    ]);
  });

  it("rejects candidates the SIC table does not name, and another mapping version", () => {
    expect(
      qualitativeDecisionMismatches(
        {
          ...DEMO_AI_QUALITATIVE_DECISIONS,
          industry: {
            ...AI_INDUSTRY,
            mappingVersion: "sic-damodaran-industry-1.0.0",
            candidates: ["computers-peripherals", "semiconductor"],
          },
        },
        DEMO_AI_COST_OF_CAPITAL,
      ),
    ).toEqual([
      "qualitativeDecisions.industry.mappingVersion",
      "qualitativeDecisions.industry.candidates",
    ]);
  });

  it("rejects a run without an industry decision", () => {
    expect(
      qualitativeDecisionMismatches(
        { ...DEMO_AI_QUALITATIVE_DECISIONS, industry: null },
        DEMO_AI_COST_OF_CAPITAL,
      ),
    ).toEqual(["qualitativeDecisions.industry"]);
  });

  it("changes the input hash with any part of the proposal", () => {
    const rationale = withDecisions({
      ...DEMO_AI_QUALITATIVE_DECISIONS,
      industry: {
        ...AI_INDUSTRY,
        resolution: {
          ...AI_INDUSTRY.resolution,
          respondedModel: "other/model",
        },
      },
    });

    expect(computeValuationInputHash(rationale)).not.toBe(
      computeValuationInputHash(DEMO_AI_VALUATION_INPUT),
    );
  });

  it("refuses citations to evidence the decision does not carry", () => {
    expect(
      industryDecisionSchema.safeParse({
        ...AI_INDUSTRY,
        resolution: { ...AI_INDUSTRY.resolution, citedEvidenceIds: ["E2"] },
      }).success,
    ).toBe(false);
    expect(
      operationsMixDecisionSchema.safeParse({
        ...AI_MIX,
        lines: AI_MIX.lines.map((line) => ({ ...line, evidenceId: "E9" })),
      }).success,
    ).toBe(false);
  });

  it("refuses an owner mix whose weights do not add up to one", () => {
    expect(
      operationsMixDecisionSchema.safeParse({
        source: "owner_declaration",
        weightsVersion: "operations-mix-weights-1.0.0",
        declaredOn: "2026-10-16",
        rationale: "The owner read the geographic note.",
        exposures: [
          { exposureKeys: ["japan"], weight: "0.6" },
          { exposureKeys: ["china"], weight: "0.3" },
        ],
      }).success,
    ).toBe(false);
  });

  it("freezes an owner declaration as written", () => {
    const decision = operationsMixDecisionOfDeclaration({
      cik: "0000000042",
      exposures: [
        { exposureKeys: ["japan"], weight: "0.25" },
        { exposureKeys: ["united-states"], weight: "0.75" },
      ],
      rationale: "The owner read the geographic note.",
      declaredOn: "2026-10-16",
    });

    expect(decision).not.toHaveProperty("cik");
    expect(operationsMixReadingOf(decision)).toMatchObject({
      source: "owner_declaration",
      proposalId: null,
      exposures: [
        { exposureKeys: ["japan"], weight: "0.25" },
        { exposureKeys: ["united-states"], weight: "0.75" },
      ],
    });
  });

  it("only freezes an accepted proposal", () => {
    expect(() =>
      operationsMixDecisionOfProposal({
        proposal: {
          outcome: "abstained",
        } as OperationsMixProposal,
        lines: [],
        evidence: [],
      }),
    ).toThrow("Only an accepted operations mix enters a run.");
  });

  describe("industryDecisionOf", () => {
    const releaseIndustries = new Map([
      ["computers-peripherals", "Computers/Peripherals"],
      ["telecom-equipment", "Telecom. Equipment"],
    ]);

    it("freezes a SIC mapping with its single candidate", () => {
      const mapping = mapIndustry({
        cik: "0000000042",
        sic: "3571",
        releaseIndustries,
        declarations: [],
      });

      expect(
        industryDecisionOf(mapping, { declaration: null, resolution: null }),
      ).toEqual({
        basis: "sic",
        mappingVersion: "sic-damodaran-industry-1.1.0",
        industryKey: "computers-peripherals",
        sic: "3571",
        candidates: ["computers-peripherals"],
      });
    });

    it("has no decision for an ambiguous industry", () => {
      const mapping = mapIndustry({
        cik: "0000000042",
        sic: "3576",
        releaseIndustries,
        declarations: [],
      });

      expect(
        industryDecisionOf(mapping, { declaration: null, resolution: null }),
      ).toBeNull();
    });

    it("needs the owner's declaration and drops its ticker", () => {
      const declaration = {
        cik: "0000000042",
        ticker: "FIX",
        industryKey: "telecom-equipment",
        decidedBy: "owner" as const,
        decidedOn: "2026-10-16",
        rationale: "Routers are most of its revenue, per the segment note.",
      };
      const mapping = mapIndustry({
        cik: "0000000042",
        sic: "3576",
        releaseIndustries,
        declarations: [declaration],
      });

      expect(() =>
        industryDecisionOf(mapping, { declaration: null, resolution: null }),
      ).toThrow("An owner-declared industry needs its declaration.");
      expect(
        industryDecisionOf(mapping, { declaration, resolution: null }),
      ).toEqual({
        basis: "owner_declaration",
        mappingVersion: "sic-damodaran-industry-1.1.0",
        industryKey: "telecom-equipment",
        sic: "3576",
        candidates: ["telecom-equipment", "computers-peripherals"],
        declaredOn: "2026-10-16",
        rationale: "Routers are most of its revenue, per the segment note.",
      });
    });

    it("needs the stored resolution the mapping names", () => {
      const mapping = mapIndustry({
        cik: "0000000042",
        sic: "3576",
        releaseIndustries,
        declarations: [],
        aiResolution: {
          resolutionId: DEMO_AI_RESOLUTION_ID,
          industryKey: "computers-peripherals",
          availableAt: "2025-05-20T12:00:00.000Z",
          respondedModel: "fixture/model-a",
          evidenceIds: ["E1"],
        },
      });
      const stored = {
        resolution: {
          resolutionId: DEMO_AI_RESOLUTION_ID,
          legalEntityId: "00000000-0000-4000-8000-000000000042",
          cik: "0000000042",
          sic: "3576",
          candidates: ["telecom-equipment", "computers-peripherals"],
          taskVersion: AI_INDUSTRY.resolution.taskVersion,
          promptVersion: AI_INDUSTRY.resolution.promptVersion,
          ladderVersion: AI_INDUSTRY.resolution.ladderVersion,
          sectionsVersion: AI_INDUSTRY.resolution.sectionsVersion,
          outcome: "resolved" as const,
          industryKey: "computers-peripherals",
          confidence: "high" as const,
          rationale: AI_INDUSTRY.resolution.rationale,
          reason: null,
          acceptedRung: 1,
          respondedModel: "fixture/model-a",
          citedEvidenceIds: ["E1"],
          resolvedAt: "2025-05-20T12:00:00.000Z",
          recordedAt: "2025-05-20T12:00:00.000Z",
        },
        evidence: AI_INDUSTRY.resolution.evidence.map((item) => ({
          ...item,
          section: "item_1_business" as const,
          excerpt: "Servers and storage arrays.",
        })),
      };

      expect(
        industryDecisionOf(mapping, { declaration: null, resolution: stored }),
      ).toEqual(AI_INDUSTRY);
      expect(() =>
        industryDecisionOf(mapping, {
          declaration: null,
          resolution: {
            ...stored,
            resolution: {
              ...stored.resolution,
              resolutionId: "00000000-0000-4000-8000-0000000000ff",
            },
          },
        }),
      ).toThrow("An AI-resolved industry needs its stored resolution.");
    });
  });
});
