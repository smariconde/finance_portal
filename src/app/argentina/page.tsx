import type { Metadata } from "next";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { InfoTip } from "@/app/_components/info-tip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import {
  loadArgentinaDashboard,
  type ArgentinaDashboard,
} from "@/modules/argentina-dashboard/application/load-argentina-dashboard";
import type { ArgentinaRefreshReadiness } from "@/modules/argentina-dashboard/application/argentina-refresh";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { readArgentinaRefreshReadinessForRender } from "@/server/jobs/argentina-refresh";
import { getAdrPairRepository } from "@/server/persistence/get-adr-pair-repository";
import { getArgentinaIndicatorRepository } from "@/server/persistence/get-argentina-indicator-repository";
import { getMacroSeriesRepository } from "@/server/persistence/get-macro-series-repository";
import { getRemForecastRepository } from "@/server/persistence/get-rem-forecast-repository";
import {
  readRemInflationComparison,
  type RemInflationComparisonRow,
} from "@/modules/macro-series/application/read-rem-inflation-comparison";

import { ArgentinaRefresh } from "./_components/argentina-refresh";
import { BlockIndex } from "./_components/block-index";
import { ItcrmSection } from "./_components/itcrm-section";
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

/** Los bloques en el orden de la página, con el nombre corto del índice. */
const BLOCKS = [
  { id: "actividad", label: "Actividad" },
  { id: "dolar", label: "Dólar" },
  { id: "itcrm", label: "ITCRM" },
  { id: "monetario", label: "Inflación y reservas" },
  { id: "rem-inflacion", label: "REM" },
  { id: "fiscal", label: "Fiscal" },
  { id: "externo", label: "Comercio" },
  { id: "soja", label: "Soja" },
] as const;

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

  try {
    dashboard = await loadArgentinaDashboard({
      indicators: getArgentinaIndicatorRepository(),
      macro: getMacroSeriesRepository(),
      adrPairs: getAdrPairRepository(),
      now: () => new Date().toISOString(),
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
    });
  } catch (error) {
    console.error(
      "argentina REM comparison read failed",
      error instanceof Error ? error.name : typeof error,
    );
  }

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

      {readiness === null ? null : (
        <ArgentinaRefresh
          needsRefresh={readiness.needsRefresh}
          failedSources={readiness.failedSources}
        />
      )}

      <SummaryCards dashboard={dashboard} />
      <BlockIndex blocks={BLOCKS} />

      <ActivitySection activity={dashboard.activity} />
      <DollarSection dollar={dashboard.dollar} />
      <ItcrmSection itcrm={dashboard.itcrm} />
      <MonetarySection monetary={dashboard.monetary} />
      <RemInflationSection rows={remComparison} />
      <FiscalSection fiscal={dashboard.fiscal} />
      <ExternalSection external={dashboard.external} />
      <SoySection soy={dashboard.soy} />
    </PageContainer>
  );
}
