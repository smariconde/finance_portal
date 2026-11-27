import type { SummaryMetric } from "./summary-change";

/**
 * How current each figure of `/argentina` is (`argentina-freshness-1.0.0`,
 * `F9-22`). The page draws what is stored while the refresh of ADR 0070 asks
 * the sources; until a source answers, a figure it feeds may not be the
 * latest one that exists. This rule says, for every tile and block, which of
 * four states it is in:
 *
 * - `verified`: every source it reads was asked after the moment its next
 *   publication could exist, and answered;
 * - `verifying`: a source it reads is due or being asked right now;
 * - `unverified`: a source it reads was asked and did not bring anything, or
 *   is stopped (kill switch, quota, credential);
 * - `manual`: the series only arrives through a hand-run command and the
 *   page never asks for it (the ITCRM, ADR 0074; the REM rounds, ADR 0075).
 *
 * The state records **checks** against the configured cadence. The
 * publication calendar separately indicates whether a period is still due.
 */
export const ARGENTINA_FRESHNESS_VERSION = "argentina-freshness-1.0.0";

/** What happened to one source of the refresh, as the page sees it. */
export type SourceFreshnessState = "checked" | "pending" | "failed" | "blocked";

export type SourceFreshness = {
  readonly sourceId: string;
  /** How the page names the source. */
  readonly label: string;
  readonly state: SourceFreshnessState;
  /**
   * The oldest last check among the source's subjects, when every subject
   * has one; `null` when unknown (a check the page has not re-read yet).
   */
  readonly checkedAt: string | null;
};

/** A part of the page that reads the same sources. */
export type FreshnessGroup =
  | "activity"
  | "dollar"
  | "monetary"
  | "countryRisk"
  | "fiscal"
  | "trade"
  | "soy"
  | "itcrm"
  | "rem";

type GroupSources =
  | { readonly kind: "refreshed"; readonly sources: readonly string[] }
  | { readonly kind: "manual" };

/**
 * The refresh sources each group reads. A source id here that the refresh
 * does not declare breaks a test of the application layer.
 */
export const FRESHNESS_GROUP_SOURCES: Readonly<
  Record<FreshnessGroup, GroupSources>
> = {
  activity: { kind: "refreshed", sources: ["indec-api"] },
  dollar: {
    kind: "refreshed",
    sources: ["bcra-monetarias-v4", "yahoo-finance"],
  },
  monetary: { kind: "refreshed", sources: ["bcra-monetarias-v4"] },
  countryRisk: { kind: "refreshed", sources: ["ambito-riesgo-pais"] },
  fiscal: { kind: "refreshed", sources: ["argentina-series-tiempo"] },
  trade: { kind: "refreshed", sources: ["argentina-series-tiempo"] },
  soy: {
    kind: "refreshed",
    sources: [
      "bcr-cac-pizarra",
      "bna-fx",
      "yahoo-finance",
      "magyp-estimaciones",
    ],
  },
  itcrm: { kind: "manual" },
  rem: { kind: "manual" },
};

/** The group each summary tile reads. */
export const SUMMARY_FRESHNESS_GROUP: Readonly<
  Record<SummaryMetric, FreshnessGroup>
> = {
  activity: "activity",
  fxGap: "dollar",
  inflation: "monetary",
  countryRisk: "countryRisk",
  tradeBalance: "trade",
  soyGap: "soy",
};

/** The group each block of the page reads, by its anchor. */
export const BLOCK_FRESHNESS_GROUP: Readonly<Record<string, FreshnessGroup>> = {
  actividad: "activity",
  dolar: "dollar",
  itcrm: "itcrm",
  "riesgo-pais": "countryRisk",
  monetario: "monetary",
  "rem-inflacion": "rem",
  fiscal: "fiscal",
  externo: "trade",
  soja: "soy",
};

export type GroupFreshness =
  | { readonly state: "verified"; readonly checkedAt: string | null }
  | { readonly state: "verifying"; readonly sources: readonly string[] }
  | { readonly state: "unverified"; readonly sources: readonly string[] }
  | { readonly state: "manual" };

/**
 * The state of a group from the state of its sources. Any source being asked
 * makes the group `verifying`, before a failure of another: the figure may
 * still change. `null` when a source is unknown —the readiness read failed—:
 * the page then says nothing rather than claim a state.
 */
export function groupFreshness(
  group: FreshnessGroup,
  sources: readonly SourceFreshness[],
): GroupFreshness | null {
  const declared = FRESHNESS_GROUP_SOURCES[group];
  if (declared.kind === "manual") return { state: "manual" };
  const byId = new Map(sources.map((source) => [source.sourceId, source]));
  const read = declared.sources.map((sourceId) => byId.get(sourceId));
  if (read.some((source) => source === undefined)) return null;
  const known = read as readonly SourceFreshness[];

  const pending = known.filter((source) => source.state === "pending");
  if (pending.length > 0) {
    return { state: "verifying", sources: pending.map(labelOf) };
  }
  const troubled = known.filter(
    (source) => source.state === "failed" || source.state === "blocked",
  );
  if (troubled.length > 0) {
    return { state: "unverified", sources: troubled.map(labelOf) };
  }
  const checks = known.map((source) => source.checkedAt);
  return {
    state: "verified",
    checkedAt: checks.some((checkedAt) => checkedAt === null)
      ? null
      : (checks as string[]).sort()[0]!,
  };
}

function labelOf(source: SourceFreshness): string {
  return source.label;
}

/**
 * The sources as the page should show them: what the server read when it
 * drew the page, overridden source by source by what the refresh reported
 * since. A live `checked` without an instant keeps the server's instant only
 * when the server already saw that check.
 */
export function mergeSourceFreshness(
  rendered: readonly SourceFreshness[],
  live: readonly SourceFreshness[] | null,
): readonly SourceFreshness[] {
  if (live === null) return rendered;
  const latest = new Map(live.map((source) => [source.sourceId, source]));
  return rendered.map((source) => {
    const update = latest.get(source.sourceId);
    if (update === undefined) return source;
    if (
      update.state === "checked" &&
      update.checkedAt === null &&
      source.state === "checked"
    ) {
      return source;
    }
    return update;
  });
}

/** Sources that finished (checked or failed) in `next` but not in `previous`. */
export function newlySettledSources(
  previous: readonly SourceFreshness[],
  next: readonly SourceFreshness[],
): readonly string[] {
  const before = new Map(
    previous.map((source) => [source.sourceId, source.state]),
  );
  return next
    .filter(
      (source) =>
        (source.state === "checked" || source.state === "failed") &&
        before.get(source.sourceId) === "pending",
    )
    .map((source) => source.sourceId);
}
