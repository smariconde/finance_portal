"use client";

import { useState } from "react";

import { earningsTimeLabel } from "@/app/_components/earnings-mark";
import { shortMarketDate } from "@/app/_components/market-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EarningsCalendarView } from "@/modules/market-calendar/domain/calendar-publication";
import { marketDaysBetween } from "@/modules/market-calendar/domain/market-sessions";
import {
  addCalendarDays,
  isoWeekday,
} from "@/modules/market-calendar/domain/zoned-time";

export function CalendarAgenda({
  today,
  earnings,
  followed,
}: {
  readonly today: string;
  readonly earnings: EarningsCalendarView | null;
  readonly followed: readonly string[];
}) {
  const [week, setWeek] = useState(0);
  const [mine, setMine] = useState(true);
  const first = addCalendarDays(today, 1 - isoWeekday(today) + week * 7);
  const last = addCalendarDays(first, 6);
  const inWeek = (date: string) => date >= first && date <= last;
  const rows = [
    ...marketDaysBetween(first, last)
      .filter((day) => day.status !== "weekend")
      .map((day) => ({
        id: `nyse:${day.date}`,
        date: day.date,
        title:
          day.status === "undeclared"
            ? "NYSE · Sin calendario"
            : day.regular === null
              ? `NYSE · Cerrada · ${day.note}`
              : day.status === "early_close"
                ? "NYSE · Cierre temprano"
                : "NYSE · Sesión regular",
        source: "NYSE",
        time:
          day.regular === null
            ? null
            : `${day.regular.open.buenosAires}–${day.regular.close.buenosAires}`,
        previousDate: null,
      })),
    ...(earnings?.reports ?? [])
      .filter(
        (report) =>
          inWeek(report.date) && (!mine || followed.includes(report.symbol)),
      )
      .map((report) => ({
        id: `av:${report.symbol}:${report.fiscalDateEnding}`,
        date: report.date,
        title: `${report.symbol} · Resultados estimados`,
        source: "Alpha Vantage",
        time: earningsTimeLabel(report.time),
        previousDate: report.previousDate,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Card>
      <CardHeader className="gap-3 border-b">
        <CardTitle as="h2">Agenda semanal</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setWeek(week - 1)}
            disabled={week <= -4}
          >
            Anterior
          </Button>
          <span className="numeric px-1 text-sm" aria-live="polite">
            {shortMarketDate(first)} – {shortMarketDate(last)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setWeek(week + 1)}
            disabled={week >= 13}
          >
            Siguiente
          </Button>
          {earnings !== null ? (
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={mine}
                onChange={(event) => setMine(event.target.checked)}
              />
              Mis empresas
            </label>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <Table containerLabel="Agenda semanal, tabla desplazable">
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Evento</TableHead>
              <TableHead>Hora BA</TableHead>
              <TableHead>Fuente</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="numeric">
                  <time dateTime={row.date}>{shortMarketDate(row.date)}</time>
                </TableCell>
                <TableCell className="whitespace-normal">
                  {row.title}
                  {row.previousDate && row.previousDate !== row.date ? (
                    <span className="block text-xs text-muted-foreground">
                      Antes {shortMarketDate(row.previousDate)}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="numeric">{row.time ?? "—"}</TableCell>
                <TableCell className="whitespace-normal">
                  {row.source}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {earnings !== null && earnings.observedAt === null ? (
          <p className="px-4 pt-3 text-xs text-muted-foreground">
            Resultados todavía sin verificar.
          </p>
        ) : null}
        {earnings?.observedAt ? (
          <p className="px-4 pt-3 text-xs text-muted-foreground">
            Resultados observados por última vez el{" "}
            {shortMarketDate(earnings.observedAt.slice(0, 10))} (UTC).
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
