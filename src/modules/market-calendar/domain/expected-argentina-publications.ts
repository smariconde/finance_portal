import type { FreshnessGroup } from "@/modules/argentina-dashboard/domain/surface-freshness";

import type { EconomicPublication } from "./calendar-publication";
import {
  addCalendarDays,
  BUENOS_AIRES,
  calendarDateIn,
  instantAt,
} from "./zoned-time";

const RELEASE_GROUP: Readonly<Partial<Record<string, FreshnessGroup>>> = {
  ipc: "monetary",
  emae: "activity",
  ica: "trade",
  fiscal: "fiscal",
  rem: "rem",
};

type TimedPublication = EconomicPublication & { readonly time: string | null };
type ScheduledPublication = TimedPublication & { readonly period: string };

export type ExpectedPublication = {
  readonly title: string;
  readonly period: string;
  readonly state: "today" | "pending";
};

export type ExpectedPublications = Readonly<
  Partial<Record<FreshnessGroup, ExpectedPublication>>
>;

/** The most recent scheduled period through the given local date, per group. */
export function latestArgentinePublications(
  events: readonly TimedPublication[],
  today: string,
): ReadonlyMap<FreshnessGroup, ScheduledPublication> {
  const latest = new Map<FreshnessGroup, ScheduledPublication>();
  for (const event of events) {
    const group = RELEASE_GROUP[event.id];
    if (
      !group ||
      event.date > today ||
      event.period === null ||
      event.status !== "scheduled"
    ) {
      continue;
    }
    const previous = latest.get(group);
    if (!previous || event.period > previous.period) {
      latest.set(group, { ...event, period: event.period });
    }
  }
  return latest;
}

/** Without a published time, allow the whole local publication day. */
export function publicationDueAt(event: TimedPublication): string {
  return event.time === null
    ? instantAt(addCalendarDays(event.date, 1), "00:00", BUENOS_AIRES)
    : instantAt(event.date, event.time, BUENOS_AIRES);
}

export function hasPublicationPeriod(
  present: string | null | undefined,
  expected: string,
): boolean {
  return present != null && present.slice(0, 7) >= expected.slice(0, 7);
}

export function expectedArgentinePublications(
  events: readonly TimedPublication[],
  now: string,
  present: Readonly<Partial<Record<FreshnessGroup, string | null>>>,
): ExpectedPublications {
  const result: Partial<Record<FreshnessGroup, ExpectedPublication>> = {};
  for (const [group, event] of latestArgentinePublications(
    events,
    calendarDateIn(now, BUENOS_AIRES),
  )) {
    if (hasPublicationPeriod(present[group], event.period)) continue;
    result[group] = {
      title: event.title,
      period: event.period,
      state: now < publicationDueAt(event) ? "today" : "pending",
    };
  }
  return result;
}
