/**
 * When a series of `/argentina` is due for another look (`F9-12`). None of
 * the sources dates its publications, so the rule is about checks, not about
 * data: a subject is fresh once somebody asked the source after the moment its
 * next publication could exist. Asking again before that spends quota for
 * nothing; a holiday simply leaves the check in place until the next one.
 */
export const ARGENTINA_REFRESH_RULE_VERSION =
  "argentina-refresh-freshness-1.0.0";

export type RefreshCadence = "daily" | "monthly";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Buenos Aires is UTC−3 all year. A business day's figures are taken as
 * published from 20:00 there (23:00 UTC): the BCRA posts its daily series in
 * the evening and the local market closes at 17:00.
 */
const DAILY_SETTLE_UTC_HOUR = 23;
const BUENOS_AIRES_OFFSET_HOURS = 3;

function utcDay(instantMs: number): Date {
  const date = new Date(instantMs);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/** The latest weekday whose 23:00 UTC has already passed. */
export function lastDailySettledAt(now: string): string {
  const nowMs = Date.parse(now);
  let day = utcDay(nowMs);
  for (let step = 0; step < 8; step += 1) {
    const weekday = day.getUTCDay();
    const settled = day.getTime() + DAILY_SETTLE_UTC_HOUR * HOUR_MS;
    if (weekday !== 0 && weekday !== 6 && settled <= nowMs) {
      return new Date(settled).toISOString();
    }
    day = new Date(day.getTime() - DAY_MS);
  }
  throw new Error("no_settled_weekday");
}

/** Midnight in Buenos Aires of the current local day, as a UTC instant. */
export function startOfBuenosAiresDay(now: string): string {
  const local = Date.parse(now) - BUENOS_AIRES_OFFSET_HOURS * HOUR_MS;
  return new Date(
    utcDay(local).getTime() + BUENOS_AIRES_OFFSET_HOURS * HOUR_MS,
  ).toISOString();
}

/** A check at or after this instant makes a subject fresh. */
export function freshSince(cadence: RefreshCadence, now: string): string {
  return cadence === "daily"
    ? lastDailySettledAt(now)
    : startOfBuenosAiresDay(now);
}

/** Subjects without a check since the cadence's threshold, in plan order. */
export function selectStaleSubjects(input: {
  readonly subjects: readonly string[];
  readonly lastChecks: ReadonlyMap<string, string>;
  readonly cadence: RefreshCadence;
  readonly now: string;
}): readonly string[] {
  const since = Date.parse(freshSince(input.cadence, input.now));
  return input.subjects.filter((subject) => {
    const checked = input.lastChecks.get(subject);
    return checked === undefined || Date.parse(checked) < since;
  });
}
