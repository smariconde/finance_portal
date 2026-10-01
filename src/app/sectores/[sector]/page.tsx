import { Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { listSectors } from "@/modules/classification/domain/sector-taxonomy";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import {
  loadSectorRiskMatrix,
  SectorRiskMatrixError,
  type SectorRiskMatrixReading,
} from "@/modules/metrics/application/load-sector-risk-matrix";
import { SORTINO_PARAMETERS } from "@/modules/metrics/domain/sortino";
import {
  readSectorPriceReadiness,
  type SectorPriceReadiness,
} from "@/modules/prices/application/sector-price-refresh";
import { formatCalendarDate } from "@/modules/valuation/domain/display-format";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getCedearRegistryRepository } from "@/server/persistence/get-cedear-registry-repository";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getIngestionJobStore } from "@/server/persistence/get-ingestion-job-store";
import { getPriceRepository } from "@/server/persistence/get-price-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

import { SectorPriceRefresh } from "./_components/sector-price-refresh";
import { SectorRiskExport } from "./_components/sector-risk-export";
import { SectorRiskQuality } from "./_components/sector-risk-quality";
import { SectorRiskWorkspace } from "./_components/sector-risk-workspace";

/** Ver [ADR 0005](../../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;
type PageProps = {
  readonly params: Promise<{ sector: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { sector } = await params;
  const label = listSectors().find((entry) => entry.code === sector)?.label;

  return {
    title: `${label ?? "Sector"}: matriz de riesgo | Portal Financiero`,
    description:
      "Sortino a 2 y 5 años de cada security del sector, contra el S&P 500 Total Return y con el acceso por CEDEAR.",
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Matriz de riesgo de un sector (`F7-05`,
 * [ADR 0029](../../../../docs/architecture/adr/0029-reference-series-sector-risk-matrix.md)).
 *
 * Siempre a hoy: el `as_of` es el último cierre guardado de la referencia. Todo
 * se lee al mismo corte desde la base personal, y el render no sale a la red ni
 * escribe: si faltan precios, lo dice, y la descarga la dispara el cliente con
 * la Server Action (`F7-08`,
 * [ADR 0030](../../../../docs/architecture/adr/0030-sector-prices-on-open.md)).
 */
export default async function SectorRiskMatrixPage({ params }: PageProps) {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice
        health={health}
        surface="La matriz de riesgo sectorial"
      />
    );
  }

  const { sector: code } = await params;
  const sector = listSectors().find((entry) => entry.code === code);

  if (sector === undefined) {
    notFound();
  }

  const today = todayUtc();
  const universe = getUniverseRepository();
  const classifications = getClassificationRepository();
  const prices = getPriceRepository();

  let reading: SectorRiskMatrixReading | "no_reference";
  let readiness: SectorPriceReadiness;

  try {
    [readiness, reading] = await Promise.all([
      readSectorPriceReadiness(
        { sectorCode: sector.code },
        {
          universe,
          classifications,
          prices,
          jobs: getIngestionJobStore(),
          now: () => new Date().toISOString(),
        },
      ),
      loadSectorRiskMatrix(
        { sectorCode: sector.code, asOf: null },
        {
          universe,
          classifications,
          prices,
          cedears: getCedearRegistryRepository(),
          today: () => today,
        },
      ).catch((error: unknown) => {
        // Sin referencia no hay matriz, pero sí hay qué descargar.
        if (
          error instanceof SectorRiskMatrixError &&
          error.code === "no_reference_series"
        ) {
          return "no_reference" as const;
        }

        throw error;
      }),
    ]);
  } catch (error) {
    // Sólo el tipo: el mensaje puede traer host, puerto o SQL (`TM-02`).
    console.error(
      "sector risk matrix read failed",
      error instanceof Error ? error.name : typeof error,
    );

    return <DataUnavailableNotice surface="La matriz de riesgo sectorial" />;
  }

  const asOfLabel =
    reading === "no_reference" ? null : formatCalendarDate(reading.matrix.asOf);

  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <section
          className="flex flex-col gap-3"
          aria-labelledby="sector-matrix-title"
        >
          <Link
            href="/sectores"
            className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Matrices por sector
          </Link>
          <h1
            id="sector-matrix-title"
            className="max-w-4xl text-2xl font-semibold tracking-tight text-balance md:text-3xl"
          >
            ¿Qué empresas de {sector.label} compensaron mejor su riesgo a la
            baja a 2 y a 5 años?
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Cada punto es una security del S&amp;P 500 en el sector a la fecha,
            con su ratio de Sortino en las dos ventanas. Compara contra el
            S&amp;P 500 Total Return en la misma base. Es una herramienta de
            lectura, no una recomendación.
          </p>
        </section>

        <SectorPriceRefresh
          sectorCode={sector.code}
          needsRefresh={readiness.needsRefresh}
          failed={readiness.failed}
          targetSessionLabel={
            readiness.targetSession === null
              ? null
              : formatCalendarDate(readiness.targetSession)
          }
        />

        {reading === "no_reference" ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertTitle>Todavía no hay serie de referencia</AlertTitle>
            <AlertDescription>
              No hay niveles recientes del S&amp;P 500 Total Return guardados, y
              sin referencia no hay contra qué comparar. La matriz aparece
              cuando termine de descargarse.
            </AlertDescription>
          </Alert>
        ) : (
          <MatrixBody
            reading={reading}
            asOfLabel={asOfLabel!}
            refreshing={readiness.needsRefresh}
          />
        )}
      </div>
    </div>
  );
}

function MatrixBody({
  reading,
  asOfLabel,
  refreshing,
}: {
  readonly reading: SectorRiskMatrixReading;
  readonly asOfLabel: string;
  /** Hay una descarga por delante: el aviso de faltantes sería prematuro. */
  readonly refreshing: boolean;
}) {
  const { matrix } = reading;

  return (
    <>
      <SectorRiskExport sectorCode={matrix.sector.code} />
      <dl className="grid gap-x-8 gap-y-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Cierre de las dos ventanas</dt>
          <dd className="numeric font-medium">
            <time dateTime={matrix.asOf}>{asOfLabel}</time>
            <span className="block text-xs font-normal text-muted-foreground">
              Último cierre guardado de la referencia
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Fórmula</dt>
          <dd>
            Sortino diario, retorno mínimo 0, anualizado con k ={" "}
            {SORTINO_PARAMETERS.periodsPerYear}
            <span className="block text-xs text-muted-foreground">
              {matrix.formulaVersion} · ventanas de calendario
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Base de retorno</dt>
          <dd>
            Total return: dividendos reinvertidos en el ex-date
            <span className="block text-xs text-muted-foreground">
              Referencia: {matrix.reference.label} (^SP500TR)
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Fuente y población</dt>
          <dd>
            Precios diarios de Yahoo Finance, sin concesión contractual
            <span className="block text-xs text-muted-foreground">
              Miembros del S&amp;P 500 al cierre: quien salió antes no aparece
            </span>
          </dd>
        </div>
      </dl>

      <SectorRiskQuality quality={reading.quality} />

      {reading.seriesWithoutRows > 0 && !refreshing ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>
            {reading.seriesWithoutRows} de {matrix.points.length} securities sin
            precios guardados
          </AlertTitle>
          <AlertDescription>
            Aparecen en «Sin valor» como «Sin cierre en la fecha».
          </AlertDescription>
        </Alert>
      ) : null}

      {matrix.points.length === 0 ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>El sector no tiene miembros a esa fecha</AlertTitle>
          <AlertDescription>
            Ninguna security del índice estaba clasificada en{" "}
            {matrix.sector.label} al cierre pedido.
          </AlertDescription>
        </Alert>
      ) : (
        <SectorRiskWorkspace matrix={matrix} asOfLabel={asOfLabel} />
      )}
    </>
  );
}
