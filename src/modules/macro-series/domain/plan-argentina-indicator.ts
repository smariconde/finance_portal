import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import {
  argentinaIndicatorVintageSchema,
  type ArgentinaIndicator,
  type ArgentinaIndicatorVintage,
  type IndecConventionalSign,
} from "./argentina-indicator";

/** A point as a source adapter hands it over, before it becomes a vintage. */
export type FetchedIndicatorPoint = {
  readonly periodOn: string;
  readonly value: string | null;
  /** The source's conventional sign for the point, when it prints one. */
  readonly note?: IndecConventionalSign | null;
};

export type ArgentinaDefinitionVersion = {
  readonly indicatorId: string;
  readonly revision: number;
  readonly definition: ArgentinaIndicator;
  readonly contentHash: string;
  readonly availableAt: string;
  readonly supersededAt: string | null;
  readonly sourceRunId: string;
};

export type ArgentinaIndicatorPlan = {
  readonly definition: ArgentinaDefinitionVersion | null;
  readonly observations: readonly ArgentinaIndicatorVintage[];
  readonly counts: {
    readonly new: number;
    readonly revised: number;
    readonly withdrawn: number;
    readonly unchanged: number;
  };
  readonly guard: {
    readonly compared: number;
    readonly changed: number;
    readonly refused: boolean;
  };
};

/** Full-history refresh: a missing date is a withdrawal, not an invented zero. */
export function planArgentinaIndicator(input: {
  readonly indicator: ArgentinaIndicator;
  readonly currentDefinition: ArgentinaDefinitionVersion | null;
  readonly open: readonly ArgentinaIndicatorVintage[];
  readonly fetched: readonly FetchedIndicatorPoint[];
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly runId: string;
  readonly acceptMassChange: boolean;
}): ArgentinaIndicatorPlan {
  const { indicator, currentDefinition, observedAt, recordedAt, runId } = input;
  const hash = computeContentHash(indicator);
  if (currentDefinition && currentDefinition.indicatorId !== indicator.id) {
    throw new Error("definition_indicator_mismatch");
  }
  if (
    currentDefinition &&
    Date.parse(observedAt) <= Date.parse(currentDefinition.availableAt)
  ) {
    throw new Error("non_monotone_definition_time");
  }
  const definition =
    currentDefinition?.contentHash === hash
      ? null
      : {
          indicatorId: indicator.id,
          revision: currentDefinition ? currentDefinition.revision + 1 : 0,
          definition: indicator,
          contentHash: hash,
          availableAt: observedAt,
          supersededAt: null,
          sourceRunId: runId,
        };
  const byDate = new Map<string, ArgentinaIndicatorVintage>();
  for (const point of input.open) {
    if (point.indicatorId !== indicator.id || byDate.has(point.periodOn)) {
      throw new Error("open_observation_conflict");
    }
    byDate.set(point.periodOn, point);
  }
  const observations: ArgentinaIndicatorVintage[] = [];
  const fetchedDates = new Set<string>();
  let revised = 0;
  let unchanged = 0;
  for (const point of input.fetched) {
    if (fetchedDates.has(point.periodOn))
      throw new Error("duplicate_source_period");
    fetchedDates.add(point.periodOn);
    const previous = byDate.get(point.periodOn);
    const missingReason = point.value === null ? "source_null" : null;
    const sourceNote = point.note ?? null;
    if (
      previous?.value === point.value &&
      previous.missingReason === missingReason &&
      previous.sourceNote === sourceNote &&
      previous.segment === indicator.segment
    ) {
      unchanged += 1;
      continue;
    }
    if (previous) revised += 1;
    observations.push(
      argentinaIndicatorVintageSchema.parse({
        indicatorId: indicator.id,
        periodOn: point.periodOn,
        value: point.value,
        missingReason,
        sourceNote,
        availableAt: observedAt,
        recordedAt,
        revision: previous ? previous.revision + 1 : 0,
        segment: indicator.segment,
        sourceRunId: runId,
      }),
    );
  }
  let withdrawn = 0;
  for (const previous of input.open) {
    if (
      fetchedDates.has(previous.periodOn) ||
      previous.missingReason === "withdrawn"
    )
      continue;
    withdrawn += 1;
    observations.push(
      argentinaIndicatorVintageSchema.parse({
        indicatorId: indicator.id,
        periodOn: previous.periodOn,
        value: null,
        missingReason: "withdrawn",
        sourceNote: null,
        availableAt: observedAt,
        recordedAt,
        revision: previous.revision + 1,
        segment: indicator.segment,
        sourceRunId: runId,
      }),
    );
  }
  const compared = input.open.length;
  const changed = revised + withdrawn;
  const refused =
    !input.acceptMassChange && compared >= 20 && changed > compared * 0.1;
  return {
    definition: refused ? null : definition,
    observations: refused
      ? []
      : observations.sort((a, b) => a.periodOn.localeCompare(b.periodOn)),
    counts: {
      new: observations.length - revised - withdrawn,
      revised,
      withdrawn,
      unchanged,
    },
    guard: { compared, changed, refused },
  };
}
