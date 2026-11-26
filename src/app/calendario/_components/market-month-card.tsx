"use client";

import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useMemo, useState } from "react";

import { monthTitle } from "@/app/_components/market-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  marketMonth,
  type MarketMonthDay,
} from "@/modules/market-calendar/domain/market-month";
import { hoursAheadOfNewYork } from "@/modules/market-calendar/domain/market-sessions";
import { addCalendarDays } from "@/modules/market-calendar/domain/zoned-time";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie"] as const;
const WEEKDAYS_LONG = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
] as const;

/** El lunes después de un cambio de horario: las horas de la celda cambian. */
function opensAfterShift(day: MarketMonthDay): boolean {
  return (
    day.weekday === 1 &&
    day.regular !== null &&
    hoursAheadOfNewYork(day.date) !==
      hoursAheadOfNewYork(addCalendarDays(day.date, -3))
  );
}

function DayCell({
  day,
  today,
}: {
  readonly day: MarketMonthDay;
  readonly today: string;
}) {
  const isToday = day.date === today;
  const dayNumber = Number(day.date.slice(8, 10));
  const name = `${WEEKDAYS_LONG[day.weekday - 1]} ${dayNumber}`;

  if (!day.inMonth) {
    return (
      <td className="h-16 border bg-muted/40 p-0 align-top">
        <span className="sr-only">{name}, otro mes</span>
      </td>
    );
  }

  return (
    <td
      className={cn(
        "h-16 border p-0 align-top",
        day.status === "holiday" && "bg-muted",
      )}
      aria-current={isToday ? "date" : undefined}
    >
      <div
        className={cn(
          "flex h-full flex-col gap-0.5 p-1.5",
          isToday && "rounded-sm ring-2 ring-primary ring-inset",
        )}
      >
        <span
          className={cn(
            "numeric flex items-center gap-1 text-xs text-muted-foreground",
            isToday && "font-semibold text-primary",
          )}
        >
          <span aria-hidden="true">{dayNumber}</span>
          <span className="sr-only">{name}</span>
          {opensAfterShift(day) ? (
            <>
              <Clock className="size-3 text-foreground/70" aria-hidden="true" />
              <span className="sr-only">, cambia el horario de Nueva York</span>
            </>
          ) : null}
        </span>
        {day.regular !== null ? (
          <span className="numeric flex flex-col text-xs leading-tight sm:flex-row sm:gap-0.5">
            <span>{day.regular.open.buenosAires}</span>
            <span aria-hidden="true" className="hidden sm:inline">
              –
            </span>
            <span className="sr-only">a</span>
            <span
              className={cn(
                day.status === "early_close" &&
                  "font-medium text-amber-700 dark:text-amber-400",
              )}
            >
              {day.regular.close.buenosAires}
            </span>
            {day.status === "early_close" ? (
              <span className="sr-only">, cierre temprano</span>
            ) : null}
          </span>
        ) : day.status === "holiday" ? (
          <span className="flex min-w-0 flex-col text-xs leading-tight">
            <span className="font-medium">Feriado</span>
            <span className="hidden truncate text-foreground/70 sm:block">
              {day.note}
            </span>
            <span className="sr-only sm:hidden">{day.note}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            <span aria-hidden="true">—</span>
            <span className="sr-only">sin calendario declarado</span>
          </span>
        )}
      </div>
    </td>
  );
}

/**
 * El mes de la bolsa de Nueva York (`market-sessions-1.0.0`): cada día hábil
 * con su horario regular en hora de Buenos Aires, los cierres tempranos y los
 * feriados con su nombre. La tabla es el calendario mismo, con encabezados y
 * texto, así que no necesita un equivalente aparte.
 */
export function MarketMonthCard({
  today,
  months,
}: {
  readonly today: string;
  /** Los meses declarados, en orden. */
  readonly months: readonly string[];
}) {
  const initial = Math.max(0, months.indexOf(today.slice(0, 7)));
  const [index, setIndex] = useState(initial);
  const month = months[index]!;
  const calendar = useMemo(() => marketMonth(month), [month]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2">Sesiones</CardTitle>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
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
            onClick={() => setIndex(index + 1)}
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
            Horario regular de la bolsa de Nueva York en hora de Buenos Aires,{" "}
            {monthTitle(month)}
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
                  <DayCell key={day.date} day={day} today={today} />
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        <ul
          aria-label="Referencias"
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          <li className="numeric">
            <span className="text-foreground">11:30–18:00</span> apertura y
            cierre
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
  );
}
