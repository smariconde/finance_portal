import type { Metadata } from "next";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
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

import { ArgentinaRefresh } from "./_components/argentina-refresh";
import { ItcrmSection } from "./_components/itcrm-section";
import {
  ActivitySection,
  DollarSection,
  ExternalSection,
  FiscalSection,
  MonetarySection,
  SoySection,
} from "./_components/sections";
import { SummaryCards } from "./_components/summary-cards";

export const metadata: Metadata = {
  title: "Argentina | Portal Financiero",
  description:
    "Actividad, dólar, inflación, resultado fiscal, comercio exterior y soja de la Argentina al último dato guardado, con su fuente y su fecha.",
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

  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <section
          className="flex flex-col gap-3"
          aria-labelledby="argentina-title"
        >
          <h1
            id="argentina-title"
            className="text-2xl font-semibold tracking-tight md:text-3xl"
          >
            ¿Cómo viene la economía argentina?
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Lo último que publicaron el INDEC, el BCRA, la Secretaría de
            Hacienda, la Bolsa de Comercio de Rosario y el Ministerio de
            Agricultura. Al abrir la página se busca lo que pudo haberse
            publicado desde la última revisión. Cada serie tiene su propia
            fecha: la actividad sale con dos meses de rezago y el dólar es
            diario. Describe lo que pasó; no explica por qué ni anticipa lo que
            viene.
          </p>
        </section>

        {readiness === null ? null : (
          <ArgentinaRefresh
            needsRefresh={readiness.needsRefresh}
            failedSources={readiness.failedSources}
          />
        )}

        <SummaryCards dashboard={dashboard} />

        <ActivitySection activity={dashboard.activity} />
        <DollarSection dollar={dashboard.dollar} />
        <ItcrmSection itcrm={dashboard.itcrm} />
        <MonetarySection monetary={dashboard.monetary} />
        <FiscalSection fiscal={dashboard.fiscal} />
        <ExternalSection external={dashboard.external} />
        <SoySection soy={dashboard.soy} />
      </div>
    </div>
  );
}
