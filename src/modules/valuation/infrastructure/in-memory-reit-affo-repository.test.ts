import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { StoredReitAffo } from "../application/reit-affo-repository";

import { createInMemoryReitAffoRepository } from "./in-memory-reit-affo-repository";

const accession = "0001193125-26-051453";
const excerpt = [
  "Reconciliation of net income to FFO and AFFO, 2025 (in millions)",
  "income 8",
  "depreciation 6",
  "gains 2",
  "impairments 1",
  "JV 0",
  "capex 2",
  "rent 1",
  "FFO 13",
  "AFFO 10",
].join("\n");

function stored(
  outcome: "accepted" | "abstained",
  recordedAt = "2026-02-13T12:00:00.000Z",
): StoredReitAffo {
  return {
    proposal: {
      proposalId:
        outcome === "accepted"
          ? "00000000-0000-4000-8000-000000000001"
          : "00000000-0000-4000-8000-000000000002",
      legalEntityId: "00000000-0000-4000-8000-000000000003",
      cik: "0001045609",
      accessionNumber: accession,
      fiscalYearEnd: "2025-12-31",
      taskVersion: "reit-affo-1.0.0",
      promptVersion: "reit-affo-prompt-1.0.0",
      policyVersion: "reit-affo-policy-1.1.0",
      extractVersion: "sec-10k-reit-affo-1.0.0",
      expectedCommonIncome: "8000000",
      commonIncomeObservationId: "00000000-0000-4000-8000-000000000004",
      commonIncomeSourceDocumentId: accession,
      outcome,
      transcription:
        outcome === "accepted"
          ? {
              decision: "proposed",
              unit: "millions",
              unitQuote: "(in millions)",
              components: {
                commonNetIncome: { amount: "8", quote: "income 8" },
                realEstateDepreciation: {
                  amount: "6",
                  quote: "depreciation 6",
                },
                propertySaleGains: { amount: "2", quote: "gains 2" },
                realEstateImpairments: { amount: "1", quote: "impairments 1" },
                jointVentureAdjustment: { amount: "0", quote: "JV 0" },
                recurringCapex: { amount: "2", quote: "capex 2" },
                straightLineRent: { amount: "1", quote: "rent 1" },
              },
              reportedFfo: { amount: "13", quote: "FFO 13" },
              reportedAffo: { amount: "10", quote: "AFFO 10" },
              rationale: "All cited amounts reconcile.",
              abstainReason: null,
            }
          : null,
      reason: outcome === "accepted" ? null : "different_definition",
      acceptedRung: outcome === "accepted" ? 1 : null,
      respondedModel: outcome === "accepted" ? "fixture-model" : null,
      proposedAt: recordedAt,
      recordedAt,
    },
    evidence: {
      sourceId: "sec-edgar",
      documentUrl:
        "https://www.sec.gov/Archives/edgar/data/1045609/000119312526051453/pld-20251231.htm",
      accessionNumber: accession,
      documentAcceptedAt: "2026-02-12T17:00:00.000Z",
      sha256: createHash("sha256").update(excerpt).digest("hex"),
      byteLength: Buffer.byteLength(excerpt),
      truncated: false,
      excerpt,
    },
  };
}

describe("REIT AFFO proposal repository", () => {
  it("excludes later proposals and filings from an as-known read", async () => {
    const repository = createInMemoryReitAffoRepository();
    const accepted = stored("accepted");
    await repository.record(accepted);
    expect(
      await repository.acceptedAsKnown(
        accepted.proposal.legalEntityId,
        "2026-02-13T11:59:59.000Z",
      ),
    ).toBeNull();
    expect(
      await repository.acceptedAsKnown(
        accepted.proposal.legalEntityId,
        "2026-02-13T12:00:00.000Z",
      ),
    ).toEqual(accepted);
    await repository.record(stored("abstained", "2026-02-14T12:00:00.000Z"));
    expect(
      (
        await repository.latestAsKnown(
          accepted.proposal.legalEntityId,
          "2026-02-13T23:00:00.000Z",
        )
      )?.proposal.outcome,
    ).toBe("accepted");
    expect(
      (
        await repository.latestAsKnown(
          accepted.proposal.legalEntityId,
          "2026-02-15T00:00:00.000Z",
        )
      )?.proposal.outcome,
    ).toBe("abstained");
    expect(
      (await repository.latestForSubject(accepted.proposal.legalEntityId))
        ?.proposal.outcome,
    ).toBe("abstained");
    expect(
      (
        await repository.acceptedAsKnown(
          accepted.proposal.legalEntityId,
          "2026-02-15T00:00:00.000Z",
        )
      )?.proposal.outcome,
    ).toBe("accepted");
  });

  it("refuses mismatched XBRL accession and altered evidence", async () => {
    const repository = createInMemoryReitAffoRepository();
    const candidate = stored("accepted");
    await expect(
      repository.record({
        ...candidate,
        proposal: {
          ...candidate.proposal,
          commonIncomeSourceDocumentId: "0001193125-26-051454",
        },
      }),
    ).rejects.toThrow("same 10-K");
    await expect(
      repository.record({
        ...candidate,
        evidence: {
          ...candidate.evidence,
          excerpt: `${candidate.evidence.excerpt} changed`,
        },
      }),
    ).rejects.toThrow("byte length");
  });
});
