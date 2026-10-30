import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { InfoTip } from "@/app/_components/info-tip";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { listSectors } from "@/modules/classification/domain/sector-taxonomy";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import { DILUTION_BRIDGE_VERSION } from "@/modules/divergences/domain/dilution-bridge";
import {
  DIVERGENCE_VIEWS_VERSION,
  SHARE_COUNT_BIAS_TOLERANCE_PP,
} from "@/modules/divergences/domain/divergence-views";
import type { SectorDivergenceMatrix } from "@/modules/divergences/application/sector-divergence-matrix";
import { formatCalendarDate } from "@/modules/valuation/domain/display-format";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { requestCompanyLogoUrl } from "@/server/config/company-logo";
import {
  loadStoredSectorDivergenceMatrix,
  readSecQuotaToday,
} from "@/server/divergences/load-sector-fiscal-endpoints";
import { readSectorDivergenceDownloadForPage } from "@/server/jobs/sector-divergence-download";

import { SectorMatrixNav } from "../_components/sector-matrix-nav";

import {
  DivergenceDownload,
  type DivergenceDownloadInitial,
} from "./_components/divergence-download";
import { DivergenceWorkspace } from "./_components/divergence-workspace";

/** Ver [ADR 0005](../../../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
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
    title: `${label ?? "Sector"}: divergencias | Portal Financiero`,
    description:
      "Crecimiento del EPS diluido contra el del market cap a 2 y 5 años, con el sesgo de recompras y dilución a la vista.",
  };
}

/**
 * Matriz de divergencias de un sector (`F8-02`, ADR 0016 §5). Siempre a hoy:
 * lee los cierres fiscales y precios guardados al instante del pedido. El
 * render no sale a la red ni escribe; si el sector no tiene fundamentales, lo
 * dice con lo que costaría bajarlos y la cuota SEC que queda, y el owner lo
 * pide con un botón (`downloadSectorDivergenceData`).
 */
export default async function SectorDivergencePage({ params }: PageProps) {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice
        health={health}
        surface="La matriz de divergencias sectorial"
      />
    );
  }

  const { sector: code } = await params;
  const sector = listSectors().find((entry) => entry.code === code);

  if (sector === undefined) {
    notFound();
  }

  let matrix: SectorDivergenceMatrix;
  let download: DivergenceDownloadInitial;
  let quota: Awaited<ReturnType<typeof readSecQuotaToday>> | null = null;

  try {
    const stored = await loadStoredSectorDivergenceMatrix(sector.code);
    matrix = stored.matrix;
    // Sólo lee: qué bajaría un clic o qué descarga sigue en curso.
    download = await readSectorDivergenceDownloadForPage({
      sectorCode: sector.code,
      reading: stored.reading,
    });
    if (download.state === "pending" && download.filers > 0) {
      quota = await readSecQuotaToday();
    }
  } catch (error) {
    // Sólo el tipo: el mensaje puede traer host, puerto o SQL (`TM-02`).
    console.error(
      "sector divergence read failed",
      error instanceof Error ? error.name : typeof error,
    );

    return (
      <DataUnavailableNotice surface="La matriz de divergencias sectorial" />
    );
  }

  const asOf = matrix.knownAt.slice(0, 10);

  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <section
          className="flex flex-col gap-3"
          aria-labelledby="sector-divergence-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/sectores"
              className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Matrices por sector
            </Link>
            <SectorMatrixNav sectorCode={sector.code} current="divergences" />
          </div>
          <h1
            id="sector-divergence-title"
            className="max-w-4xl text-2xl font-semibold tracking-tight text-balance md:text-3xl"
          >
            ¿Qué empresas de {sector.label} ganaron más de lo que subió su valor
            de mercado?
          </h1>
          <p className="flex max-w-3xl items-center gap-0.5 text-sm text-muted-foreground md:text-base">
            Las recompras hacen parecer más barata a una empresa y la dilución,
            más cara; el rombo marca cuando ese efecto supera{" "}
            {SHARE_COUNT_BIAS_TOLERANCE_PP} pp por año.
            <InfoTip title="Cómo se lee la matriz">
              <p>
                Cada punto compara el crecimiento anual del EPS diluido con el
                del market cap entre dos cierres fiscales. Sobre la diagonal,
                las ganancias crecieron más que el valor de mercado.
              </p>
              <p>
                El EPS es por acción y el market cap es un total: recomprar
                acciones sube el EPS sin cambiar el negocio. Por eso cada punto
                muestra cuánto de su brecha es el cambio de acciones. Es una
                herramienta de lectura, no una recomendación.
              </p>
            </InfoTip>
          </p>
        </section>

        <dl className="grid gap-x-8 gap-y-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Corte</dt>
            <dd className="numeric font-medium">
              <time dateTime={asOf}>{formatCalendarDate(asOf)}</time>
              <span className="block text-xs font-normal text-muted-foreground">
                Lo publicado y guardado hasta hoy
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Fundamentales</dt>
            <dd>
              SEC 10-K: EPS diluido, net income y acciones del ejercicio
              <span className="block text-xs text-muted-foreground">
                Último cierre fiscal y el comparable a 2 o 5 años
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Precio y market cap</dt>
            <dd>
              Cierre de Yahoo Finance hasta 7 días antes del cierre fiscal
              <span className="block text-xs text-muted-foreground">
                Crudo y llevado a la última base de splits confirmada por la SEC
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Fórmulas</dt>
            <dd>
              CAGR entre puntas positivas; días / 365,2425
              <span className="block text-xs text-muted-foreground">
                {DIVERGENCE_VIEWS_VERSION} · {DILUTION_BRIDGE_VERSION}
              </span>
            </dd>
          </div>
        </dl>

        <DivergenceDownload
          sectorCode={sector.code}
          initial={download}
          quota={quota}
          issuers={{
            total: matrix.coverage.issuers,
            covered: matrix.coverage.issuersWithFiscalYear,
          }}
        />

        {matrix.coverage.issuersWithFiscalYear === 0 ? null : (
          <DivergenceWorkspace
            rows={matrix.rows}
            logoUrls={Object.fromEntries(
              matrix.rows.map((row) => [
                row.securityId,
                row.ticker === null ? null : requestCompanyLogoUrl(row.ticker),
              ]),
            )}
          />
        )}
      </div>
    </div>
  );
}
