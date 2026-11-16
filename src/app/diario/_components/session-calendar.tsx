"use client";

import { ChevronLeft, ChevronRight, CircleHelp } from "lucide-react";
import { useMemo, useState } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { formatSignedMoney } from "@/app/_components/trading-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatSignedAmount } from "@/modules/valuation/domain/display-format";
import type {
  CalendarBook,
  CalendarDay,
  PeriodPnl,
  TradingCalendar,
} from "@/modules/trading/domain/daily-pnl";

import { Money, pnlTone, RValue } from "./pnl-values";

/** Nombres fijos: `Intl` puede cambiar entre el servidor y el navegador. */
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie"] as const;
const WEEKDAYS_LONG = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
] as const;

function monthName(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1]!;
}

function monthLabel(month: string): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

function dayNumber(session: string): number {
  return Number(session.slice(8, 10));
}

function tradesLabel(pnl: PeriodPnl): string {
  return `${pnl.trades} ${pnl.trades === 1 ? "trade" : "trades"}`;
}

/**
 * Intensidad del fondo por magnitud dentro del mes, en tres escalones: la
 * proporción se ve de lejos y la cifra con signo dice el resto. `Number` sólo
 * para la geometría; la cifra que se lee es la decimal.
 */
function intensity(pnl: PeriodPnl, largest: number): 1 | 2 | 3 {
  if (largest === 0) return 1;
  const share = Math.abs(Number(pnl.realizedPnl)) / largest;
  return share > 0.66 ? 3 : share > 0.33 ? 2 : 1;
}

const POSITIVE_FILL = {
  1: "bg-emerald-500/7 dark:bg-emerald-400/8",
  2: "bg-emerald-500/13 dark:bg-emerald-400/14",
  3: "bg-emerald-500/20 dark:bg-emerald-400/20",
} as const;
const NEGATIVE_FILL = {
  1: "bg-red-500/7 dark:bg-red-400/8",
  2: "bg-red-500/13 dark:bg-red-400/14",
  3: "bg-red-500/20 dark:bg-red-400/20",
} as const;

function fillOf(pnl: PeriodPnl, largest: number): string | undefined {
  const value = Number(pnl.realizedPnl);
  if (value > 0) return POSITIVE_FILL[intensity(pnl, largest)];
  if (value < 0) return NEGATIVE_FILL[intensity(pnl, largest)];
  return "bg-muted/60";
}

/**
 * En una celda angosta, dólares enteros: seis columnas no entran con centavos en
 * un teléfono. Desde `sm`, al centavo; el exacto de cada trade está en su tabla.
 */
function CellAmount({ value }: { readonly value: string }) {
  return (
    <>
      <span className="sm:hidden">
        {formatSignedAmount(value, { scale: 0 })}
      </span>
      <span className="max-sm:hidden">{formatSignedMoney(value)}</span>
    </>
  );
}

function UnknownExits({ count }: { readonly count: number }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center text-muted-foreground">
      <CircleHelp className="size-3" aria-hidden="true" />
      <span className="sr-only">
        , {count} {count === 1 ? "salida" : "salidas"} sin entrada en la
        historia, fuera de la suma
      </span>
    </span>
  );
}

function DayCell({
  day,
  weekday,
  today,
  largest,
}: {
  readonly day: CalendarDay;
  readonly weekday: number;
  readonly today: string;
  readonly largest: number;
}) {
  const isToday = day.session === today;
  const filled = day.pnl !== null && day.inMonth;
  const label = `${WEEKDAYS_LONG[weekday]} ${dayNumber(day.session)}${day.inMonth ? "" : ` de ${monthName(day.session.slice(0, 7))}`}`;
  return (
    <td
      className={cn(
        "h-20 border p-0 align-top",
        // Un día de otro mes completa la semana: fondo neutro, sin tinte.
        !day.inMonth && "bg-muted/40",
        filled && fillOf(day.pnl!, largest),
      )}
      aria-current={isToday ? "date" : undefined}
    >
      <div
        className={cn(
          "flex h-full flex-col gap-1 p-1.5",
          isToday && "rounded-sm ring-2 ring-primary ring-inset",
        )}
      >
        <span
          className={cn(
            "numeric text-xs",
            // Sobre un tinte, el secundario sale del foreground, nunca gris.
            filled ? "text-foreground/80" : "text-muted-foreground",
            isToday && "font-semibold text-primary",
          )}
        >
          <span aria-hidden="true">{dayNumber(day.session)}</span>
          <span className="sr-only">{label}</span>
        </span>
        {day.pnl === null ? (
          day.session < today ? (
            <span className="sr-only">sin salidas</span>
          ) : null
        ) : (
          <>
            <span
              className={cn(
                "numeric text-sm leading-tight font-semibold",
                pnlTone(day.pnl.realizedPnl, filled),
              )}
            >
              <CellAmount value={day.pnl.realizedPnl} />
              <UnknownExits count={day.pnl.unknownExits} />
            </span>
            <span
              className={cn(
                "text-[0.6875rem] leading-none",
                filled ? "text-foreground/80" : "text-muted-foreground",
              )}
            >
              {tradesLabel(day.pnl)}
              {day.pnl.r.value === null ? null : (
                <>
                  {" · "}
                  <RValue r={day.pnl.r} />
                </>
              )}
            </span>
          </>
        )}
      </div>
    </td>
  );
}

function TotalCell({ pnl }: { readonly pnl: PeriodPnl | null }) {
  return (
    <td className="h-20 border bg-muted/30 p-1.5 text-right align-top">
      {pnl === null ? (
        <span className="text-muted-foreground">
          <span aria-hidden="true">—</span>
          <span className="sr-only">sin salidas</span>
        </span>
      ) : (
        <div className="flex flex-col items-end gap-1">
          <span className="numeric text-sm font-semibold">
            <span className={pnlTone(pnl.realizedPnl)}>
              <CellAmount value={pnl.realizedPnl} />
            </span>
            <UnknownExits count={pnl.unknownExits} />
          </span>
          <span className="text-[0.6875rem] leading-none text-muted-foreground">
            {tradesLabel(pnl)}
          </span>
          {pnl.r.value === null ? null : (
            <RValue r={pnl.r} className="text-xs" />
          )}
        </div>
      )}
    </td>
  );
}

function MonthGrid({
  calendar,
  today,
}: {
  readonly calendar: TradingCalendar;
  readonly today: string;
}) {
  const largest = useMemo(
    () =>
      Math.max(
        0,
        ...calendar.weeks.flatMap((week) =>
          week.days
            .filter((day) => day.inMonth && day.pnl !== null)
            .map((day) => Math.abs(Number(day.pnl!.realizedPnl))),
        ),
      ),
    [calendar],
  );

  return (
    <Table
      containerLabel="Calendario, tabla desplazable"
      className="table-fixed border-collapse"
    >
      <caption className="sr-only">
        P&amp;L realizado por sesión de Nueva York, {monthLabel(calendar.month)}
        , con el total de cada semana
      </caption>
      <thead>
        <tr>
          {WEEKDAYS.map((weekday, index) => (
            <th
              key={weekday}
              scope="col"
              abbr={WEEKDAYS_LONG[index]}
              className="pb-1.5 text-left text-xs font-medium text-muted-foreground"
            >
              {weekday}
            </th>
          ))}
          <th
            scope="col"
            className="w-[19%] pb-1.5 text-right text-xs font-medium text-muted-foreground"
          >
            Semana
          </th>
        </tr>
      </thead>
      <tbody>
        {calendar.weeks.map((week) => (
          <tr key={week.monday}>
            {week.days.map((day, index) => (
              <DayCell
                key={day.session}
                day={day}
                weekday={index}
                today={today}
                largest={largest}
              />
            ))}
            <TotalCell pnl={week.total} />
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function YearStrip({
  book,
  selected,
  onSelect,
}: {
  readonly book: CalendarBook;
  readonly selected: string;
  readonly onSelect: (month: string) => void;
}) {
  const year = book.years.find(
    (candidate) => String(candidate.year) === selected.slice(0, 4),
  )!;
  const available = new Set(book.months.map((calendar) => calendar.month));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">
          <span className="numeric">{year.year}</span>
        </span>
        <span className="text-muted-foreground">
          Año{" "}
          <Money
            value={year.total?.realizedPnl ?? null}
            signed
            className="font-semibold"
          />
        </span>
      </div>
      <ol
        aria-label={`Meses de ${year.year}`}
        className="grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-12"
      >
        {year.months.map((month) => {
          const enabled = available.has(month.month);
          const active = month.month === selected;
          return (
            <li key={month.month}>
              <button
                type="button"
                disabled={!enabled}
                aria-pressed={active}
                onClick={() => onSelect(month.month)}
                className={cn(
                  "flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent motion-reduce:transition-none",
                  active && "border-primary bg-accent hover:bg-accent",
                )}
              >
                <span className="text-xs text-muted-foreground capitalize">
                  {monthName(month.month).slice(0, 3)}
                </span>
                <span className="numeric w-full truncate text-xs font-semibold">
                  {month.pnl === null ? (
                    <span className="font-normal text-muted-foreground">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">sin salidas</span>
                    </span>
                  ) : (
                    <Money value={month.pnl.realizedPnl} signed />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * El calendario por sesión (`F11-06`, `trading-daily-pnl-1.0.0`): cada día de
 * Nueva York con lo que realizaron sus salidas, el total de cada semana entera y
 * el de cada mes. La tabla es el calendario mismo, con encabezados y texto, así
 * que no necesita un equivalente aparte.
 */
export function SessionCalendar({ book }: { readonly book: CalendarBook }) {
  const [selected, setSelected] = useState(book.months.at(-1)!.month);
  const index = book.months.findIndex(
    (calendar) => calendar.month === selected,
  );
  const calendar = book.months[index]!;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2" className="flex items-center gap-1">
          Calendario
          <InfoTip title="Cómo se lee">
            <p>
              Cada día es una sesión de Nueva York con lo que realizaron sus
              salidas: una salida parcial de un swing cuenta el día en que se
              vendió. Más intenso, más grande dentro del mes.
            </p>
            <p>
              La semana suma de lunes a viernes aunque cruce de mes; el mes,
              sólo sus días.
            </p>
            <p className="flex items-center gap-1">
              <CircleHelp className="size-3" aria-hidden="true" />
              Salida de un trade abierto antes de la historia: sin P&amp;L,
              fuera de la suma.
            </p>
          </InfoTip>
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => setSelected(book.months[index - 1]!.month)}
            aria-label="Mes anterior"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span
            className="min-w-36 text-center text-sm font-medium capitalize"
            aria-live="polite"
          >
            {monthLabel(calendar.month)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={index === book.months.length - 1}
            onClick={() => setSelected(book.months[index + 1]!.month)}
            aria-label="Mes siguiente"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Mes{" "}
            <Money
              value={calendar.total?.realizedPnl ?? null}
              signed
              className="text-base font-semibold"
            />
          </span>
          {calendar.total === null ? null : (
            <>
              <span className="text-muted-foreground">
                {tradesLabel(calendar.total)}
              </span>
              {calendar.total.r.value === null ? null : (
                <RValue r={calendar.total.r} />
              )}
            </>
          )}
        </div>
        <MonthGrid calendar={calendar} today={book.today.session} />
        <YearStrip book={book} selected={selected} onSelect={setSelected} />
      </CardContent>
    </Card>
  );
}
