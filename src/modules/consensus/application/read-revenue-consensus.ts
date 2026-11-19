import { consensusAt } from "../domain/consensus-revisions";
import type { ConsensusRepository } from "./consensus-repository";

/**
 * The revenue consensus a valuation reads at its cutoff (`F6-39`, ADR 0085):
 * every fiscal year in force, with the revision's availability, and the last
 * capture visible then, which is what dates the consensus. A capture after the
 * cutoff never reaches it.
 */
export type RevenueConsensusReading = {
  readonly years: readonly {
    readonly periodEnd: string;
    readonly revenueAverage: string | null;
    readonly revenueLow: string | null;
    readonly revenueHigh: string | null;
    readonly analystCount: number | null;
    readonly availableAt: string;
  }[];
  readonly capturedAt: string | null;
};

export async function readRevenueConsensusAt(
  input: { readonly securityId: string; readonly knownAt: string },
  repository: Pick<ConsensusRepository, "loadRevisions" | "captures">,
): Promise<RevenueConsensusReading> {
  const [revisions, captures] = await Promise.all([
    repository.loadRevisions(input.securityId),
    repository.captures(input.securityId),
  ]);
  const cutoff = Date.parse(input.knownAt);
  const capturedAt =
    captures
      .filter((capture) => Date.parse(capture) <= cutoff)
      .sort((left, right) => Date.parse(left) - Date.parse(right))
      .at(-1) ?? null;

  return {
    capturedAt,
    years: consensusAt(revisions, input.knownAt).map((year) => ({
      periodEnd: year.periodEnd,
      revenueAverage: year.values.revenueAverage,
      revenueLow: year.values.revenueLow,
      revenueHigh: year.values.revenueHigh,
      analystCount: year.values.revenueAnalystCount,
      availableAt: year.availableAt,
    })),
  };
}
