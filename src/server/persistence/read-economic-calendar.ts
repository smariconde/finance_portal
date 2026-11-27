import "server-only";

import type { EconomicPublication } from "@/modules/market-calendar/domain/calendar-publication";
import {
  DECLARED_MACRO_RELEASES,
  FOMC_CONSULTED_ON,
  FOMC_MEETINGS,
  FOMC_REVISION_SOURCE,
  FOMC_SOURCE,
} from "@/modules/market-calendar/domain/declared-macro-releases";
import { FRED_CALENDAR_DATASET } from "@/modules/market-calendar/domain/fred-release-calendar";
import {
  BUENOS_AIRES,
  calendarDateIn,
  instantAt,
  NEW_YORK,
  wallTimeIn,
} from "@/modules/market-calendar/domain/zoned-time";
import { createPostgresCalendarRepository } from "@/server/db/postgres-calendar-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

export type EconomicAgendaRow = EconomicPublication & {
  readonly key: string;
  readonly source: string;
  readonly sourceUrl: string;
  readonly observedOn: string;
  readonly time: string | null;
  readonly usualTime: boolean;
  readonly previousDate: string | null;
  readonly important: boolean;
};

function repository() {
  return createPostgresCalendarRepository(getRuntimeDatabase());
}

function easternTimeInBuenosAires(date: string, time: string): string {
  return wallTimeIn(instantAt(date, time, NEW_YORK), BUENOS_AIRES);
}

export async function readUnitedStatesCalendar(
  at: string,
  personal: boolean,
): Promise<EconomicAgendaRow[]> {
  const captured = personal
    ? await repository()
        .read(FRED_CALENDAR_DATASET, at)
        .catch(() => null)
    : null;
  const rows: EconomicAgendaRow[] = (captured?.events ?? []).flatMap(
    ({ key, event, previous, observedAt }) => {
      if (event.kind !== "economic") return [];
      const release = DECLARED_MACRO_RELEASES.find(
        ({ releaseId }) => String(releaseId) === event.publication.id,
      );
      if (!release) return [];
      return [
        {
          ...event.publication,
          key,
          source: `FRED · ${release.agency}`,
          sourceUrl: `https://fred.stlouisfed.org/release?rid=${release.releaseId}`,
          observedOn: calendarDateIn(observedAt, NEW_YORK),
          time: easternTimeInBuenosAires(event.publication.date, release.time),
          usualTime: true,
          previousDate:
            previous?.kind === "economic" ? previous.publication.date : null,
          important: release.high,
        },
      ];
    },
  );
  if (calendarDateIn(at, NEW_YORK) < FOMC_CONSULTED_ON) return rows;
  for (const [start, date, kind] of FOMC_MEETINGS) {
    rows.push({
      key: `fed:${date}`,
      id: "fomc",
      title:
        kind === "strategy"
          ? "FOMC · Reunión de estrategia"
          : "FOMC · Decisión de política monetaria",
      date,
      period: null,
      status: "scheduled",
      source: "Reserva Federal",
      sourceUrl: start >= "2027-01-01" ? FOMC_REVISION_SOURCE : FOMC_SOURCE,
      observedOn: FOMC_CONSULTED_ON,
      time:
        kind === "strategy" ? null : easternTimeInBuenosAires(date, "14:00"),
      usualTime: kind !== "strategy",
      previousDate: null,
      important: true,
    });
  }
  rows.push({
    key: "fed:2027-12-08",
    id: "fomc",
    title: "FOMC · Reunión de diciembre",
    date: "2027-12-08",
    period: null,
    status: "cancelled",
    source: "Reserva Federal",
    sourceUrl: FOMC_REVISION_SOURCE,
    observedOn: FOMC_CONSULTED_ON,
    time: null,
    usualTime: false,
    previousDate: null,
    important: true,
  });
  return rows;
}
