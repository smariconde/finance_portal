import { newYorkDate } from "@/modules/corporate-actions/domain/plan-listing-reconciliation";

/**
 * When a security's consensus is due (ADR 0083): once per New York day. It is
 * current if a capture of that day exists, or if a refresh job checked it that
 * day and failed —a failure is not replanned on its own; the page offers
 * «Reintentar», so no visit loops against a symbol the source rejects.
 */
export const CONSENSUS_FRESHNESS_VERSION = "consensus-freshness-1.0.0";

export type ConsensusCheck = {
  /** When the job that checked it was created: a lower bound of the check. */
  readonly checkedAt: string;
  readonly failed: boolean;
};

export type ConsensusFreshness =
  | { readonly status: "fresh"; readonly capturedAt: string }
  | { readonly status: "failed"; readonly capturedAt: string | null }
  | { readonly status: "stale"; readonly capturedAt: string | null };

export function assessConsensusFreshness(input: {
  /** Capture instants, any order. */
  readonly captures: readonly string[];
  readonly lastCheck: ConsensusCheck | null;
  readonly now: string;
  readonly retryFailures: boolean;
}): ConsensusFreshness {
  const today = newYorkDate(input.now);
  const capturedAt =
    [...input.captures].sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ??
    null;
  if (capturedAt !== null && newYorkDate(capturedAt) === today) {
    return { status: "fresh", capturedAt };
  }
  const check = input.lastCheck;
  if (
    check !== null &&
    check.failed &&
    !input.retryFailures &&
    newYorkDate(check.checkedAt) === today
  ) {
    return { status: "failed", capturedAt };
  }
  return { status: "stale", capturedAt };
}
