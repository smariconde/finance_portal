import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  BusinessMixEvidenceRecord,
  BusinessMixLineRecord,
  BusinessMixProposal,
} from "../domain/business-mix";

import type {
  BusinessMixRepository,
  StoredBusinessMix,
} from "./business-mix-repository";

/**
 * Contrato del repositorio de mezclas (`F6-48`), escrito una vez y corrido
 * contra el doble en memoria y contra PostgreSQL. Cada caso usa un sujeto
 * propio, así que la base de integración no necesita vaciarse.
 */
export type BusinessMixRepositoryContractHarness = {
  readonly createRepository: () => BusinessMixRepository;
};

function proposal(
  subjectId: string,
  overrides: Partial<BusinessMixProposal> = {},
): BusinessMixProposal {
  return {
    proposalId: randomUUID(),
    legalEntityId: subjectId,
    cik: "0000000042",
    accessionNumber: "0000000042-26-000001",
    fiscalYearEnd: "2025-12-31",
    taskVersion: "business-mix-1.0.0",
    promptVersion: "business-mix-prompt-1.0.0",
    policyVersion: "business-mix-policy-1.0.0",
    ladderVersion: "ai-model-ladder-1.1.0",
    linesVersion: "sec-xbrl-business-lines-1.0.0",
    sectionsVersion: "sec-10k-sections-1.0.0",
    betasReleaseId: "00000000-0000-4000-8000-0000000000b1",
    outcome: "accepted",
    axis: "StatementBusinessSegmentsAxis",
    expectedRevenue: "400000000",
    confidence: "high",
    rationale: "Two businesses.",
    reason: null,
    acceptedRung: 1,
    respondedModel: "fixture/model-a",
    proposedAt: "2026-11-24T12:00:00.000Z",
    recordedAt: "2026-11-24T12:00:00.000Z",
    ...overrides,
  };
}

function evidence(): BusinessMixEvidenceRecord[] {
  return [
    {
      evidenceId: "E1",
      sourceId: "sec-edgar",
      section: "item_1_business",
      documentUrl:
        "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/fix-20251231.htm",
      accessionNumber: "0000000042-26-000001",
      documentAcceptedAt: "2026-02-20T21:00:00.000Z",
      sha256: "a".repeat(64),
      byteLength: 64,
      truncated: false,
      excerpt: "Services sells advertising. Cloud sells infrastructure.",
    },
    {
      evidenceId: "E2",
      sourceId: "sec-edgar",
      section: "xbrl_business_lines",
      documentUrl:
        "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/fix-20251231_htm.xml",
      accessionNumber: "0000000042-26-000001",
      documentAcceptedAt: "2026-02-20T21:00:00.000Z",
      sha256: "b".repeat(64),
      byteLength: 80,
      truncated: false,
      excerpt:
        "L1 | StatementBusinessSegmentsAxis | ServicesMember | 300000000",
    },
  ];
}

const LINES: BusinessMixLineRecord[] = [
  {
    ordinal: 1,
    lineId: "L1",
    axis: "StatementBusinessSegmentsAxis",
    member: "ServicesMember",
    concept: "us-gaap:Revenues",
    amount: "300000000",
    industryKey: "advertising",
    quote: "Services sells advertising.",
    evidenceId: "E1",
  },
  {
    ordinal: 2,
    lineId: "L2",
    axis: "StatementBusinessSegmentsAxis",
    member: "CloudMember",
    concept: "us-gaap:Revenues",
    amount: "100000000",
    industryKey: "software-system-and-application",
    quote: "Cloud sells infrastructure.",
    evidenceId: "E1",
  },
];

function accepted(
  subjectId: string,
  overrides: Partial<BusinessMixProposal> = {},
): StoredBusinessMix {
  return {
    proposal: proposal(subjectId, overrides),
    lines: LINES,
    evidence: evidence(),
  };
}

function abstained(
  subjectId: string,
  overrides: Partial<BusinessMixProposal> = {},
): StoredBusinessMix {
  return {
    proposal: proposal(subjectId, {
      outcome: "abstained",
      axis: null,
      confidence: null,
      rationale: null,
      reason: "insufficient_evidence",
      acceptedRung: null,
      respondedModel: null,
      ...overrides,
    }),
    lines: [],
    evidence: evidence(),
  };
}

export function describeBusinessMixRepositoryContract(
  name: string,
  harness: BusinessMixRepositoryContractHarness,
): void {
  describe(`business mix repository contract (${name})`, () => {
    it("round-trips an accepted proposal with its lines and evidence, exactly", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const stored = accepted(subject);

      await repository.record(stored);

      expect(await repository.latestForSubject(subject)).toEqual(stored);
    });

    it("keeps an abstention with its evidence and no lines", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const stored = abstained(subject);

      await repository.record(stored);

      expect(await repository.latestForSubject(subject)).toEqual(stored);
      expect(
        await repository.acceptedAsKnown(subject, "2027-01-01T00:00:00.000Z"),
      ).toBeNull();
    });

    it("answers at a cutoff only with an accepted proposal that already existed", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const first = accepted(subject);
      const later = abstained(subject, {
        proposedAt: "2026-12-01T12:00:00.000Z",
        recordedAt: "2026-12-01T12:00:00.000Z",
      });

      await repository.record(first);
      await repository.record(later);

      expect(
        await repository.acceptedAsKnown(subject, "2026-11-24T11:59:59.999Z"),
      ).toBeNull();
      expect(
        (await repository.acceptedAsKnown(subject, "2026-12-15T00:00:00.000Z"))
          ?.proposal.proposalId,
      ).toBe(first.proposal.proposalId);
      expect(
        (await repository.latestForSubject(subject))?.proposal.proposalId,
      ).toBe(later.proposal.proposalId);
    });

    it("never overwrites a proposal", async () => {
      const repository = harness.createRepository();
      const stored = accepted(randomUUID());

      await repository.record(stored);
      await expect(repository.record(stored)).rejects.toThrow();
    });

    it("refuses lines without acceptance, or of another axis, writing nothing", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();

      await expect(
        repository.record({ ...accepted(subject), lines: [] }),
      ).rejects.toThrow();
      await expect(
        repository.record({ ...abstained(subject), lines: LINES }),
      ).rejects.toThrow();
      await expect(
        repository.record(accepted(subject, { axis: "ProductOrServiceAxis" })),
      ).rejects.toThrow();
      expect(await repository.latestForSubject(subject)).toBeNull();
    });
  });
}
