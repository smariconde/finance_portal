"use client";

import { ChevronLeft, ChevronRight, Clock, Clock3 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import {
  daysAwayLabel,
  monthTitle,
  shortMarketDate,
} from "@/app/_components/market-format";
import { Segmented } from "@/app/_components/segmented";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { EarningsCalendarView } from "@/modules/market-calendar/domain/calendar-publication";
import {
  marketMonth,
  type MarketMonthDay,
} from "@/modules/market-calendar/domain/market-month";
import {
  hoursAheadOfNewYork,
  marketDayOf,
  type MarketDay,
} from "@/modules/market-calendar/domain/market-sessions";
import {
  addCalendarDays,
  calendarDateMs,
} from "@/modules/market-calendar/domain/zoned-time";

import type { EconomicAgendaRow } from "@/server/persistence/read-economic-calendar";

import {
  agendaItems,
  datesFrom,
  filterAgenda,
  itemsByDate,
  type AgendaFilter,
  type AgendaItem,
  type AgendaRegion,
} from "./agenda-items";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie"] as const;
const WEEKDAYS_LONG = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
] as const;

/** Lo que muestra «Lo que viene» de entrada, y cuánto suma cada pedido. */
const HORIZON_STEP_DAYS = 21;
const HORIZON_MAX_DAYS = 120;
/** Chips visibles por celda antes del «+N». */
const CHIPS_PER_CELL = 2;

/**
 * Región → color y nombre. El color reusa la paleta categórica de los
 * gráficos y nunca va solo: cada marca lleva el nombre de la región.
 */
const REGIONS: Record<
  AgendaRegion,
  { readonly label: string; readonly dot: string; readonly chip: string }
> = {
  us: {
    label: "EE. UU.",
    dot: "bg-chart-1",
    chip: "bg-chart-1/12 dark:bg-chart-1/20",
  },
  ar: {
    label: "Argentina",
    dot: "bg-chart-2",
    chip: "bg-chart-2/14 dark:bg-chart-2/22",
  },
  earnings: {
    label: "Resultados",
    dot: "bg-chart-4",
    chip: "bg-chart-4/12 dark:bg-chart-4/22",
  },
};

function RegionDot({
  region,
  className,
}: {
  readonly region: AgendaRegion;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        REGIONS[region].dot,
        className,
      )}
    />
  );
}

/** Nueva York cambió de horario ese día (un domingo). */
function clockShiftOn(date: string): number | null {
  const ahead = hoursAheadOfNewYork(date);
  return ahead !== hoursAheadOfNewYork(addCalendarDays(date, -1))
    ? ahead
    : null;
}

/** El lunes después de un cambio de horario: las horas de la celda cambian. */
function opensAfterShift(day: MarketMonthDay): boolean {
  return (
    day.weekday === 1 &&
    day.regular !== null &&
    hoursAheadOfNewYork(day.date) !==
      hoursAheadOfNewYork(addCalendarDays(day.date, -3))
  );
}

function sessionLine(day: MarketDay): string {
  if (day.status === "weekend") return "Fin de semana";
  if (day.status === "undeclared") return "Sin calendario declarado";
  if (day.regular === null) return `NYSE cerrada · ${day.note ?? "feriado"}`;
  const hours = `${day.regular.open.buenosAires}–${day.regular.close.buenosAires}`;
  return day.status === "early_close"
    ? `NYSE ${hours} · cierre temprano`
    : `NYSE ${hours}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((calendarDateMs(to) - calendarDateMs(from)) / 86_400_000);
}

function DayCell({
  day,
  today,
  selected,
  items,
  onSelect,
}: {
  readonly day: MarketMonthDay;
  readonly today: string;
  readonly selected: boolean;
  readonly items: readonly AgendaItem[];
  readonly onSelect: (date: string) => void;
}) {
  const isToday = day.date === today;
  const dayNumber = Number(day.date.slice(8, 10));
  const name = `${WEEKDAYS_LONG[day.weekday - 1]} ${dayNumber}`;

  if (!day.inMonth) {
    return (
      <td className="h-20 border bg-muted/40 p-0 align-top sm:h-24">
        <span className="sr-only">{name}, otro mes</span>
      </td>
    );
  }

  const hidden = items.length - CHIPS_PER_CELL;

  return (
    <td
      className={cn(
        "h-20 border p-0 align-top sm:h-24",
        day.status === "holiday" && "bg-muted",
      )}
      aria-current={isToday ? "date" : undefined}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(day.date)}
        className={cn(
          "flex size-full min-w-0 flex-col gap-1 rounded-sm p-1.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
          selected
            ? "bg-accent ring-2 ring-primary ring-inset dark:bg-accent/20"
            : "hover:bg-muted/70",
        )}
      >
        <span className="flex w-full items-center justify-between gap-1">
          <span className="numeric flex items-center gap-1 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                isToday &&
                  "-ml-0.5 rounded-full bg-primary px-1.5 font-semibold text-primary-foreground",
              )}
            >
              {dayNumber}
            </span>
            <span className="sr-only">
              {name}
              {isToday ? ", hoy" : ""}.
            </span>
            {opensAfterShift(day) ? (
              <>
                <Clock
                  className="size-3 text-foreground/70"
                  aria-hidden="true"
                />
                <span className="sr-only">
                  Cambia el horario de Nueva York.
                </span>
              </>
            ) : null}
          </span>
          {day.regular !== null ? (
            <span className="numeric hidden text-xs leading-none text-muted-foreground lg:inline">
              {day.regular.open.buenosAires}–
              <span
                className={cn(
                  day.status === "early_close" &&
                    "font-medium text-amber-700 dark:text-amber-400",
                )}
              >
                {day.regular.close.buenosAires}
              </span>
            </span>
          ) : null}
        </span>

        {day.regular !== null ? (
          <span className="numeric flex flex-col text-xs leading-tight text-muted-foreground lg:hidden">
            <span>{day.regular.open.buenosAires}</span>
            <span
              className={cn(
                day.status === "early_close" &&
                  "font-medium text-amber-700 dark:text-amber-400",
              )}
            >
              {day.regular.close.buenosAires}
            </span>
          </span>
        ) : null}
        <span className="sr-only">{sessionLine(day)}.</span>
        {day.status === "holiday" ? (
          <span
            aria-hidden="true"
            className="truncate text-xs font-medium text-foreground/80"
          >
            Feriado
          </span>
        ) : null}

        {items.length > 0 ? (
          <>
            {/* Celdas angostas: sólo puntos. */}
            <span
              aria-hidden="true"
              className="mt-auto flex flex-wrap items-center gap-1 sm:hidden"
            >
              {items.slice(0, 3).map((item) => (
                <RegionDot key={item.id} region={item.region} />
              ))}
              {items.length > 3 ? (
                <span className="numeric text-xs leading-none text-muted-foreground">
                  +{items.length - 3}
                </span>
              ) : null}
            </span>
            <span
              aria-hidden="true"
              className="mt-auto hidden w-full min-w-0 flex-col gap-0.5 sm:flex"
            >
              {items.slice(0, CHIPS_PER_CELL).map((item) => (
                <span
                  key={item.id}
                  className={cn(
                    "flex min-w-0 items-center gap-1 rounded-sm px-1 text-xs leading-4",
                    REGIONS[item.region].chip,
                    item.cancelled && "line-through opacity-70",
                  )}
                >
                  <RegionDot region={item.region} className="size-1.5" />
                  <span className="truncate">{item.short}</span>
                </span>
              ))}
              {hidden > 0 ? (
                <span className="numeric px-1 text-xs leading-4 text-muted-foreground">
                  +{hidden} más
                </span>
              ) : null}
            </span>
            <span className="sr-only">
              {items
                .map(
                  (item) =>
                    `${REGIONS[item.region].label}: ${item.title}${item.cancelled ? ", cancelado" : ""}`,
                )
                .join(". ")}
              .
            </span>
          </>
        ) : null}
      </button>
    </td>
  );
}

function ItemRow({ item }: { readonly item: AgendaItem }) {
  const region = REGIONS[item.region];
  return (
    <li className="flex items-start gap-2.5 py-2">
      <RegionDot region={item.region} className="mt-1.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex flex-wrap items-baseline gap-x-1.5 leading-snug">
          <span
            className={cn(
              item.important && "font-medium",
              item.cancelled && "line-through",
            )}
          >
            {item.title}
          </span>
          {item.cancelled ? (
            <span className="text-xs font-medium">Cancelado</span>
          ) : null}
          {item.important && item.region !== "earnings" ? (
            <span className="text-xs text-muted-foreground">
              importancia alta
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {region.label} ·{" "}
          {item.sourceUrl ? (
            <a
              className="text-primary underline underline-offset-2"
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {item.source}
            </a>
          ) : (
            item.source
          )}
          {item.previousDate ? (
            <> · antes {shortMarketDate(item.previousDate)}</>
          ) : null}
        </p>
      </div>
      <span className="numeric shrink-0 pt-px text-xs text-muted-foreground">
        {item.time ?? "hora s/i"}
      </span>
    </li>
  );
}

function DayGroup({
  date,
  today,
  items,
}: {
  readonly date: string;
  readonly today: string;
  readonly items: readonly AgendaItem[];
}) {
  const day = marketDayOf(date);
  const shift = clockShiftOn(date);
  const away = daysBetween(today, date);
  const headingId = `agenda-${date}`;

  return (
    <section aria-labelledby={headingId} className="py-3 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={headingId} className="numeric text-sm font-semibold">
          {shortMarketDate(date)}
        </h3>
        {away >= 0 ? (
          <span className="numeric text-xs text-muted-foreground">
            {daysAwayLabel(away)}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "numeric mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground",
          day.status === "early_close" && "text-amber-700 dark:text-amber-400",
        )}
      >
        {day.status === "early_close" ? (
          <Clock3 className="size-3.5" aria-hidden="true" />
        ) : null}
        {sessionLine(day)}
      </p>
      {shift !== null ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs">
          <Clock className="size-3.5" aria-hidden="true" />
          Nueva York cambia de horario: abre a las{" "}
          {shift === 1 ? "10:30" : "11:30"} de Buenos Aires
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul className="mt-1 divide-y text-sm">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * El mes de la bolsa de Nueva York con la agenda adentro, y al costado «Lo
 * que viene» desde el día elegido. Los filtros valen para los dos. La grilla
 * es una tabla con encabezados y texto, y cada día es un botón que dice su
 * sesión y sus eventos, así que no necesita un equivalente aparte.
 */
export function CalendarWorkspace({
  today,
  months,
  unitedStates,
  argentina,
  earnings,
  followed,
}: {
  readonly today: string;
  /** Los meses declarados, en orden. */
  readonly months: readonly string[];
  readonly unitedStates: readonly EconomicAgendaRow[];
  readonly argentina: readonly EconomicAgendaRow[];
  readonly earnings: EarningsCalendarView | null;
  readonly followed: readonly string[];
}) {
  const initial = Math.max(0, months.indexOf(today.slice(0, 7)));
  const [index, setIndex] = useState(initial);
  const [selected, setSelected] = useState(today);
  const [horizon, setHorizon] = useState(HORIZON_STEP_DAYS);
  const [filter, setFilter] = useState<AgendaFilter>({
    region: "all",
    onlyImportant: false,
    onlyFollowed: true,
  });
  const panel = useRef<HTMLDivElement>(null);

  const month = months[index]!;
  const calendar = useMemo(() => marketMonth(month), [month]);
  const all = useMemo(
    () => agendaItems({ unitedStates, argentina, earnings, followed }),
    [unitedStates, argentina, earnings, followed],
  );
  const byDate = useMemo(
    () => itemsByDate(filterAgenda(all, filter)),
    [all, filter],
  );
  const days = datesFrom(selected, horizon).filter((date) => {
    const day = marketDayOf(date);
    return (
      date === selected ||
      byDate.has(date) ||
      day.status === "holiday" ||
      day.status === "early_close" ||
      clockShiftOn(date) !== null
    );
  });
  const shown = days.reduce(
    (total, date) => total + (byDate.get(date)?.length ?? 0),
    0,
  );

  const changeMonth = (next: number) => {
    setIndex(next);
    const target = months[next]!;
    if (selected.slice(0, 7) === target) return;
    const firstWeekday = marketMonth(target)
      .weeks.flat()
      .find((day) => day.inMonth);
    setSelected(today.slice(0, 7) === target ? today : firstWeekday!.date);
    setHorizon(HORIZON_STEP_DAYS);
  };

  const selectDay = (date: string) => {
    setSelected(date);
    setHorizon(HORIZON_STEP_DAYS);
    // Debajo de `xl` el panel queda abajo de la grilla: se lo lleva a la vista.
    if (!window.matchMedia("(min-width: 80rem)").matches) {
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      panel.current?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      });
    }
  };

  const regionOptions = [
    { value: "all" as const, label: "Todo" },
    { value: "us" as const, label: "EE. UU." },
    { value: "ar" as const, label: "Argentina" },
    ...(earnings !== null
      ? [{ value: "earnings" as const, label: "Resultados" }]
      : []),
  ];

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle as="h2">Sesiones y agenda</CardTitle>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={index === 0}
              onClick={() => changeMonth(index - 1)}
              aria-label="Mes anterior"
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span
              className="min-w-36 text-center text-sm font-medium capitalize"
              aria-live="polite"
            >
              {monthTitle(month)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={index === months.length - 1}
              onClick={() => changeMonth(index + 1)}
              aria-label="Mes siguiente"
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Table
            containerLabel="Sesiones del mes, tabla desplazable"
            className="table-fixed border-collapse"
          >
            <caption className="sr-only">
              Horario regular de la bolsa de Nueva York en hora de Buenos Aires
              y agenda, {monthTitle(month)}. Elegí un día para ver lo que viene
              desde ahí.
            </caption>
            <thead>
              <tr>
                {WEEKDAYS.map((weekday, position) => (
                  <th
                    key={weekday}
                    scope="col"
                    abbr={WEEKDAYS_LONG[position]}
                    className="pb-1.5 text-left text-xs font-medium text-muted-foreground"
                  >
                    {weekday}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calendar.weeks.map((week) => (
                <tr key={week[0]!.date}>
                  {week.map((day) => (
                    <DayCell
                      key={day.date}
                      day={day}
                      today={today}
                      selected={day.date === selected}
                      items={byDate.get(day.date) ?? []}
                      onSelect={selectDay}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          <ul
            aria-label="Referencias"
            className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
          >
            {(Object.keys(REGIONS) as AgendaRegion[])
              .filter((region) => region !== "earnings" || earnings !== null)
              .map((region) => (
                <li key={region} className="flex items-center gap-1.5">
                  <RegionDot region={region} />
                  {REGIONS[region].label}
                </li>
              ))}
            <li className="numeric">
              <span className="text-foreground">11:30–18:00</span> sesión en
              hora de Buenos Aires
            </li>
            <li>
              <span className="font-medium text-amber-700 dark:text-amber-400">
                15:00
              </span>{" "}
              cierre temprano
            </li>
            <li className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-sm border bg-muted"
              />
              feriado
            </li>
            <li className="flex items-center gap-1">
              <Clock className="size-3" aria-hidden="true" />
              cambia el horario de Nueva York
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card
        ref={panel}
        className="scroll-mt-20 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)]"
      >
        <CardHeader className="gap-3 border-b">
          <div className="flex items-baseline justify-between gap-2">
            <CardTitle as="h2" className="flex items-center gap-1.5">
              Lo que viene
              <InfoTip title="Qué entra">
                <p>
                  Feriados, cierres tempranos y cambios de horario de la NYSE;
                  publicaciones de Estados Unidos (FRED y la Fed) y de la
                  Argentina (INDEC, Hacienda y BCRA); y fechas de resultados de
                  Alpha Vantage.
                </p>
                <p>
                  Las horas son de Buenos Aires. «Habitual» es la hora que el
                  organismo suele usar, no una confirmada.
                </p>
              </InfoTip>
            </CardTitle>
            <span
              className="numeric text-xs text-muted-foreground"
              aria-live="polite"
            >
              desde {shortMarketDate(selected)}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <Segmented
              label="Región"
              options={regionOptions}
              value={filter.region}
              onChange={(region) => setFilter({ ...filter, region })}
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={filter.onlyImportant}
                  onChange={(event) =>
                    setFilter({
                      ...filter,
                      onlyImportant: event.target.checked,
                    })
                  }
                />
                Sólo importancia alta
              </label>
              {earnings !== null ? (
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={filter.onlyFollowed}
                    onChange={(event) =>
                      setFilter({
                        ...filter,
                        onlyFollowed: event.target.checked,
                      })
                    }
                  />
                  Resultados sólo de mis empresas
                </label>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent
          className="min-h-0 overflow-y-auto overscroll-contain"
          tabIndex={0}
          aria-label="Lo que viene, lista desplazable"
        >
          <div className="divide-y">
            {days.map((date) => (
              <DayGroup
                key={date}
                date={date}
                today={today}
                items={byDate.get(date) ?? []}
              />
            ))}
          </div>
          {shown === 0 ? (
            <p className="pt-3 text-sm text-muted-foreground">
              Nada agendado con estos filtros en los próximos {horizon} días.
            </p>
          ) : null}
          {horizon < HORIZON_MAX_DAYS ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() =>
                setHorizon(
                  Math.min(HORIZON_MAX_DAYS, horizon + HORIZON_STEP_DAYS),
                )
              }
            >
              Ver tres semanas más
            </Button>
          ) : null}
          {earnings?.observedAt ? (
            <p className="pt-3 text-xs text-muted-foreground">
              Resultados vistos el{" "}
              {shortMarketDate(earnings.observedAt.slice(0, 10))} (UTC).
            </p>
          ) : earnings !== null ? (
            <p className="pt-3 text-xs text-muted-foreground">
              Resultados todavía sin verificar.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
