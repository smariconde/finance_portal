import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import {
  assertReitAffoEvidence,
  reitAffoEvidenceRecordSchema,
  reitAffoProposalSchema,
  type ReitAffoEvidenceRecord,
  type ReitAffoProposal,
} from "../domain/reit-affo-proposal";
import { judgeReitAffo } from "../domain/reit-affo-task";

export type StoredReitAffo = {
  readonly proposal: ReitAffoProposal;
  readonly evidence: ReitAffoEvidenceRecord;
};

export interface ReitAffoRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  record(stored: StoredReitAffo): Promise<void>;
  latestForSubject(legalEntityId: string): Promise<StoredReitAffo | null>;
  latestAsKnown(
    legalEntityId: string,
    knownAt: string,
  ): Promise<StoredReitAffo | null>;
  /** Only proposals recorded and filings accepted by the cutoff are visible. */
  acceptedAsKnown(
    legalEntityId: string,
    knownAt: string,
  ): Promise<StoredReitAffo | null>;
}

export function selectReitAffoRepository(
  mode: AppMode,
  factories: { personal: () => ReitAffoRepository },
): ReitAffoRepository {
  return selectPersonalDependency(
    mode,
    "reit-affo-repository",
    factories.personal,
  );
}

export function parseStoredReitAffo(stored: StoredReitAffo): StoredReitAffo {
  const parsed = {
    proposal: reitAffoProposalSchema.parse(stored.proposal),
    evidence: reitAffoEvidenceRecordSchema.parse(stored.evidence),
  };
  assertReitAffoEvidence(parsed.proposal, parsed.evidence);
  if (
    parsed.proposal.outcome === "accepted" &&
    parsed.proposal.transcription !== null &&
    judgeReitAffo(parsed.proposal.transcription, {
      companyName: parsed.proposal.cik,
      fiscalYearEnd: parsed.proposal.fiscalYearEnd,
      evidence: {
        sourceId: "sec-edgar",
        text: parsed.evidence.excerpt,
      },
      expectedCommonIncome: parsed.proposal.expectedCommonIncome,
    }).verdict !== "accept"
  )
    throw new Error("The stored REIT AFFO transcription does not pass policy.");
  return parsed;
}
