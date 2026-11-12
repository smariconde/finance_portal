import type { FetchedRemRelease } from "./live-bcra-rem-release";
import type { RemForecastVintage } from "../domain/plan-rem-release";

export interface RemForecastRepository {
  readonly storage: "personal-postgres";
  open(roundMonth: string): Promise<readonly RemForecastVintage[]>;
  /** Target month is effective time; latest known revision of each round. */
  asKnown(input: {
    readonly targetMonth: string;
    readonly knownAt: string;
    readonly knowledgeBasis: "public_availability" | "system_recorded";
  }): Promise<readonly RemForecastVintage[]>;
  latestRoundAsKnown(input: {
    readonly knownAt: string;
    readonly knowledgeBasis: "public_availability" | "system_recorded";
  }): Promise<readonly RemForecastVintage[]>;
  /** Replans under a round lock, then writes the run and vintages atomically. */
  publish(input: {
    readonly release: FetchedRemRelease;
    readonly runId: string;
    readonly startedAt: string;
  }): Promise<{
    readonly status: "succeeded" | "duplicate";
    readonly accepted: number;
  }>;
}
