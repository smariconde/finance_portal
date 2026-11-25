import {
  assertStoredBusinessMix,
  type BusinessMixRepository,
  type StoredBusinessMix,
} from "../application/business-mix-repository";
import {
  businessMixEvidenceRecordSchema,
  businessMixLineRecordSchema,
  businessMixProposalSchema,
} from "../domain/business-mix";

/**
 * Doble en memoria del repositorio de mezclas. Sostiene las mismas reglas que
 * el personal para que el contrato corra igual sobre los dos. Ninguna raíz de
 * composición lo construye.
 */
export function createInMemoryBusinessMixRepository(): BusinessMixRepository {
  const proposals: StoredBusinessMix[] = [];
  const newestFirst = (left: StoredBusinessMix, right: StoredBusinessMix) =>
    right.proposal.proposedAt.localeCompare(left.proposal.proposedAt);

  return {
    storage: "in-memory-fixture",
    async record(stored) {
      const parsed: StoredBusinessMix = {
        proposal: businessMixProposalSchema.parse(stored.proposal),
        lines: stored.lines.map((line) =>
          businessMixLineRecordSchema.parse(line),
        ),
        evidence: stored.evidence.map((item) =>
          businessMixEvidenceRecordSchema.parse(item),
        ),
      };

      assertStoredBusinessMix(parsed);

      if (
        proposals.some(
          (candidate) =>
            candidate.proposal.proposalId === parsed.proposal.proposalId,
        )
      ) {
        throw new Error(
          `proposal ${parsed.proposal.proposalId} already recorded`,
        );
      }

      proposals.push(parsed);
    },
    async latestForSubject(legalEntityId) {
      return (
        proposals
          .filter((stored) => stored.proposal.legalEntityId === legalEntityId)
          .sort(newestFirst)[0] ?? null
      );
    },
    async acceptedAsKnown(legalEntityId, knownAt) {
      return (
        proposals
          .filter(
            (stored) =>
              stored.proposal.legalEntityId === legalEntityId &&
              stored.proposal.outcome === "accepted" &&
              Date.parse(stored.proposal.proposedAt) <= Date.parse(knownAt),
          )
          .sort(newestFirst)[0] ?? null
      );
    },
  };
}
