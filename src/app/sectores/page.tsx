import { ChevronRight, Info } from "lucide-react";
import type { Metadata } from "next";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { InfoTip } from "@/app/_components/info-tip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { StatTile } from "@/app/_components/stat-tile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import {
  RECENT_CLOSE_DAYS,
  summarizeSectorCoverage,
  type SectorCoverage,
  type SectorCoverageSummary,
} from "@/modules/metrics/application/summarize-sector-coverage";
import { formatCalendarDate } from "@/modules/valuation/domain/display-format";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getPriceRepository } from "@/server/persistence/get-price-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

export const metadata: Metadata = {
  title: "Matrices por sector | Portal Financiero",
  description:
    "Los once sectores del S&P 500 y cuántas de sus securities tienen precios para la matriz de riesgo.",
};

/** Ver [ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

/**
 * Índice de matrices sectoriales (`F7-05`). Antes de entrar a un sector dice
 * cuántas de sus securities tienen precios: un sector sin cobertura no ofrece
 * una matriz llena de faltantes que parezca una respuesta.
 */
export default async function SectorsPage() {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice health={health} surface="Las matrices por sector" />
    );
  }

  let summary: SectorCoverageSummary;

  try {
    summary = await summarizeSectorCoverage({
      universe: getUniverseRepository(),
      classifications: getClassificationRepository(),
      prices: getPriceRepository(),
      today: () => new Date().toISOString().slice(0, 10),
    });
  } catch (error) {
    console.error(
      "sector coverage read failed",
      error instanceof Error ? error.name : typeof error,
    );

    return <DataUnavailableNotice surface="Las matrices por sector" />;
  }

  return (
    <PageContainer>
      <PageHeader
        id="sectors-title"
        title="Matrices por sector"
        lead={
          <>
            Sortino a 2 y 5 años y divergencias de los once sectores del S&amp;P
            500.
            <InfoTip title="Qué hay en cada sector">
              <p>
                Cada matriz compara el Sortino a 2 y a 5 años de las securities
                de un sector contra el S&amp;P 500 Total Return, a hoy.
              </p>
              <p>
                Cada tile cuenta las securities del índice a hoy que tienen un
                cierre en los últimos {RECENT_CLOSE_DAYS} días. Al abrir un
                sector se descargan sólo los precios que le falten; lo ya
                guardado no se vuelve a pedir.
              </p>
            </InfoTip>
          </>
        }
      >
        {summary.referenceLatest === null ? null : (
          <p className="text-sm text-muted-foreground">
            {summary.referenceLabel} al{" "}
            <time
              dateTime={summary.referenceLatest}
              className="numeric font-medium text-foreground"
            >
              {formatCalendarDate(summary.referenceLatest)}
            </time>
          </p>
        )}
      </PageHeader>

      {summary.referenceLatest === null ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>Sin serie de referencia reciente</AlertTitle>
          <AlertDescription>
            Se descarga al abrir cualquier sector.
          </AlertDescription>
        </Alert>
      ) : null}

      <section
        aria-labelledby="sectors-list-title"
        className="flex flex-col gap-3"
      >
        <h2 id="sectors-list-title" className="sr-only">
          Sectores del S&amp;P 500
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {summary.sectors.map((sector) => (
            <li key={sector.code} className="flex">
              <SectorTile sector={sector} />
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}

/**
 * Un sector: cuántas securities tienen precio reciente, con una barra para
 * comparar los once de un vistazo y una palabra para el estado.
 */
function SectorTile({ sector }: { readonly sector: SectorCoverage }) {
  const complete =
    sector.members > 0 && sector.withRecentCloses === sector.members;
  const empty = sector.withRecentCloses === 0;
  const share =
    sector.members === 0 ? 0 : (sector.withRecentCloses / sector.members) * 100;

  return (
    <StatTile
      href={`/sectores/${sector.code}`}
      size="sm"
      className="w-full"
      label={
        <span className="flex w-full items-center justify-between gap-2 text-sm text-foreground">
          {sector.label}
          <ChevronRight
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
        </span>
      }
      value={sector.withRecentCloses}
      unit={`de ${sector.members} con precios`}
      detail={
        <span className="flex flex-col gap-1.5">
          {/* La barra repite el conteo: es para comparar los once sectores. */}
          <span
            aria-hidden="true"
            className="block h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <span
              className={
                complete
                  ? "block h-full rounded-full bg-chart-1"
                  : "block h-full rounded-full bg-chart-1/50"
              }
              style={{ width: `${share}%` }}
            />
          </span>
          {empty
            ? "Se descargan al abrirlo"
            : complete
              ? "Completos"
              : "Parciales"}
        </span>
      }
    />
  );
}
