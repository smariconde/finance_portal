import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type {
  ConsensusRevision,
  ConsensusRevisionPlan,
} from "../domain/consensus-revisions";

export const CONSENSUS_DATASET_ID = "alpha-vantage.earnings-estimates";

export type OwnerThreshold = {
  readonly legalEntityId: string;
  readonly metric: "forward_pe";
  /** `null` when the owner removed it. */
  readonly value: string | null;
  readonly reason: string | null;
  readonly declaredAt: string;
};

export interface ConsensusRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  /** The open revision of each fiscal year, withdrawn ones included. */
  loadOpen(securityId: string): Promise<readonly ConsensusRevision[]>;
  /** Every revision of the security, for reads at any cutoff. */
  loadRevisions(securityId: string): Promise<readonly ConsensusRevision[]>;
  /** Closes the superseded revisions and inserts the new ones, atomically. */
  apply(plan: ConsensusRevisionPlan, ingestionRunId: string): Promise<void>;
  /**
   * When the security was captured: the finish of every succeeded or duplicate
   * run of the dataset, oldest first. A duplicate is a capture that changed
   * nothing, and still dates the consensus.
   */
  captures(securityId: string): Promise<readonly string[]>;
  /** The owner's declarations for one company and metric, oldest first. */
  loadThresholds(
    legalEntityId: string,
    metric: OwnerThreshold["metric"],
  ): Promise<readonly OwnerThreshold[]>;
  declareThreshold(
    threshold: OwnerThreshold & { readonly thresholdId: string },
  ): Promise<void>;
}

export function selectConsensusRepository(
  mode: AppMode,
  factories: { personal: () => ConsensusRepository },
): ConsensusRepository {
  return selectPersonalDependency(
    mode,
    "consensus-repository",
    factories.personal,
  );
}
