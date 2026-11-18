import type { FiscalYearEstimate } from "./earnings-estimates-parser";

/**
 * Each fiscal year of each security is a revision chain (ADR 0083), like the
 * BCRA's points: a new revision only when a number changes, availability is
 * the capture —the source dates nothing— and a fiscal year that stops coming
 * is withdrawn, which is what happens once the company reports it.
 */
export const CONSENSUS_REVISIONS_VERSION = "consensus-revisions-1.0.0";

/** The numbers of one revision; all `null` when it is a withdrawal. */
export type ConsensusValues = Omit<FiscalYearEstimate, "periodEnd">;

export type ConsensusRevision = {
  readonly securityId: string;
  readonly periodEnd: string;
  readonly revision: number;
  /** `null` exactly when withdrawn. */
  readonly values: ConsensusValues | null;
  readonly availableAt: string;
  readonly supersededAt: string | null;
  readonly ingestionRunId: string;
};

export type ConsensusRevisionPlan = {
  /** New revisions, with the run ID left to the recorder. */
  readonly inserts: readonly Omit<ConsensusRevision, "ingestionRunId">[];
  /** Open revisions that the inserts close at `observedAt`. */
  readonly supersede: readonly {
    readonly periodEnd: string;
    readonly revision: number;
  }[];
  readonly unchanged: number;
  readonly withdrawn: number;
};

export function valuesOf(estimate: FiscalYearEstimate): ConsensusValues {
  const { periodEnd: _periodEnd, ...values } = estimate;
  void _periodEnd;
  return values;
}

/** Field by field, in a fixed order, so equal numbers compare equal. */
export function sameValues(
  a: ConsensusValues | null,
  b: ConsensusValues | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (Object.keys(a) as (keyof ConsensusValues)[]).every(
    (key) => a[key] === b[key],
  );
}

export class ConsensusRevisionError extends Error {
  constructor(
    readonly code: "capture_not_after_open_revision" | "open_revision_conflict",
  ) {
    super(code);
    this.name = "ConsensusRevisionError";
  }
}

/**
 * What a capture changes against the open revisions of one security. `open`
 * holds at most one revision per fiscal year, withdrawn ones included.
 */
export function planConsensusRevisions(input: {
  readonly securityId: string;
  readonly open: readonly ConsensusRevision[];
  readonly fetched: readonly FiscalYearEstimate[];
  readonly observedAt: string;
}): ConsensusRevisionPlan {
  const openByPeriod = new Map<string, ConsensusRevision>();
  for (const revision of input.open) {
    if (
      revision.securityId !== input.securityId ||
      revision.supersededAt !== null ||
      openByPeriod.has(revision.periodEnd)
    ) {
      throw new ConsensusRevisionError("open_revision_conflict");
    }
    // A revision must stay visible for some time before it is superseded.
    if (revision.availableAt >= input.observedAt) {
      throw new ConsensusRevisionError("capture_not_after_open_revision");
    }
    openByPeriod.set(revision.periodEnd, revision);
  }

  const inserts: Omit<ConsensusRevision, "ingestionRunId">[] = [];
  const supersede: { periodEnd: string; revision: number }[] = [];
  let unchanged = 0;
  let withdrawn = 0;
  const seen = new Set<string>();

  const change = (periodEnd: string, values: ConsensusValues | null) => {
    const previous = openByPeriod.get(periodEnd);
    if (previous !== undefined && sameValues(previous.values, values)) {
      unchanged += 1;
      return;
    }
    if (previous === undefined && values === null) return;
    if (previous !== undefined) {
      supersede.push({ periodEnd, revision: previous.revision });
    }
    if (values === null) withdrawn += 1;
    inserts.push({
      securityId: input.securityId,
      periodEnd,
      revision: previous === undefined ? 0 : previous.revision + 1,
      values,
      availableAt: input.observedAt,
      supersededAt: null,
    });
  };

  for (const estimate of input.fetched) {
    seen.add(estimate.periodEnd);
    change(estimate.periodEnd, valuesOf(estimate));
  }
  for (const [periodEnd, previous] of openByPeriod) {
    if (seen.has(periodEnd) || previous.values === null) continue;
    change(periodEnd, null);
  }

  inserts.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  supersede.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  return { inserts, supersede, unchanged, withdrawn };
}

/**
 * The fiscal years in force at an instant: the revision visible then, unless
 * it is a withdrawal.
 */
export function consensusAt(
  revisions: readonly ConsensusRevision[],
  knownAt: string,
): readonly { readonly periodEnd: string; readonly values: ConsensusValues }[] {
  const at = Date.parse(knownAt);
  const visible = new Map<string, ConsensusRevision>();
  for (const revision of revisions) {
    if (Date.parse(revision.availableAt) > at) continue;
    if (
      revision.supersededAt !== null &&
      Date.parse(revision.supersededAt) <= at
    ) {
      continue;
    }
    visible.set(revision.periodEnd, revision);
  }
  return [...visible.values()]
    .filter(
      (revision): revision is ConsensusRevision & { values: ConsensusValues } =>
        revision.values !== null,
    )
    .map((revision) => ({
      periodEnd: revision.periodEnd,
      values: revision.values,
    }))
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}
