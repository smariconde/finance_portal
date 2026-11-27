"use client";

import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { shortMarketDate } from "@/app/_components/market-format";
import { TickerMark } from "@/app/_components/ticker-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { EarningsCalendarView } from "@/modules/market-calendar/domain/calendar-publication";
import {
  marketDayOf,
  type MarketDay,
} from "@/modules/market-calendar/domain/market-sessions";

import {
  earningsWeek,
  earningsWeekStarts,
  type EarningsEntry,
  type EarningsSession,
  type EarningsWeekDay,
} from "./earnings-week";

/** Logos visibles por subcolumna antes del «+N». */
const TILES_PER_CELL = 8;
/** Tickers sin hora visibles por día antes del «+N». */
const CHIPS_PER_DAY = 8;

const SESSIONS: readonly {
  readonly key: Exclude<EarningsSession, "unknown">;
  readonly label: string;
  readonly spoken: string;
}[] = [
  {
    key: "before",
    label: "Before open",
    spoken: "antes de la apertura",
  },
  {
    key: "after",
    label: "After close",
    spoken: "después del cierre",
  },
];

/**
 * La división entre «Before open» y «After close» dentro del día: punteada,
 * más tenue y más corta que el borde entre días, que es la que manda.
 */
const SESSION_DIVIDER =
  "relative before:pointer-events-none before:absolute before:inset-y-3 before:left-0 before:border-l before:border-dashed before:border-foreground/20";

function nyseNote(day: MarketDay): string | null {
  if (day.status === "holiday") return "NYSE cerrada";
  if (day.status === "early_close" && day.regular !== null)
    return `cierra ${day.regular.close.buenosAires}`;
  return null;
}

function MovedMark({ previousDate }: { readonly previousDate: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center text-amber-700 dark:text-amber-400"
      title={`Antes ${shortMarketDate(previousDate)}`}
    >
      <CalendarClock className="size-3" aria-hidden="true" />
      <span className="sr-only">, antes {shortMarketDate(previousDate)}</span>
    </span>
  );
}

/** El logo con el ticker debajo: se reconoce la empresa de un vistazo. */
function EntryTile({ entry }: { readonly entry: EarningsEntry }) {
  return (
    <li className="flex min-w-0 flex-col items-center gap-1 text-center">
      <TickerMark ticker={entry.symbol} size="md" />
      <span className="flex max-w-full items-center gap-0.5">
        <span
          className={cn(
            "numeric truncate text-xs",
            entry.followed ? "font-semibold" : "text-muted-foreground",
          )}
        >
          {entry.symbol}
        </span>
        {entry.followed ? <span className="sr-only">, mi empresa</span> : null}
        {entry.previousDate ? (
          <MovedMark previousDate={entry.previousDate} />
        ) : null}
      </span>
    </li>
  );
}

/** Sin hora: chico, en línea, porque no se sabe en qué lado de la sesión cae. */
function EntryChip({ entry }: { readonly entry: EarningsEntry }) {
  return (
    <li className="flex min-w-0 items-center gap-1">
      <TickerMark ticker={entry.symbol} />
      <span
        className={cn("numeric text-xs", entry.followed && "font-semibold")}
      >
        {entry.symbol}
      </span>
      {entry.followed ? <span className="sr-only">, mi empresa</span> : null}
      {entry.previousDate ? (
        <MovedMark previousDate={entry.previousDate} />
      ) : null}
    </li>
  );
}

function Empty() {
  return (
    <span className="block text-center text-sm text-muted-foreground/70">
      <span aria-hidden="true">—</span>
      <span className="sr-only">ninguno</span>
    </span>
  );
}

function MoreButton({
  hidden,
  onExpand,
}: {
  readonly hidden: number;
  readonly onExpand: () => void;
}) {
  return hidden > 0 ? (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="mx-auto mt-1 flex text-muted-foreground"
      onClick={onExpand}
    >
      +{hidden} más
    </Button>
  ) : null;
}

function TileList({
  entries,
  expanded,
  onExpand,
}: {
  readonly entries: readonly EarningsEntry[];
  readonly expanded: boolean;
  readonly onExpand: () => void;
}) {
  if (entries.length === 0) return <Empty />;
  const visible = expanded ? entries : entries.slice(0, TILES_PER_CELL);
  return (
    <>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-x-1 gap-y-2.5">
        {visible.map((entry) => (
          <EntryTile key={entry.symbol} entry={entry} />
        ))}
      </ul>
      <MoreButton
        hidden={entries.length - visible.length}
        onExpand={onExpand}
      />
    </>
  );
}

function ChipList({
  entries,
  expanded,
  onExpand,
}: {
  readonly entries: readonly EarningsEntry[];
  readonly expanded: boolean;
  readonly onExpand: () => void;
}) {
  const visible = expanded ? entries : entries.slice(0, CHIPS_PER_DAY);
  return (
    <>
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
        {visible.map((entry) => (
          <EntryChip key={entry.symbol} entry={entry} />
        ))}
      </ul>
      <MoreButton
        hidden={entries.length - visible.length}
        onExpand={onExpand}
      />
    </>
  );
}

function SessionLabel({
  session,
}: {
  readonly session: (typeof SESSIONS)[number];
}) {
  return (
    <span className="block text-center text-xs font-medium text-muted-foreground uppercase">
      {session.label}
    </span>
  );
}

function DayHeading({
  day,
  today,
}: {
  readonly day: EarningsWeekDay;
  readonly today: string;
}) {
  const market = marketDayOf(day.date);
  const note = nyseNote(market);
  const isToday = day.date === today;
  const [weekday, date] = shortMarketDate(day.date).split(" ");
  return (
    <span className="flex flex-col items-center gap-0.5">
      <span className="flex items-baseline gap-1.5">
        <span className="text-xs font-medium text-muted-foreground capitalize">
          {weekday}
        </span>
        <span
          className={cn(
            "numeric text-sm font-semibold",
            isToday && "rounded-full bg-primary px-1.5 text-primary-foreground",
          )}
        >
          {date}
        </span>
        {isToday ? <span className="sr-only">, hoy</span> : null}
      </span>
      {note ? (
        <span
          className={cn(
            "text-xs font-normal",
            market.status === "early_close"
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground",
          )}
        >
          {note}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Los earnings de la semana fuera del mes: una columna por día y, adentro, dos
 * subcolumnas con lo que reporta antes de la apertura y después del cierre.
 * El logo ayuda a reconocer la empresa; el ticker va escrito debajo.
 * Lo que la fuente no ubica en la sesión va aparte, en chico, debajo del día.
 */
export function EarningsWeekCard({
  today,
  earnings,
  followed,
}: {
  readonly today: string;
  readonly earnings: EarningsCalendarView;
  readonly followed: readonly string[];
}) {
  const weeks = useMemo(
    () => earningsWeekStarts(earnings.reports, today),
    [earnings.reports, today],
  );
  const [index, setIndex] = useState(0);
  const [onlyFollowed, setOnlyFollowed] = useState(followed.length > 0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const start = weeks[Math.min(index, weeks.length - 1)]!;
  const week = useMemo(
    () =>
      earningsWeek({
        reports: earnings.reports,
        start,
        followed,
        onlyFollowed,
      }),
    [earnings.reports, start, followed, onlyFollowed],
  );
  const end = week.days.at(-1)!.date;
  const range = `${shortMarketDate(start).split(" ")[1]} – ${shortMarketDate(end).split(" ")[1]}`;

  const shaded = (date: string) =>
    date < today || marketDayOf(date).status === "holiday";

  const goTo = (next: number) => {
    setIndex(next);
    setExpanded(new Set());
  };
  const expand = (key: string) => setExpanded(new Set(expanded).add(key));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <CardTitle as="h2" className="flex items-center gap-1.5">
            Earnings
            <InfoTip title="De dónde salen">
              <p>
                Fechas estimadas de Alpha Vantage. «Before open» y «After close»
                son lo que la fuente informa; no da la hora exacta.
              </p>
              <p>
                Mis empresas: las valuadas y las que tienen CEDEAR, en negrita y
                primero.
              </p>
            </InfoTip>
          </CardTitle>
          <label className="flex min-h-7 items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={onlyFollowed}
              onChange={(event) => {
                setOnlyFollowed(event.target.checked);
                setExpanded(new Set());
              }}
            />
            Sólo mis empresas
          </label>
        </div>
        <div className="flex items-center gap-1">
          {index > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => goTo(0)}
            >
              Esta semana
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
            aria-label="Semana anterior"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="numeric min-w-28 text-center text-sm font-medium">
            <span className="sr-only">Semana del </span>
            {range}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={index >= weeks.length - 1}
            onClick={() => goTo(index + 1)}
            aria-label="Semana siguiente"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Desde `lg`: la semana como tabla. Si no entra, se desplaza. */}
        <div className="hidden lg:block">
          <Table
            containerLabel="Earnings de la semana, tabla desplazable"
            className="min-w-[40rem] table-fixed border-collapse"
          >
            <caption className="sr-only">
              Earnings de la semana del {range}: cada día con lo que reporta
              antes de la apertura y después del cierre.
            </caption>
            <thead>
              <tr>
                {week.days.map((day, position) => (
                  <th
                    key={day.date}
                    colSpan={2}
                    scope="colgroup"
                    className={cn(
                      "px-2 pb-2 align-bottom",
                      position > 0 && "border-l",
                      shaded(day.date) && "bg-muted/50",
                    )}
                    aria-current={day.date === today ? "date" : undefined}
                  >
                    <DayHeading day={day} today={today} />
                  </th>
                ))}
              </tr>
              <tr>
                {week.days.flatMap((day, position) =>
                  SESSIONS.map((session, side) => (
                    <th
                      key={`${day.date}:${session.key}`}
                      scope="col"
                      className={cn(
                        "border-b px-1 pb-2 font-normal",
                        position > 0 && side === 0 && "border-l",
                        side === 1 && SESSION_DIVIDER,
                        side === 1 && "before:inset-y-1",
                        shaded(day.date) && "bg-muted/50",
                      )}
                    >
                      <SessionLabel session={session} />
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              <tr>
                {week.days.flatMap((day, position) =>
                  SESSIONS.map((session, side) => {
                    const key = `${day.date}:${session.key}`;
                    return (
                      <td
                        key={key}
                        className={cn(
                          "min-w-0 px-1 py-3 align-top",
                          position > 0 && side === 0 && "border-l",
                          side === 1 && SESSION_DIVIDER,
                          shaded(day.date) && "bg-muted/50",
                        )}
                      >
                        <TileList
                          entries={day.sessions[session.key]}
                          expanded={expanded.has(key)}
                          onExpand={() => expand(key)}
                        />
                      </td>
                    );
                  }),
                )}
              </tr>
              {week.hasUnknown ? (
                <tr className="border-t">
                  {week.days.map((day, position) => {
                    const key = `${day.date}:unknown`;
                    return (
                      <td
                        key={key}
                        colSpan={2}
                        className={cn(
                          "min-w-0 px-2 py-2 align-top",
                          position > 0 && "border-l",
                          shaded(day.date) && "bg-muted/50",
                        )}
                      >
                        {day.sessions.unknown.length > 0 ? (
                          <>
                            <p className="mb-1.5 text-xs text-muted-foreground">
                              Sin hora
                            </p>
                            <ChipList
                              entries={day.sessions.unknown}
                              expanded={expanded.has(key)}
                              onExpand={() => expand(key)}
                            />
                          </>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ) : null}
            </tbody>
          </Table>
        </div>

        {/* Teléfono: un día debajo del otro, con sus dos lados. */}
        <ol className="flex flex-col divide-y lg:hidden">
          {week.days.map((day) => (
            <li key={day.date} className="flex flex-col gap-3 py-3 first:pt-0">
              <h3 className="self-start">
                <DayHeading day={day} today={today} />
              </h3>
              <div className="grid grid-cols-2">
                {SESSIONS.map((session, side) => {
                  const key = `${day.date}:${session.key}`;
                  return (
                    <section
                      key={session.key}
                      aria-label={session.spoken}
                      className={cn(
                        "flex min-w-0 flex-col gap-2 px-2",
                        side === 1 && SESSION_DIVIDER,
                        side === 1 && "before:inset-y-1",
                      )}
                    >
                      <SessionLabel session={session} />
                      <TileList
                        entries={day.sessions[session.key]}
                        expanded={expanded.has(key)}
                        onExpand={() => expand(key)}
                      />
                    </section>
                  );
                })}
              </div>
              {day.sessions.unknown.length > 0 ? (
                <section
                  aria-label="sin hora"
                  className="flex flex-col gap-1.5"
                >
                  <p className="text-xs text-muted-foreground">Sin hora</p>
                  <ChipList
                    entries={day.sessions.unknown}
                    expanded={expanded.has(`${day.date}:unknown`)}
                    onExpand={() => expand(`${day.date}:unknown`)}
                  />
                </section>
              ) : null}
            </li>
          ))}
        </ol>

        {week.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            {onlyFollowed
              ? "Ninguna de mis empresas reporta esta semana."
              : "Nada informado para esta semana."}
          </p>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            Alpha Vantage ·{" "}
            {earnings.observedAt
              ? `vistos el ${shortMarketDate(earnings.observedAt.slice(0, 10))} (UTC)`
              : "todavía sin verificar"}
          </span>
          <span className="flex items-center gap-1">
            <CalendarClock
              className="size-3.5 text-amber-700 dark:text-amber-400"
              aria-hidden="true"
            />
            fecha movida
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
