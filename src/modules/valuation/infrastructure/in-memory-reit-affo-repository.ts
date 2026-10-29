import {
  parseStoredReitAffo,
  type ReitAffoRepository,
  type StoredReitAffo,
} from "../application/reit-affo-repository";

export function createInMemoryReitAffoRepository(): ReitAffoRepository {
  const entries: StoredReitAffo[] = [];
  const newestFirst = (left: StoredReitAffo, right: StoredReitAffo) =>
    right.proposal.proposedAt.localeCompare(left.proposal.proposedAt);

  return {
    storage: "in-memory-fixture",
    async record(stored) {
      const parsed = parseStoredReitAffo(stored);
      if (
        entries.some(
          (item) => item.proposal.proposalId === parsed.proposal.proposalId,
        )
      )
        throw new Error(
          `proposal ${parsed.proposal.proposalId} already recorded`,
        );
      entries.push(parsed);
    },
    async latestForSubject(legalEntityId) {
      return (
        entries
          .filter((item) => item.proposal.legalEntityId === legalEntityId)
          .sort(newestFirst)[0] ?? null
      );
    },
    async latestAsKnown(legalEntityId, knownAt) {
      return (
        entries
          .filter(
            (item) =>
              item.proposal.legalEntityId === legalEntityId &&
              item.proposal.recordedAt <= knownAt &&
              item.evidence.documentAcceptedAt <= knownAt,
          )
          .sort(newestFirst)[0] ?? null
      );
    },
    async acceptedAsKnown(legalEntityId, knownAt) {
      return (
        entries
          .filter(
            (item) =>
              item.proposal.legalEntityId === legalEntityId &&
              item.proposal.outcome === "accepted" &&
              item.proposal.recordedAt <= knownAt &&
              item.evidence.documentAcceptedAt <= knownAt,
          )
          .sort(newestFirst)[0] ?? null
      );
    },
  };
}
