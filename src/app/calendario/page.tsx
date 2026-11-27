import type { Metadata } from "next";
import { connection } from "next/server";

import { InfoTip } from "@/app/_components/info-tip";
import { fullMarketDate } from "@/app/_components/market-format";
import { MarketStrip } from "@/app/_components/market-strip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { NYSE_CALENDAR } from "@/modules/market-calendar/domain/declared-market-sessions";
import { declaredMonths } from "@/modules/market-calendar/domain/market-month";
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

import { CalendarWorkspace } from "./_components/calendar-workspace";

export const metadata: Metadata = { title: "Calendario" };

/**
 * La hora del request decide qué es «hoy»: la ruta no se prerenderiza
 * ([ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md)).
 */
export const instant = false;

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

      <CalendarWorkspace
        today={today}
        months={declaredMonths()}
        unitedStates={unitedStates}
        argentina={argentina}
        earnings={earnings}
        followed={[
          ...new Set(followed?.reports.map((report) => report.symbol)),
        ]}
      />

      <footer className="flex flex-col gap-1 text-xs text-muted-foreground">
        {personal ? (
          <>
            <p>
              {unitedStates.some(({ source }) => source.startsWith("FRED"))
                ? "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis."
                : "Agenda de FRED todavía sin verificar."}
            </p>
            {argentina.some(({ source }) => source === "BCRA") ? null : (
              <p>Calendario de informes del BCRA todavía sin verificar.</p>
            )}
          </>
        ) : null}
        <p>
          Difusión del INDEC declarada hasta el{" "}
          {fullMarketDate(INDEC_CALENDAR.coversTo)}.
        </p>
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
