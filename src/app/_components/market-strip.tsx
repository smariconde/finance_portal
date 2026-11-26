import { CalendarClock } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { servesRealData } from "@/modules/configuration/domain/config-health";
import { buildFinvizScreenerUrl } from "@/modules/finviz-screener/domain/finviz-screener-url";
import { reportsToday } from "@/modules/market-calendar/domain/earnings-exposure";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { readUnitedStatesCalendar } from "@/server/persistence/read-economic-calendar";
import { readEarningsCalendar } from "@/server/persistence/read-earnings-calendar";
import { CalendarRefreshOnOpen } from "./calendar-refresh-on-open";
import { cn } from "@/lib/utils";
import {
  marketMomentAt,
  nextClockShift,
  type MarketDay,
  type MarketMoment,
} from "@/modules/market-calendar/domain/market-sessions";
import { addCalendarDays } from "@/modules/market-calendar/domain/zoned-time";

import { BrokerSessionMark } from "./broker-session-mark";
import { shortMarketDate } from "./market-format";

/** Un cambio de horario se anuncia con tres semanas de anticipación. */
const SHIFT_NOTICE_DAYS = 21;

type Tone = "open" | "early" | "closed";

const DOT: Readonly<Record<Tone, string>> = {
  open: "bg-emerald-600 dark:bg-emerald-400",
  early: "bg-amber-500 dark:bg-amber-400",
  closed: "bg-muted-foreground/60",
};

function todayReading(moment: MarketMoment): {
  readonly tone: Tone;
  readonly text: string;
} {
  const { today, phase } = moment;
  const early = today.status === "early_close";
  const hours = today.regular;
  switch (phase) {
    case "open":
      return {
        tone: early ? "early" : "open",
        text: `Abierta hasta las ${hours!.close.buenosAires}${early ? " · cierre temprano" : ""}`,
      };
    case "before_open":
      return {
        tone: early ? "early" : "open",
        text: `Abre a las ${hours!.open.buenosAires}${early ? ` · cierra ${hours!.close.buenosAires}` : ""}`,
      };
    case "after_close":
      return {
        tone: "closed",
        text: `Cerró a las ${hours!.close.buenosAires}`,
      };
    case "closed_day":
      return {
        tone: "closed",
        text:
          today.status === "holiday"
            ? `Cerrada · ${today.note}`
            : "Cerrada · fin de semana",
      };
    case "undeclared":
      return { tone: "closed", text: "Sin calendario declarado" };
  }
}

function nextSession(moment: MarketMoment): MarketDay | null {
  // Antes de abrir, la próxima sesión es la de hoy y ya está dicha.
  if (moment.phase === "before_open") return null;
  return moment.nextOpen;
}

/**
 * La bolsa de Nueva York hoy y en la próxima sesión, en hora de Buenos Aires
 * (`F12-01`, `market-sessions-1.0.0`). Lee sólo la tabla declarada, que es
 * código: no abre la base ni la red, así que se dibuja en cualquier modo.
 */
export async function MarketStrip({
  withLink = true,
  corroborate = false,
  className,
}: {
  readonly withLink?: boolean;
  /** Pregunta a Schwab al dibujarse (`/calendario` y `/cuenta`). */
  readonly corroborate?: boolean;
  readonly className?: string;
}) {
  await connection();
  const at = new Date().toISOString();
  const moment = marketMomentAt(at);
  const personal = servesRealData(await getRequestConfigHealth());
  const [calendar, us] = await Promise.all([
    personal
      ? readEarningsCalendar(at, { includeFollowed: true }).catch(() => null)
      : null,
    readUnitedStatesCalendar(at, personal),
  ]);
  const todayReports = [
    ...new Set(
      calendar?.reports
        .filter((report) => reportsToday(report, at))
        .map((report) => report.symbol),
    ),
  ];

  const today = todayReading(moment);
  const next = nextSession(moment);
  const shift = nextClockShift(moment.today.date, SHIFT_NOTICE_DAYS);
  const tomorrow = addCalendarDays(moment.today.date, 1);
  const macro = us.filter(
    (event) =>
      event.important &&
      event.status === "scheduled" &&
      (event.date === moment.today.date || event.date === tomorrow),
  );

  return (
    <section
      aria-label="Bolsa de Nueva York, en hora de Buenos Aires"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border bg-card px-3 py-2 text-sm",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 font-medium">
        <CalendarClock
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        NYSE
        <span className="text-xs font-normal text-muted-foreground">
          hora BA
        </span>
      </span>

      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Hoy</span>
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", DOT[today.tone])}
        />
        <span className="numeric">{today.text}</span>
      </span>

      {next === null || next.regular === null ? null : (
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">
            {next.date === tomorrow ? "Mañana" : shortMarketDate(next.date)}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              DOT[next.status === "early_close" ? "early" : "open"],
            )}
          />
          <span className="numeric">
            {next.regular.open.buenosAires}–{next.regular.close.buenosAires}
          </span>
          {next.status === "early_close" ? (
            <span>· cierre temprano</span>
          ) : null}
        </span>
      )}

      {shift === null ? null : (
        <span className="text-muted-foreground">
          Desde el {shortMarketDate(shift.date)} abre a las{" "}
          <span className="numeric text-foreground">
            {shift.openBuenosAires}
          </span>
        </span>
      )}

      {corroborate ? <BrokerSessionMark /> : null}

      {personal ? <CalendarRefreshOnOpen /> : null}

      {personal && moment.today.regular !== null ? (
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-1.5 text-xs">
          {todayReports.length ? (
            <span>
              <strong>Reporta hoy</strong> · {todayReports.join(" · ")}
            </span>
          ) : null}
          <a
            className="text-primary underline underline-offset-4"
            target="_blank"
            rel="noreferrer noopener"
            href={buildFinvizScreenerUrl({
              view: "111",
              filters: { earningsdate: "yesterdayafter" },
              signal: null,
            })}
          >
            Finviz · ayer post-cierre
          </a>
          <a
            className="text-primary underline underline-offset-4"
            target="_blank"
            rel="noreferrer noopener"
            href={buildFinvizScreenerUrl({
              view: "111",
              filters: { earningsdate: "todaybefore" },
              signal: null,
            })}
          >
            Finviz · hoy pre-apertura
          </a>
        </div>
      ) : null}

      {macro.length > 0 ? (
        <ul
          aria-label="Publicaciones económicas"
          className="flex w-full flex-wrap gap-x-4 gap-y-1 border-t pt-1.5 text-xs"
        >
          {macro.map((event) => (
            <li key={event.key}>
              <strong>{event.date === tomorrow ? "Mañana" : "Hoy"}</strong> ·{" "}
              {event.title}
              {event.time
                ? ` · ${event.time}${event.usualTime ? " habitual" : ""}`
                : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {withLink ? (
        <Link
          href={"/calendario" as Route}
          className="ml-auto text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Calendario
        </Link>
      ) : null}
    </section>
  );
}
