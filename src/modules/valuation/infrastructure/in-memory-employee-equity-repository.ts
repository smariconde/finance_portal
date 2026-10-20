import {
  assertStoredEmployeeEquity,
  type EmployeeEquityRepository,
  type StoredEmployeeEquity,
} from "../application/employee-equity-repository";
import {
  employeeEquityEvidenceRecordSchema,
  employeeEquityProposalSchema,
} from "../domain/employee-equity";

/**
 * Doble en memoria del repositorio de transcripciones. Sostiene las mismas
 * reglas que el personal para que el contrato corra igual sobre los dos.
 * Ninguna raíz de composición lo construye.
 */
export function createInMemoryEmployeeEquityRepository(): EmployeeEquityRepository {
  const proposals: StoredEmployeeEquity[] = [];
  const newestFirst = (
    left: StoredEmployeeEquity,
    right: StoredEmployeeEquity,
  ) => right.proposal.proposedAt.localeCompare(left.proposal.proposedAt);

  return {
    storage: "in-memory-fixture",
    async record(stored) {
      const parsed: StoredEmployeeEquity = {
        proposal: employeeEquityProposalSchema.parse(stored.proposal),
        evidence: employeeEquityEvidenceRecordSchema.parse(stored.evidence),
      };

      assertStoredEmployeeEquity(parsed);

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
