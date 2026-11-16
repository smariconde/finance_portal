import { Info } from "lucide-react";
import { InfoTip } from "@/app/_components/info-tip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import type { Metadata } from "next";
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
import { requestCompanyLogoUrl } from "@/server/config/company-logo";
import { getBusinessExcerptRepository } from "@/server/persistence/get-business-excerpt-repository";

import { SectorMatrixNav } from "./_components/sector-matrix-nav";
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
    <PageContainer>
      <PageHeader
        id="sector-matrix-title"
        title={
          <>
            ¿Qué empresas de {sector.label} compensaron mejor su riesgo a la
            baja a 2 y a 5 años?
          </>
        }
        lead={
          <>
            Sortino a 2 y 5 años contra el S&amp;P 500 Total Return.
            <InfoTip title="Cómo se lee la matriz">
              <p>
                Cada punto es una security del S&amp;P 500 en el sector a la
                fecha, con su ratio de Sortino en las dos ventanas: retorno
                sobre el riesgo a la baja. Más alto es mejor compensado.
              </p>
              <p>
                La referencia usa la misma base. Es una herramienta de lectura,
                no una recomendación.
              </p>
            </InfoTip>
          </>
        }
        actions={<SectorMatrixNav sectorCode={sector.code} current="risk" />}
      >
        {reading === "no_reference" ? null : (
          <MatrixMeta reading={reading} asOfLabel={asOfLabel!} />
        )}
      </PageHeader>

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
          <AlertTitle>Sin serie de referencia todavía</AlertTitle>
          <AlertDescription>
            La matriz aparece cuando termine de bajar el S&amp;P 500 Total
            Return.
          </AlertDescription>
        </Alert>
      ) : (
        <MatrixBody reading={reading} asOfLabel={asOfLabel!} />
      )}
    </PageContainer>
  );
}

async function MatrixBody({
  reading,
  asOfLabel,
}: {
  readonly reading: SectorRiskMatrixReading;
  readonly asOfLabel: string;
}) {
  const { matrix } = reading;
  const businessExcerpts =
    await getBusinessExcerptRepository().latestForEntities(
      [...new Set(matrix.points.map((point) => point.issuerLegalEntityId))],
      `${matrix.asOf}T23:59:59.999Z`,
    );

  return (
    <>
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
        <SectorRiskWorkspace
          matrix={matrix}
          asOfLabel={asOfLabel}
          businessExcerpts={Object.fromEntries(businessExcerpts)}
          logoUrls={Object.fromEntries(
            matrix.points.map((point) => [
              point.securityId,
              point.ticker === null
                ? null
                : requestCompanyLogoUrl(point.ticker),
            ]),
          )}
        />
      )}
    </>
  );
}

/**
 * La provenance en una línea, debajo del título: el cierre de las dos
 * ventanas, la fuente, la nota de calidad y el CSV. Fórmula, base de retorno,
 * referencia, población y versiones van en el ⓘ.
 */
function MatrixMeta({
  reading,
  asOfLabel,
}: {
  readonly reading: SectorRiskMatrixReading;
  readonly asOfLabel: string;
}) {
  const { matrix } = reading;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-x-1.5">
        Al
        <time
          dateTime={matrix.asOf}
          className="numeric font-medium text-foreground"
        >
          {asOfLabel}
        </time>
        <span aria-hidden="true">·</span>
        Yahoo Finance, total return
        <InfoTip title="Método y fuente">
          <p>
            <strong>Sortino</strong> diario con retorno mínimo 0, anualizado con
            k = {SORTINO_PARAMETERS.periodsPerYear}, en ventanas de calendario
            que cierran el último día guardado de la referencia.
          </p>
          <p>
            <strong>Total return:</strong> dividendos reinvertidos en el
            ex-date. Referencia: {matrix.reference.label} (^SP500TR), con la
            misma base.
          </p>
          <p>
            <strong>Población:</strong> miembros del S&amp;P 500 en el sector al
            cierre; quien salió antes no aparece. Precios diarios de Yahoo
            Finance, sin concesión contractual.
          </p>
          <p className="font-mono text-xs">{matrix.formulaVersion}</p>
        </InfoTip>
      </span>
      <SectorRiskQuality quality={reading.quality} />
      <span className="sm:ml-auto">
        <SectorRiskExport sectorCode={matrix.sector.code} />
      </span>
    </div>
  );
}
