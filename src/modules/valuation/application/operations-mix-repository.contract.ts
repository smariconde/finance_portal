import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  lineRecordsOf,
  type OperationsMixEvidenceRecord,
  type OperationsMixProposal,
} from "../domain/operations-mix";

import type {
  OperationsMixRepository,
  StoredOperationsMix,
} from "./operations-mix-repository";

/**
 * Contrato del repositorio de mixes (`F5-05`), escrito una vez y corrido contra
 * el doble en memoria y contra PostgreSQL. Cada caso usa un sujeto propio, así
 * que la base de integración no necesita vaciarse.
 */
export type OperationsMixRepositoryContractHarness = {
  readonly createRepository: () => OperationsMixRepository;
};

function proposal(
  subjectId: string,
  overrides: Partial<OperationsMixProposal> = {},
): OperationsMixProposal {
  return {
    proposalId: randomUUID(),
    legalEntityId: subjectId,
    cik: "0000000042",
    accessionNumber: "0000000042-26-000001",
    fiscalYearEnd: "2025-12-31",
    taskVersion: "operations-mix-1.0.0",
    promptVersion: "operations-mix-prompt-1.0.0",
    policyVersion: "operations-mix-policy-1.0.0",
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
    acceptedRung: 1,
    respondedModel: "fixture/model-a",
    proposedAt: "2026-10-16T12:00:00.000Z",
    recordedAt: "2026-10-16T12:00:00.000Z",
    ...overrides,
  };
}

function evidence(): OperationsMixEvidenceRecord[] {
  return [
    {
      evidenceId: "E1",
      sourceId: "sec-edgar",
      section: "geographic_revenue",
      documentUrl:
        "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/fix-20251231.htm",
      accessionNumber: "0000000042-26-000001",
      documentAcceptedAt: "2026-02-20T21:00:00.000Z",
      sha256: "a".repeat(64),
      byteLength: 64,
      truncated: false,
      excerpt: "United States $ 300 Other 100 Total $ 400",
    },
  ];
}

const LINES = lineRecordsOf([
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
]);

function accepted(
  subjectId: string,
  overrides: Partial<OperationsMixProposal> = {},
): StoredOperationsMix {
  return {
    proposal: proposal(subjectId, overrides),
    lines: LINES,
    evidence: evidence(),
  };
}

function abstained(
  subjectId: string,
  overrides: Partial<OperationsMixProposal> = {},
): StoredOperationsMix {
  return {
    proposal: proposal(subjectId, {
      outcome: "abstained",
      unit: null,
      printedTotal: null,
      confidence: null,
      rationale: null,
      reason: "no_geographic_revenue_table",
      acceptedRung: null,
      respondedModel: null,
      ...overrides,
    }),
    lines: [],
    evidence: evidence(),
  };
}

export function describeOperationsMixRepositoryContract(
  name: string,
  harness: OperationsMixRepositoryContractHarness,
): void {
  describe(`operations mix repository contract (${name})`, () => {
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
      const first = accepted(subject, {
        proposedAt: "2026-10-16T12:00:00.000Z",
        recordedAt: "2026-10-16T12:00:00.000Z",
      });
      const later = abstained(subject, {
        proposedAt: "2026-11-01T12:00:00.000Z",
        recordedAt: "2026-11-01T12:00:00.000Z",
      });
      const second = accepted(subject, {
        proposedAt: "2026-12-01T12:00:00.000Z",
        recordedAt: "2026-12-01T12:00:00.000Z",
        accessionNumber: "0000000042-26-000009",
      });

      await repository.record(first);
      await repository.record(later);
      await repository.record(second);

      expect(
        await repository.acceptedAsKnown(subject, "2026-10-16T11:59:59.999Z"),
      ).toBeNull();
      expect(
        (await repository.acceptedAsKnown(subject, "2026-11-15T00:00:00.000Z"))
          ?.proposal.proposalId,
      ).toBe(first.proposal.proposalId);
      expect(
        (await repository.acceptedAsKnown(subject, "2026-12-01T12:00:00.000Z"))
          ?.proposal.proposalId,
      ).toBe(second.proposal.proposalId);
      expect(
        (await repository.latestForSubject(subject))?.proposal.proposalId,
      ).toBe(second.proposal.proposalId);
    });

    it("never overwrites a proposal", async () => {
      const repository = harness.createRepository();
      const stored = accepted(randomUUID());

      await repository.record(stored);
      await expect(repository.record(stored)).rejects.toThrow();
    });

    it("refuses an accepted proposal without lines and an abstention with lines, writing nothing", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();

      await expect(
        repository.record({ ...accepted(subject), lines: [] }),
      ).rejects.toThrow();
      await expect(
        repository.record({ ...abstained(subject), lines: LINES }),
      ).rejects.toThrow();
      expect(await repository.latestForSubject(subject)).toBeNull();
    });
  });
}
