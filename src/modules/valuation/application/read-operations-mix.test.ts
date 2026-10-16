import { describe, expect, it } from "vitest";

import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";

import {
  lineRecordsOf,
  operationsMixDeclarationSchema,
} from "../domain/operations-mix";
import { createInMemoryOperationsMixRepository } from "../infrastructure/in-memory-operations-mix-repository";

import { readOperationsMix } from "./read-operations-mix";

const SUBJECT = "00000000-0000-4000-8000-000000000042";
const CIK = "0000000042";

function at(instant: string) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: instant,
    knownAt: instant,
    revisionPolicy: "as_known",
    adjustmentPolicy: "as_known",
    sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
  });
}

async function repositoryWithProposal() {
  const repository = createInMemoryOperationsMixRepository();
  await repository.record({
    proposal: {
      proposalId: "00000000-0000-4000-8000-0000000000a1",
      legalEntityId: SUBJECT,
      cik: CIK,
      accessionNumber: "0000000042-26-000001",
      fiscalYearEnd: "2025-12-31",
      taskVersion: "operations-mix-1.0.0",
      promptVersion: "operations-mix-prompt-1.1.0",
      policyVersion: "operations-mix-policy-1.1.0",
      ladderVersion: "ai-model-ladder-1.0.0",
      extractVersion: "sec-10k-geographic-revenue-1.0.0",
      countryReleaseId: "00000000-0000-4000-8000-0000000000c1",
      regionReleaseId: "00000000-0000-4000-8000-0000000000c2",
      outcome: "accepted",
      unit: "millions",
      printedTotal: "$ 400",
      expectedRevenue: "400000000",
      confidence: "high",
      rationale: "Copied the latest column.",
      reason: null,
      acceptedRung: 2,
      respondedModel: "fixture/model-b",
      proposedAt: "2026-10-16T12:00:00.000Z",
      recordedAt: "2026-10-16T12:00:00.000Z",
    },
    lines: lineRecordsOf([
      {
        label: "United States",
        amount: "$ 300",
        quote: "United States $ 300",
        evidenceId: "E1",
        basis: "name_match",
        exposureKeys: ["united-states"],
        definitionQuote: null,
      },
      {
        label: "Other",
        amount: "100",
        quote: "Other 100",
        evidenceId: "E1",
        basis: "rest_of_world",
        exposureKeys: [],
        definitionQuote: null,
      },
    ]),
    evidence: [
      {
        evidenceId: "E1",
        sourceId: "sec-edgar",
        section: "geographic_revenue",
        documentUrl:
          "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/fix-20251231.htm",
        accessionNumber: "0000000042-26-000001",
        documentAcceptedAt: "2026-02-20T21:00:00.000Z",
        sha256: "a".repeat(64),
        byteLength: 40,
        truncated: false,
        excerpt: "United States $ 300 Other 100 Total $ 400",
      },
    ],
  });
  return repository;
}

describe("readOperationsMix", () => {
  it("reads the accepted proposal known at the cutoff, with weights computed by code", async () => {
    const repository = await repositoryWithProposal();

    expect(
      await readOperationsMix(
        {
          legalEntityId: SUBJECT,
          cik: CIK,
          query: at("2026-10-17T00:00:00.000Z"),
          declarations: [],
        },
        repository,
      ),
    ).toEqual({
      source: "ai_proposal",
      proposalId: "00000000-0000-4000-8000-0000000000a1",
      weightsVersion: "operations-mix-weights-1.0.0",
      exposures: [
        {
          exposureKeys: ["united-states"],
          basis: "name_match",
          weight: "0.75",
        },
        { exposureKeys: [], basis: "rest_of_world", weight: "0.25" },
      ],
    });
  });

  it("sees nothing before the proposal existed", async () => {
    const repository = await repositoryWithProposal();

    expect(
      await readOperationsMix(
        {
          legalEntityId: SUBJECT,
          cik: CIK,
          query: at("2026-10-15T00:00:00.000Z"),
          declarations: [],
        },
        repository,
      ),
    ).toBeNull();
  });

  it("lets the owner's declaration win over any proposal", async () => {
    const repository = await repositoryWithProposal();
    const declaration = operationsMixDeclarationSchema.parse({
      cik: CIK,
      exposures: [{ exposureKeys: ["japan"], weight: "1" }],
      rationale: "The owner read the filing and declared it.",
      declaredOn: "2026-10-16",
    });

    expect(
      await readOperationsMix(
        {
          legalEntityId: SUBJECT,
          cik: CIK,
          query: at("2026-10-17T00:00:00.000Z"),
          declarations: [declaration],
        },
        repository,
      ),
    ).toMatchObject({ source: "owner_declaration", proposalId: null });
  });
});
