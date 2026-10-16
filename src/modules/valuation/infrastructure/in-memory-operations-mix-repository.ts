import {
  assertStoredOperationsMix,
  type OperationsMixRepository,
  type StoredOperationsMix,
} from "../application/operations-mix-repository";
import {
  operationsMixEvidenceRecordSchema,
  operationsMixLineRecordSchema,
  operationsMixProposalSchema,
} from "../domain/operations-mix";

/**
 * Doble en memoria del repositorio de mixes. Sostiene las mismas reglas que el
 * personal para que el contrato corra igual sobre los dos. Ninguna raíz de
 * composición lo construye.
 */
export function createInMemoryOperationsMixRepository(): OperationsMixRepository {
  const proposals: StoredOperationsMix[] = [];
  const newestFirst = (left: StoredOperationsMix, right: StoredOperationsMix) =>
    right.proposal.proposedAt.localeCompare(left.proposal.proposedAt);

  return {
    storage: "in-memory-fixture",
    async record(stored) {
      const parsed: StoredOperationsMix = {
        proposal: operationsMixProposalSchema.parse(stored.proposal),
        lines: stored.lines.map((line) =>
          operationsMixLineRecordSchema.parse(line),
        ),
        evidence: stored.evidence.map((item) =>
          operationsMixEvidenceRecordSchema.parse(item),
        ),
      };

      assertStoredOperationsMix(parsed);

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
