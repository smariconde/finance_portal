import { z } from "zod";

import type {
  CalendarRevision,
  EconomicPublication,
} from "./calendar-publication";
import { DECLARED_MACRO_RELEASES } from "./declared-macro-releases";
import { addCalendarDays, isoWeekday } from "./zoned-time";

export const FRED_CALENDAR_DATASET = "fred.release-calendar";
export const FRED_CALENDAR_PARSER = "fred-release-calendar-1.0.0";
export const FRED_CALENDAR_URL =
  "https://api.stlouisfed.org/fred/releases/dates";

const PAGE_SIZE = 1_000;
export const FRED_MAX_PAGES = 8;
const pageSchema = z.object({
  realtime_start: z.iso.date(),
  realtime_end: z.iso.date(),
  order_by: z.literal("release_date"),
  sort_order: z.literal("desc"),
  count: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.literal(PAGE_SIZE),
  release_dates: z
    .array(
      z.object({
        release_id: z.number().int().positive(),
        release_name: z.string().min(1),
        date: z.iso.date(),
      }),
    )
    .max(PAGE_SIZE),
});

function fredCalendarWindow(day: string) {
  return { from: addCalendarDays(day, -7), to: addCalendarDays(day, 98) };
}

export function fredCalendarPageUrl(day: string, page: number): string {
  const { from, to } = fredCalendarWindow(day);
  const url = new URL(FRED_CALENDAR_URL);
  url.search = new URLSearchParams({
    file_type: "json",
    realtime_start: from,
    realtime_end: to,
    include_release_dates_with_no_data: "true",
    order_by: "release_date",
    sort_order: "desc",
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  }).toString();
  return url.href;
}

export function parseFredCalendarPage(text: string, day: string, page: number) {
  const { from, to } = fredCalendarWindow(day);
  const parsed = pageSchema.safeParse(JSON.parse(text));
  if (
    !parsed.success ||
    parsed.data.offset !== page * PAGE_SIZE ||
    parsed.data.realtime_start !== from ||
    parsed.data.realtime_end !== to
  ) {
    throw new Error("fred_calendar_shape_changed");
  }
  const data = parsed.data;
  if (
    data.release_dates.length !==
      Math.min(PAGE_SIZE, Math.max(0, data.count - data.offset)) ||
    data.release_dates.some(
      (row, index) =>
        row.date < from ||
        row.date > to ||
        (index > 0 && row.date > data.release_dates[index - 1]!.date),
    )
  ) {
    throw new Error("fred_calendar_incomplete_page");
  }
  return {
    rows: data.release_dates,
    total: data.count,
    last: data.offset + data.release_dates.length >= data.count,
  };
}

type FredDate = ReturnType<typeof parseFredCalendarPage>["rows"][number];
export type PublicationEntry = {
  readonly key: string;
  readonly publication: EconomicPublication;
};

export function reconcileFredDates(
  rows: readonly FredDate[],
  previous: readonly CalendarRevision[],
  today: string,
): readonly PublicationEntry[] {
  const result: PublicationEntry[] = [];
  for (const release of DECLARED_MACRO_RELEASES) {
    const id = String(release.releaseId);
    const dates = [
      ...new Set(
        rows
          .filter((row) => row.release_id === release.releaseId)
          .map((row) => row.date),
      ),
    ].sort();
    const prior = previous.flatMap(({ key, event }) =>
      event.kind === "economic" && event.publication.id === id
        ? [{ key, publication: event.publication }]
        : [],
    );
    const matched = new Set<string>();
    const missing = prior.filter(
      ({ publication }) => !dates.includes(publication.date),
    );
    const added = dates.filter(
      (date) => !prior.some(({ publication }) => publication.date === date),
    );

    const bucket = (date: string) =>
      release.releaseId === 180
        ? addCalendarDays(date, 1 - isoWeekday(date))
        : date.slice(0, 7);

    for (const date of dates) {
      const exact = prior.find(({ publication }) => publication.date === date);
      const candidates = missing.filter(
        ({ publication }) => bucket(publication.date) === bucket(date),
      );
      const moved =
        candidates.length === 1 &&
        added.filter((newDate) => bucket(newDate) === bucket(date)).length === 1
          ? candidates[0]
          : undefined;
      const existing = exact ?? moved;
      const key = existing?.key ?? `fred:${id}:${date}`;
      matched.add(key);
      result.push({
        key,
        publication: {
          id,
          title: release.title,
          date,
          period: null,
          status: "scheduled",
        },
      });
    }
    for (const item of missing) {
      const date = item.publication.date;
      // A missing date beyond FRED's current horizon is not evidence of cancellation.
      if (
        date >= today &&
        dates.at(-1) &&
        date < dates.at(-1)! &&
        !matched.has(item.key)
      ) {
        result.push({
          key: item.key,
          publication: { ...item.publication, status: "cancelled" },
        });
      }
    }
  }
  return result;
}
