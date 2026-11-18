import type { IngestionRun } from "@/modules/ingestion/domain/ingestion-run";

import {
  CONSENSUS_DATASET_ID,
  type ConsensusRepository,
  type OwnerThreshold,
} from "../application/consensus-repository";
import type { ConsensusRevision } from "../domain/consensus-revisions";

/**
 * Test double with the PostgreSQL contract: one open revision per fiscal year,
 * supersession and insertion together, and captures read from the runs.
 */
export function createInMemoryConsensusRepository(
  options: {
    readonly revisions?: readonly ConsensusRevision[];
    /** The runs the captures come from, as the recorder appended them. */
    readonly runs?: () => readonly IngestionRun[];
  } = {},
): ConsensusRepository & {
  readonly all: () => readonly ConsensusRevision[];
} {
  const revisions: ConsensusRevision[] = [...(options.revisions ?? [])];
  const thresholds: (OwnerThreshold & { thresholdId: string })[] = [];

  return {
    storage: "in-memory-fixture",
    all: () => [...revisions],
    async loadOpen(securityId) {
      return revisions.filter(
        (row) => row.securityId === securityId && row.supersededAt === null,
      );
    },
    async loadRevisions(securityId) {
      return revisions
        .filter((row) => row.securityId === securityId)
        .sort(
          (a, b) =>
            a.periodEnd.localeCompare(b.periodEnd) || a.revision - b.revision,
        );
    },
    async apply(plan, ingestionRunId) {
      const next = revisions.map((row) => ({ ...row }));
      for (const closed of plan.supersede) {
        const insert = plan.inserts.find(
          (row) => row.periodEnd === closed.periodEnd,
        );
        const open = next.find(
          (row) =>
            row.securityId === insert?.securityId &&
            row.periodEnd === closed.periodEnd &&
            row.revision === closed.revision &&
            row.supersededAt === null,
        );
        if (insert === undefined || open === undefined) {
          throw new Error("consensus_open_revision_missing");
        }
        open.supersededAt = insert.availableAt;
      }
      for (const insert of plan.inserts) {
        if (
          next.some(
            (row) =>
              row.securityId === insert.securityId &&
              row.periodEnd === insert.periodEnd &&
              row.supersededAt === null,
          )
        ) {
          throw new Error("consensus_open_revision_conflict");
        }
        next.push({ ...insert, ingestionRunId });
      }
      revisions.splice(0, revisions.length, ...next);
    },
    async captures(securityId) {
      return (options.runs?.() ?? [])
        .filter(
          (run) =>
            run.datasetId === CONSENSUS_DATASET_ID &&
            run.subjectKey === securityId &&
            (run.status === "succeeded" || run.status === "duplicate") &&
            run.finishedAt !== null,
        )
        .map((run) => run.finishedAt!)
        .sort();
    },
    async loadThresholds(legalEntityId, metric) {
      return thresholds
        .filter(
          (row) => row.legalEntityId === legalEntityId && row.metric === metric,
        )
        .sort((a, b) => a.declaredAt.localeCompare(b.declaredAt))
        .map(({ thresholdId: _id, ...row }) => {
          void _id;
          return row;
        });
    },
    async declareThreshold(threshold) {
      thresholds.push({ ...threshold });
    },
  };
}
