import { ChevronRight, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import {
  RECENT_CLOSE_DAYS,
  summarizeSectorCoverage,
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
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <section
          className="flex flex-col gap-3"
          aria-labelledby="sectors-title"
        >
          <h1
            id="sectors-title"
            className="text-2xl font-semibold tracking-tight md:text-3xl"
          >
            Matrices de riesgo por sector
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Cada matriz compara el Sortino a 2 y a 5 años de las securities de
            un sector contra el S&amp;P 500 Total Return, a hoy. Al abrir un
            sector se descargan sólo los precios que le falten; lo ya guardado
            no se vuelve a pedir.
          </p>
        </section>

        {summary.referenceLatest === null ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertTitle>Sin serie de referencia reciente</AlertTitle>
            <AlertDescription>
              No hay niveles del {summary.referenceLabel} en los últimos{" "}
              {RECENT_CLOSE_DAYS} días. Se descargan al abrir cualquier sector.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle as="h2">Sectores del S&amp;P 500</CardTitle>
            <CardDescription>
              Securities del índice a hoy y cuántas tienen un cierre en los
              últimos {RECENT_CLOSE_DAYS} días.
              {summary.referenceLatest === null ? null : (
                <>
                  {" "}
                  Último nivel de la referencia:{" "}
                  <time dateTime={summary.referenceLatest} className="numeric">
                    {formatCalendarDate(summary.referenceLatest)}
                  </time>
                  .
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {summary.sectors.map((sector) => {
                const complete =
                  sector.members > 0 &&
                  sector.withRecentCloses === sector.members;
                const empty = sector.withRecentCloses === 0;

                return (
                  <li key={sector.code}>
                    <Link
                      href={`/sectores/${sector.code}`}
                      className="group flex items-center justify-between gap-4 rounded-md px-2 py-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium">{sector.label}</span>
                        <span className="text-sm text-muted-foreground">
                          {empty
                            ? "Sin precios: se descargan al abrirlo"
                            : complete
                              ? "Precios completos"
                              : "Precios parciales"}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="numeric text-sm">
                          {sector.withRecentCloses} de {sector.members}
                        </span>
                        <ChevronRight
                          className="size-4 text-muted-foreground group-hover:text-foreground"
                          aria-hidden="true"
                        />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
