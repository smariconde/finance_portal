import { z } from "zod";

import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import { ingestionRunSchema } from "@/modules/ingestion/domain/ingestion-run";

import {
  CONSENSUS_REVISIONS_VERSION,
  planConsensusRevisions,
  type ConsensusRevisionPlan,
} from "../domain/consensus-revisions";
import {
  CONSENSUS_DATASET_ID,
  type ConsensusRepository,
} from "./consensus-repository";
import type { ConsensusSource } from "./live-consensus-source";

export const recordConsensusCommandSchema = z.object({
  securityId: z.uuid(),
  symbol: z.string().trim().min(1).max(16),
});

export type RecordConsensusCommand = z.input<
  typeof recordConsensusCommandSchema
>;

export type RecordConsensusDependencies = {
  readonly source: ConsensusSource;
  readonly repository: ConsensusRepository;
  readonly ingestionRuns: IngestionRunRepository;
  readonly now: () => string;
  readonly newId: () => string;
  readonly hashContent: (input: string) => string;
  /** Dry: fetches and plans, records nothing. */
  readonly dryRun?: boolean;
};

export type RecordConsensusOutcome = {
  readonly symbol: string;
  readonly securityId: string;
  readonly observedAt: string;
  readonly fiscalYears: readonly {
    readonly periodEnd: string;
    readonly epsAverage: string;
    readonly epsAnalystCount: number | null;
  }[];
  readonly quartersDropped: number;
  readonly byteLength: number;
  readonly plan: ConsensusRevisionPlan;
  readonly runId: string | null;
  readonly runStatus: "succeeded" | "duplicate" | null;
};

/**
 * One capture of a security's consensus (ADR 0083): fetch, compare against the
 * open revisions, record the run and apply what changed. Every capture leaves a
 * run —`duplicate` when no number moved— because the run is what dates the
 * consensus a read uses.
 */
export async function recordConsensus(
  command: RecordConsensusCommand,
  dependencies: RecordConsensusDependencies,
): Promise<RecordConsensusOutcome> {
  const { securityId, symbol } = recordConsensusCommandSchema.parse(command);
  const { source, repository, ingestionRuns, now, newId, hashContent } =
    dependencies;

  const startedAt = now();
  const fetched = await source.load(symbol);
  const open = await repository.loadOpen(securityId);
  const plan = planConsensusRevisions({
    securityId,
    open,
    fetched: fetched.fiscalYears,
    observedAt: fetched.observedAt,
  });
  const base = {
    symbol,
    securityId,
    observedAt: fetched.observedAt,
    fiscalYears: fetched.fiscalYears.map((year) => ({
      periodEnd: year.periodEnd,
      epsAverage: year.epsAverage,
      epsAnalystCount: year.epsAnalystCount,
    })),
    quartersDropped: fetched.quartersDropped,
    byteLength: fetched.byteLength,
    plan,
  };
  if (dependencies.dryRun === true) {
    return { ...base, runId: null, runStatus: null };
  }

  const compared = plan.inserts.length + plan.unchanged;
  const changed = plan.inserts.length > 0;
  const contentHash = hashContent(
    JSON.stringify({
      securityId,
      fiscalYears: fetched.fiscalYears,
    }),
  );
  // The key is the transition: the same content over the same open state is
  // the same change, and a value that comes back later is a new one.
  const idempotencyKey = hashContent(
    JSON.stringify({
      securityId,
      from: open
        .map((row) => [row.periodEnd, row.revision])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      to: contentHash,
    }),
  );
  const finishedAt = now();
  const run = await ingestionRuns.append(
    ingestionRunSchema.parse({
      runId: newId(),
      sourceId: source.sourceId,
      datasetId: CONSENSUS_DATASET_ID,
      parserVersion: source.parserVersion,
      idempotencyKey,
      requestedAsOf: null,
      requestedVintage: null,
      cursor: null,
      nextCursor: null,
      subjectKey: securityId,
      selectionVersion: CONSENSUS_REVISIONS_VERSION,
      selectionAnchorOn: null,
      status: changed ? "succeeded" : "duplicate",
      startedAt,
      finishedAt,
      counts: changed
        ? { fetched: compared, accepted: compared, rejected: 0, duplicate: 0 }
        : { fetched: compared, accepted: 0, rejected: 0, duplicate: compared },
      contentHash,
      failure: null,
      qualityFlags: [
        ...(changed ? [] : ["duplicate_content"]),
        ...(plan.withdrawn > 0 ? ["fiscal_year_withdrawn"] : []),
      ],
      replayOfRunId: null,
      recordedAt: finishedAt,
    }),
  );
  if (changed) await repository.apply(plan, run.runId);

  return {
    ...base,
    runId: run.runId,
    runStatus: changed ? "succeeded" : "duplicate",
  };
}
