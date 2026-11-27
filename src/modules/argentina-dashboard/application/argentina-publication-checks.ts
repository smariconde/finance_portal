import type { ArgentinaIndicatorRepository } from "@/modules/macro-series/application/argentina-indicator-repository";
import { DECLARED_ARGENTINA_INDICATORS } from "@/modules/macro-series/domain/declared-argentina-indicators";
import {
  hasPublicationPeriod,
  latestArgentinePublications,
  publicationDueAt,
} from "@/modules/market-calendar/domain/expected-argentina-publications";
import {
  BUENOS_AIRES,
  calendarDateIn,
} from "@/modules/market-calendar/domain/zoned-time";

import {
  laterCheckThreshold,
  startOfBuenosAiresDay,
} from "../domain/refresh-freshness";
import type { FreshnessGroup } from "../domain/surface-freshness";
import { REM_OBSERVED_IPC_ID } from "./argentina-refresh";

const SUBJECTS: Readonly<Partial<Record<FreshnessGroup, readonly string[]>>> = {
  activity: DECLARED_ARGENTINA_INDICATORS.filter(
    ({ block }) => block === "activity",
  ).map(({ id }) => id),
  trade: DECLARED_ARGENTINA_INDICATORS.filter(
    ({ block }) => block === "external",
  ).map(({ id }) => id),
  fiscal: DECLARED_ARGENTINA_INDICATORS.filter(
    ({ block, frequency }) => block === "fiscal" && frequency === "monthly",
  ).map(({ id }) => id),
  monetary: [REM_OBSERVED_IPC_ID],
};

/** For an outstanding period, allow one check on release day after its expected
 * time and one per local day afterwards. The ordinary source controls still apply. */
export async function argentinaPublicationChecks(
  events: Parameters<typeof latestArgentinePublications>[0],
  now: string,
  indicators: Pick<ArgentinaIndicatorRepository, "latestPublishedPeriods">,
): Promise<ReadonlyMap<string, string>> {
  const effectiveOn = calendarDateIn(now, BUENOS_AIRES);
  const pendingChecks = new Map<string, { period: string; since: string }>();
  const dayStart = startOfBuenosAiresDay(now);
  for (const [group, event] of latestArgentinePublications(
    events,
    effectiveOn,
  )) {
    const dueAt = publicationDueAt(event);
    if (dueAt > now) continue;
    for (const subject of SUBJECTS[group] ?? []) {
      pendingChecks.set(subject, {
        period: event.period,
        since: laterCheckThreshold(dayStart, dueAt),
      });
    }
  }
  if (pendingChecks.size === 0) return new Map();

  const published = await indicators.latestPublishedPeriods({
    indicatorIds: [...pendingChecks.keys()],
    effectiveOn,
    knownAt: now,
  });
  const checks = new Map<string, string>();
  for (const [subject, { period, since }] of pendingChecks) {
    if (!hasPublicationPeriod(published.get(subject), period)) {
      checks.set(subject, since);
    }
  }
  return checks;
}
