import { CalendarX2, Clock3, Clock } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { InfoTip } from "@/app/_components/info-tip";
import {
  daysAwayLabel,
  fullMarketDate,
  shortMarketDate,
} from "@/app/_components/market-format";
import { MarketStrip } from "@/app/_components/market-strip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NYSE_CALENDAR } from "@/modules/market-calendar/domain/declared-market-sessions";
import {
  declaredMonths,
  upcomingMarketEvents,
  type UpcomingMarketEvent,
} from "@/modules/market-calendar/domain/market-month";
import {
  calendarCoverage,
  MARKET_SESSIONS_VERSION,
  marketMomentAt,
} from "@/modules/market-calendar/domain/market-sessions";

import { servesRealData } from "@/modules/configuration/domain/config-health";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import {
  readArgentinaCalendar,
  readUnitedStatesCalendar,
} from "@/server/persistence/read-economic-calendar";
import { INDEC_CALENDAR } from "@/modules/market-calendar/domain/declared-indec-calendar";
import { readEarningsCalendar } from "@/server/persistence/read-earnings-calendar";

import { CalendarAgenda } from "./_components/calendar-agenda";
import { MarketMonthCard } from "./_components/market-month-card";

export const metadata: Metadata = { title: "Calendario" };

/**
 * La hora del request decide qué es «hoy»: la ruta no se prerenderiza
 * ([ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md)).
 */
export const instant = false;

/** Cuánto mira hacia adelante «Lo que viene». */
const UPCOMING_DAYS = 120;

function EventRow({ event }: { readonly event: UpcomingMarketEvent }) {
  const when = (
    <span className="numeric shrink-0 text-xs text-muted-foreground">
      {daysAwayLabel(event.daysAway)}
    </span>
  );

  if (event.kind === "clock_shift") {
    return (
      <li className="flex items-start gap-2 py-2">
        <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">
            {shortMarketDate(event.date)} · cambio de horario
          </span>
          <span className="text-muted-foreground">
            Nueva York abre a las{" "}
            <span className="numeric text-foreground">
              {event.shift.openBuenosAires}
            </span>{" "}
            de Buenos Aires
          </span>
        </span>
        {when}
      </li>
    );
  }

  const { day } = event;
  if (event.kind === "early_close") {
    return (
      <li className="flex items-start gap-2 py-2">
        <Clock3
          className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">
            {shortMarketDate(event.date)} · cierra a las{" "}
            <span className="numeric">{day.regular!.close.buenosAires}</span>
          </span>
          <span className="text-muted-foreground">
            {day.note} ·{" "}
            <span className="numeric">{day.regular!.close.newYork}</span> en
            Nueva York
          </span>
        </span>
        {when}
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 py-2">
      <CalendarX2
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">
          {shortMarketDate(event.date)} · cerrada
        </span>
        <span className="text-muted-foreground">{day.note}</span>
      </span>
      {when}
    </li>
  );
}

export default async function CalendarPage() {
  await connection();
  const at = new Date().toISOString();
  const moment = marketMomentAt(at);
  const personal = servesRealData(await getRequestConfigHealth());
  const [earnings, followed] = personal
    ? await Promise.all([
        readEarningsCalendar(at, { includeMarket: true }).catch(() => ({
          observedAt: null,
          reports: [],
        })),
        readEarningsCalendar(at, { includeFollowed: true }).catch(() => null),
      ])
    : [null, null];
  const today = moment.today.date;
  const [unitedStates, argentina] = await Promise.all([
    readUnitedStatesCalendar(at, personal),
    readArgentinaCalendar(at, personal),
  ]);
  const publications = [...unitedStates, ...argentina];
  const events = upcomingMarketEvents(today, UPCOMING_DAYS);
  const coverage = calendarCoverage(today);

  return (
    <PageContainer>
      <PageHeader
        id="calendario-title"
        title="Calendario"
        lead={
          <>
            Bolsa de Nueva York, en hora de Buenos Aires{" "}
            <InfoTip title="Cómo se arma">
              <p>
                Feriados y cierres tempranos declarados desde el calendario que
                publica la NYSE; Nasdaq opera los mismos días.
              </p>
              <p>
                La hora de Buenos Aires sale de la base de zonas horarias: la
                Argentina no cambia de horario y Nueva York sí, por eso la
                apertura pasa de las 11:30 a las 10:30 entre marzo y noviembre.
              </p>
              <p>El horario extendido depende del broker y no figura acá.</p>
            </InfoTip>
          </>
        }
      />

      <MarketStrip withLink={false} corroborate />

      <CalendarAgenda
        today={today}
        earnings={earnings}
        followed={[
          ...new Set(followed?.reports.map((report) => report.symbol)),
        ]}
        publications={publications}
      />

      {personal ? (
        <div className="text-xs text-muted-foreground">
          <p>
            {unitedStates.some(({ source }) => source.startsWith("FRED"))
              ? "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis."
              : "Agenda de FRED todavía sin verificar."}
          </p>
          {argentina.some(({ source }) => source === "BCRA") ? null : (
            <p>Calendario de informes del BCRA todavía sin verificar.</p>
          )}
          <p>
            Difusión del INDEC declarada hasta el{" "}
            {fullMarketDate(INDEC_CALENDAR.coversTo)}.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MarketMonthCard today={today} months={declaredMonths()} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Lo que viene</CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin feriados, cierres tempranos ni cambios de horario en los
                próximos {UPCOMING_DAYS} días.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {events.map((event) => (
                  <EventRow key={`${event.kind}-${event.date}`} event={event} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <footer className="flex flex-col gap-1 text-xs text-muted-foreground">
        {coverage.renewalDue ? (
          <p className="text-amber-700 dark:text-amber-400">
            Lo declarado termina el {fullMarketDate(coverage.coversTo)}: falta
            cargar el próximo anuncio de la NYSE.
          </p>
        ) : null}
        <p>
          Fuente:{" "}
          <a
            href={NYSE_CALENDAR.source}
            className="text-primary underline underline-offset-4"
            rel="noreferrer"
            target="_blank"
          >
            NYSE, Holidays &amp; Trading Hours
          </a>
          , anuncio del {fullMarketDate(NYSE_CALENDAR.announcedOn)}, consultado
          el {fullMarketDate(NYSE_CALENDAR.consultedOn)} · declarado hasta el{" "}
          {fullMarketDate(coverage.coversTo)} · {MARKET_SESSIONS_VERSION}
        </p>
      </footer>
    </PageContainer>
  );
}
