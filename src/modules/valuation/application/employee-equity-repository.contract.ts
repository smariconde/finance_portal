import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  EmployeeEquityEvidenceRecord,
  EmployeeEquityProposal,
} from "../domain/employee-equity";
import type { EmployeeEquityOutput } from "../domain/employee-equity-task";

import type {
  EmployeeEquityRepository,
  StoredEmployeeEquity,
} from "./employee-equity-repository";

/**
 * Contrato del repositorio de transcripciones (`F4-05`), escrito una vez y
 * corrido contra el doble en memoria y contra PostgreSQL. Cada caso usa un
 * sujeto propio, así que la base de integración no necesita vaciarse.
 */
export type EmployeeEquityRepositoryContractHarness = {
  readonly createRepository: () => EmployeeEquityRepository;
};

const ACCESSION = "0000000042-26-000001";

const TRANSCRIPTION: EmployeeEquityOutput = {
  decision: "proposed",
  scale: "thousands",
  optionsStatus: "outstanding",
  optionsCount: "93,072",
  optionsCountQuote: "Shares at December 28, 2025 93,072 $151.14",
  optionsStrike: "$151.14",
  optionsStrikeQuote: "Shares at December 28, 2025 93,072 $151.14",
  optionsLifeBasis: "remaining_years",
  optionsLife: "5.5",
  optionsLifeQuote: "93,072 5.5 $151.14",
  optionsRanges: [],
  unitsStatus: "outstanding",
  units: [
    {
      kind: "restricted",
      count: "12,136",
      quote: "Shares at December 28, 2025 12,136 2,111",
    },
  ],
  confidence: "high",
  rationale: "Year-end balances.",
  abstainReason: null,
};

function proposal(
  subjectId: string,
  overrides: Partial<EmployeeEquityProposal> = {},
): EmployeeEquityProposal {
  return {
    proposalId: randomUUID(),
    legalEntityId: subjectId,
    cik: "0000000042",
    accessionNumber: ACCESSION,
    fiscalYearEnd: "2025-12-28",
    taskVersion: "employee-equity-1.0.0",
    promptVersion: "employee-equity-prompt-1.1.0",
    policyVersion: "employee-equity-policy-1.0.0",
    ladderVersion: "ai-model-ladder-1.1.0",
    extractVersion: "sec-10k-equity-compensation-1.0.0",
    xbrlOptionsOutstanding: "93072000",
    xbrlWeightedStrike: "151.14",
    outcome: "accepted",
    transcription: TRANSCRIPTION,
    reason: null,
    acceptedRung: 1,
    respondedModel: "fixture/model-a",
    proposedAt: "2026-10-20T12:00:00.000Z",
    recordedAt: "2026-10-20T12:00:00.000Z",
    ...overrides,
  };
}

function evidence(): EmployeeEquityEvidenceRecord {
  return {
    sourceId: "sec-edgar",
    documentUrl:
      "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/fix-20251228.htm",
    accessionNumber: ACCESSION,
    documentAcceptedAt: "2026-02-11T21:00:00.000Z",
    sha256: "b".repeat(64),
    byteLength: 64,
    truncated: false,
    excerpt: "Shares at December 28, 2025 93,072 $151.14",
  };
}

function accepted(
  subjectId: string,
  overrides: Partial<EmployeeEquityProposal> = {},
): StoredEmployeeEquity {
  return { proposal: proposal(subjectId, overrides), evidence: evidence() };
}

function abstained(
  subjectId: string,
  overrides: Partial<EmployeeEquityProposal> = {},
): StoredEmployeeEquity {
  return {
    proposal: proposal(subjectId, {
      outcome: "abstained",
      transcription: null,
      reason: "insufficient_evidence",
      acceptedRung: null,
      respondedModel: null,
      ...overrides,
    }),
    evidence: evidence(),
  };
}

export function describeEmployeeEquityRepositoryContract(
  name: string,
  harness: EmployeeEquityRepositoryContractHarness,
): void {
  describe(`employee equity repository contract (${name})`, () => {
    it("round-trips an accepted transcription with its evidence, exactly", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const stored = accepted(subject);

      await repository.record(stored);

      expect(await repository.latestForSubject(subject)).toEqual(stored);
    });

    it("keeps an abstention with its evidence and no transcription", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const stored = abstained(subject, {
        xbrlOptionsOutstanding: null,
        xbrlWeightedStrike: null,
      });

      await repository.record(stored);

      expect(await repository.latestForSubject(subject)).toEqual(stored);
    });

    it("answers the newest proposal, abstentions included", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();

      await repository.record(accepted(subject));
      const later = abstained(subject, {
        proposedAt: "2026-10-21T12:00:00.000Z",
        recordedAt: "2026-10-21T12:00:00.000Z",
      });
      await repository.record(later);

      expect(await repository.latestForSubject(subject)).toEqual(later);
    });

    it("reads only accepted transcriptions that existed at the cutoff", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const first = accepted(subject);
      const second = accepted(subject, {
        proposedAt: "2026-10-22T12:00:00.000Z",
        recordedAt: "2026-10-22T12:00:00.000Z",
      });

      await repository.record(first);
      await repository.record(second);
      await repository.record(
        abstained(subject, {
          proposedAt: "2026-10-23T12:00:00.000Z",
          recordedAt: "2026-10-23T12:00:00.000Z",
        }),
      );

      expect(
        await repository.acceptedAsKnown(subject, "2026-10-19T00:00:00.000Z"),
      ).toBeNull();
      expect(
        await repository.acceptedAsKnown(subject, "2026-10-21T00:00:00.000Z"),
      ).toEqual(first);
      expect(
        await repository.acceptedAsKnown(subject, "2026-10-24T00:00:00.000Z"),
      ).toEqual(second);
    });

    it("refuses a proposal recorded twice", async () => {
      const repository = harness.createRepository();
      const stored = accepted(randomUUID());

      await repository.record(stored);

      await expect(repository.record(stored)).rejects.toThrow();
    });

    it("refuses evidence from another 10-K", async () => {
      const repository = harness.createRepository();
      const stored = accepted(randomUUID());

      await expect(
        repository.record({
          ...stored,
          evidence: {
            ...stored.evidence,
            accessionNumber: "0000000042-25-000009",
          },
        }),
      ).rejects.toThrow(/10-K/u);
    });

    it("refuses an accepted proposal without a transcription", async () => {
      const repository = harness.createRepository();
      const stored = accepted(randomUUID());

      await expect(
        repository.record({
          ...stored,
          proposal: { ...stored.proposal, transcription: null },
        }),
      ).rejects.toThrow();
    });
  });
}
