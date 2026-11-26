import { CalendarRefreshOnOpen } from "@/app/_components/calendar-refresh-on-open";
import { expectedArgentinePublications } from "@/modules/market-calendar/domain/expected-argentina-publications";
import {
  BUENOS_AIRES,
  calendarDateIn,
} from "@/modules/market-calendar/domain/zoned-time";
import { readArgentinaCalendar } from "@/server/persistence/read-economic-calendar";

import type { Metadata } from "next";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { InfoTip } from "@/app/_components/info-tip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { SectionIndex } from "@/app/_components/section-index";
import {
  loadArgentinaDashboard,
  type ArgentinaDashboard,
} from "@/modules/argentina-dashboard/application/load-argentina-dashboard";
import type { ArgentinaRefreshReadiness } from "@/modules/argentina-dashboard/application/argentina-refresh";
import { ARGENTINA_BLOCKS } from "@/modules/argentina-dashboard/domain/block-guides";
import { readArgentinaNews } from "@/modules/argentina-dashboard/application/read-argentina-news";
import type { ArgentinaNews } from "@/modules/argentina-dashboard/domain/argentina-news";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import { visitBaseline } from "@/modules/surface-visits/domain/surface-visit";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { readArgentinaRefreshReadinessForRender } from "@/server/jobs/argentina-refresh";
import { getAdrPairRepository } from "@/server/persistence/get-adr-pair-repository";
import { getArgentinaIndicatorRepository } from "@/server/persistence/get-argentina-indicator-repository";
import { getMacroSeriesRepository } from "@/server/persistence/get-macro-series-repository";
import { getRemForecastRepository } from "@/server/persistence/get-rem-forecast-repository";
import { getSurfaceVisitRepository } from "@/server/persistence/get-surface-visit-repository";
import {
  readRemInflationComparison,
  type RemInflationComparisonRow,
} from "@/modules/macro-series/application/read-rem-inflation-comparison";

import { ArgentinaRefresh } from "./_components/argentina-refresh";
import { ArgentinaFreshnessProvider } from "./_components/freshness-provider";
import { CountryRiskSection } from "./_components/country-risk-section";
import { ItcrmSection } from "./_components/itcrm-section";
import { markedBlocks, NewsDot, NewsStrip } from "./_components/news-mark";
import { RemInflationSection } from "./_components/rem-inflation-section";
import {
  ActivitySection,
  DollarSection,
  ExternalSection,
  FiscalSection,
  MonetarySection,
  SoySection,
} from "./_components/sections";
import { SummaryCards } from "./_components/summary-cards";
import { VisitRecorder } from "./_components/visit-recorder";

/** Los bloques en el orden de la página, con el nombre corto del índice. */
const BLOCKS = ARGENTINA_BLOCKS;

/** El índice de los bloques, con un punto en los que trajeron algo nuevo (ADR 0079). */
function BlockIndex({
  marks,
}: {
  readonly marks: ReturnType<typeof markedBlocks>;
}) {
  return (
    <SectionIndex
      label="Bloques del tablero"
      sections={BLOCKS.map((block) => ({
        ...block,
        trailing:
          marks[block.id] === undefined ? undefined : (
            <NewsDot status={marks[block.id]!} />
          ),
      }))}
    />
  );
}

export const metadata: Metadata = {
  title: "Argentina | Portal Financiero",
  description:
    "Actividad, dólar, inflación observada y esperada, resultado fiscal, comercio exterior y soja de la Argentina, con fuente y fecha.",
};

/** Ver [ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

/**
 * Tablero de la economía argentina (`F9-06`). Lee lo que guardaron los
 * comandos del BCRA, el INDEC, el distribuidor de Series de Tiempo y los pares
 * ADR, a un solo corte y sin descargar nada. Cada bloque dice su fuente y su
 * última fecha: las series no se publican el mismo día.
 */
export default async function ArgentinaPage() {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice health={health} surface="El tablero argentino" />
    );
  }

  let dashboard: ArgentinaDashboard;
  let readiness: ArgentinaRefreshReadiness | null = null;
  let remComparison: readonly RemInflationComparisonRow[] | null = null;

  try {
    // Only reads: the render plans no job and opens no socket (ADR 0070).
    readiness = await readArgentinaRefreshReadinessForRender();
  } catch (error) {
    console.error(
      "argentina refresh readiness failed",
      error instanceof Error ? error.name : typeof error,
    );
  }

  // One cutoff for the dashboard and for what arrived since the previous
  // visit, read side by side: the news never delays nor breaks the page.
  const readAt = new Date().toISOString();
  const newsRead = readNewsSafely(readAt);
  const calendarRead = readArgentinaCalendar(readAt, true).catch(() => []);

  try {
    dashboard = await loadArgentinaDashboard({
      indicators: getArgentinaIndicatorRepository(),
      macro: getMacroSeriesRepository(),
      adrPairs: getAdrPairRepository(),
      now: () => readAt,
    });
  } catch (error) {
    console.error(
      "argentina dashboard read failed",
      error instanceof Error ? error.name : typeof error,
    );

    return <DataUnavailableNotice surface="El tablero argentino" />;
  }

  try {
    remComparison = await readRemInflationComparison({
      knownAt: dashboard.readAt,
      knowledgeBasis: "public_availability",
      forecasts: getRemForecastRepository(),
      indicators: getArgentinaIndicatorRepository(),
      macro: getMacroSeriesRepository(),
    });
  } catch (error) {
    console.error(
      "argentina REM comparison read failed",
      error instanceof Error ? error.name : typeof error,
    );
  }

  const news = await newsRead;
  const blockMarks = markedBlocks(news);
  const expected = expectedArgentinePublications(
    await calendarRead,
    calendarDateIn(readAt, BUENOS_AIRES),
    {
      activity: dashboard.activity.latest?.on,
      monetary: dashboard.monetary.monthlyInflation.at(-1)?.on,
      trade: dashboard.external.months.findLast(
        (month) => month.exports !== null && month.imports !== null,
      )?.on,
      fiscal: dashboard.fiscal.yearToDate?.lastOn,
      rem: remComparison?.[0]?.forecast.roundMonth,
    },
  );

  return (
    <PageContainer>
      <PageHeader
        id="argentina-title"
        title="¿Cómo viene la economía argentina?"
        lead={
          <>
            INDEC, BCRA, Hacienda, la Bolsa de Rosario y Agricultura; cada serie
            con su fecha.
            <InfoTip title="Qué muestra el tablero">
              <p>
                Lo último que publicaron el INDEC, el BCRA, la Secretaría de
                Hacienda, la Bolsa de Comercio de Rosario y el Ministerio de
                Agricultura. Al abrir la página se busca lo que pudo haberse
                publicado desde la última revisión.
              </p>
              <p>
                Cada serie tiene su propia fecha: la actividad sale con dos
                meses de rezago y el dólar es diario. El REM muestra
                expectativas para los meses siguientes, separadas del IPC
                observado.
              </p>
              <p>
                Debajo de cada cifra de arriba, su cambio contra la lectura
                anterior: verde si favorece según la métrica (que baje la
                inflación o la brecha cambiaria, que suba la actividad), rojo si
                no. El signo escrito dice el sentido sin el color.
              </p>
              <p>El tablero no explica causas ni emite recomendaciones.</p>
            </InfoTip>
          </>
        }
      />

      <ArgentinaFreshnessProvider
        readAt={dashboard.readAt}
        rendered={readiness?.sources ?? null}
        needsRefresh={readiness?.needsRefresh ?? false}
        failedSources={readiness?.failedSources ?? []}
        blockMarks={blockMarks}
        expected={expected}
      >
        <ArgentinaRefresh />
        <CalendarRefreshOnOpen argentina />

        <VisitRecorder readAt={dashboard.readAt} />
        <NewsStrip news={news} />
        <SummaryCards dashboard={dashboard} news={news} />
        <BlockIndex marks={blockMarks} />

        <ActivitySection activity={dashboard.activity} />
        <DollarSection dollar={dashboard.dollar} />
        <ItcrmSection itcrm={dashboard.itcrm} />
        <CountryRiskSection countryRisk={dashboard.countryRisk} />
        <MonetarySection monetary={dashboard.monetary} />
        <RemInflationSection rows={remComparison} readAt={dashboard.readAt} />
        <FiscalSection fiscal={dashboard.fiscal} />
        <ExternalSection external={dashboard.external} />
        <SoySection soy={dashboard.soy} />
      </ArgentinaFreshnessProvider>
    </PageContainer>
  );
}

/**
 * What arrived since the previous session (ADR 0079). The render only reads
 * the visit; `VisitRecorder` writes it after the page is shown. Any failure
 * marks nothing.
 */
async function readNewsSafely(readAt: string): Promise<ArgentinaNews> {
  try {
    const visits = getSurfaceVisitRepository();
    return await readArgentinaNews({
      since: visitBaseline(await visits.read("argentina"), readAt),
      now: readAt,
      indicators: getArgentinaIndicatorRepository(),
      macro: getMacroSeriesRepository(),
      remForecasts: getRemForecastRepository(),
    });
  } catch (error) {
    console.error(
      "argentina news read failed",
      error instanceof Error ? error.name : typeof error,
    );
    return { status: "no_baseline" };
  }
}
