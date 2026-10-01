import { CalendarClock, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { listSectors } from "@/modules/classification/domain/sector-taxonomy";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import {
  loadSectorRiskMatrix,
  SectorRiskMatrixError,
  type SectorRiskMatrixReading,
} from "@/modules/metrics/application/load-sector-risk-matrix";
import { SORTINO_PARAMETERS } from "@/modules/metrics/domain/sortino";
import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";
import { formatCalendarDate } from "@/modules/valuation/domain/display-format";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getCedearRegistryRepository } from "@/server/persistence/get-cedear-registry-repository";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getPriceRepository } from "@/server/persistence/get-price-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

import { SectorRiskWorkspace } from "./_components/sector-risk-workspace";

/** Ver [ADR 0005](../../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;
type PageProps = {
  readonly params: Promise<{ sector: string }>;
  readonly searchParams: Promise<{ asOf?: string | string[] }>;
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
 * Todo se lee al mismo corte, el cierre del `as_of`, desde la base personal. La
 * página no llama a ninguna fuente: si faltan precios, lo dice.
 */
export default async function SectorRiskMatrixPage({
  params,
  searchParams,
}: PageProps) {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice
        health={health}
        surface="La matriz de riesgo sectorial"
      />
    );
  }

  const [{ sector: code }, query] = await Promise.all([params, searchParams]);
  const sector = listSectors().find((entry) => entry.code === code);

  if (sector === undefined) {
    notFound();
  }

  const today = todayUtc();
  const rawAsOf = Array.isArray(query.asOf) ? query.asOf[0] : query.asOf;
  const parsedAsOf =
    rawAsOf === undefined || rawAsOf === ""
      ? null
      : calendarDateSchema.safeParse(rawAsOf);
  const invalidAsOf =
    parsedAsOf !== null && (!parsedAsOf.success || parsedAsOf.data > today);
  const requestedAsOf =
    parsedAsOf !== null && parsedAsOf.success && !invalidAsOf
      ? parsedAsOf.data
      : null;

  let reading: SectorRiskMatrixReading | "no_reference";

  try {
    reading = await loadSectorRiskMatrix(
      { sectorCode: sector.code, asOf: requestedAsOf },
      {
        universe: getUniverseRepository(),
        classifications: getClassificationRepository(),
        prices: getPriceRepository(),
        cedears: getCedearRegistryRepository(),
        today: () => today,
      },
    );
  } catch (error) {
    if (
      error instanceof SectorRiskMatrixError &&
      error.code === "no_reference_series"
    ) {
      reading = "no_reference";
    } else {
      // Sólo el tipo: el mensaje puede traer host, puerto o SQL (`TM-02`).
      console.error(
        "sector risk matrix read failed",
        error instanceof Error ? error.name : typeof error,
      );

      return <DataUnavailableNotice surface="La matriz de riesgo sectorial" />;
    }
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

        <form
          method="get"
          className="flex flex-wrap items-end gap-3"
          aria-label="Fecha de la matriz"
        >
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Cierre al</span>
            <Input
              type="date"
              name="asOf"
              max={today}
              defaultValue={
                reading === "no_reference" ? undefined : reading.matrix.asOf
              }
              className="numeric w-44"
            />
          </label>
          <button
            type="submit"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Ver matriz
          </button>
        </form>

        {invalidAsOf ? (
          <Alert>
            <CalendarClock aria-hidden="true" />
            <AlertTitle>Fecha fuera de rango</AlertTitle>
            <AlertDescription>
              La fecha pedida no es válida o es posterior a hoy. Se muestra el
              último cierre guardado.
            </AlertDescription>
          </Alert>
        ) : null}

        {reading === "no_reference" ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertTitle>Sin serie de referencia para esa fecha</AlertTitle>
            <AlertDescription>
              No hay niveles del S&amp;P 500 Total Return guardados en los días
              previos a la fecha pedida, y sin referencia no hay contra qué
              comparar. Se cargan con{" "}
              <code className="font-mono text-xs">
                pnpm prices:ingest --benchmark sp500-total-return --apply
              </code>
              .
            </AlertDescription>
          </Alert>
        ) : (
          <MatrixBody
            reading={reading}
            asOfLabel={asOfLabel!}
            requested={requestedAsOf !== null}
          />
        )}
      </div>
    </div>
  );
}

function MatrixBody({
  reading,
  asOfLabel,
  requested,
}: {
  readonly reading: SectorRiskMatrixReading;
  readonly asOfLabel: string;
  /** Si la fecha la eligió el usuario; sin pedido, el cierre es el último. */
  readonly requested: boolean;
}) {
  const { matrix } = reading;
  const moved = requested && reading.requestedAsOf !== matrix.asOf;

  return (
    <>
      <dl className="grid gap-x-8 gap-y-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Cierre de las dos ventanas</dt>
          <dd className="numeric font-medium">
            <time dateTime={matrix.asOf}>{asOfLabel}</time>
            {moved ? (
              <span className="block text-xs font-normal text-muted-foreground">
                Último cierre en o antes del{" "}
                {formatCalendarDate(reading.requestedAsOf)}
              </span>
            ) : null}
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

      {reading.seriesWithoutRows > 0 ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>
            {reading.seriesWithoutRows} de {matrix.points.length} securities sin
            precios cargados
          </AlertTitle>
          <AlertDescription>
            Aparecen en «Sin valor» como «Sin cierre en la fecha». Se cargan con{" "}
            <code className="font-mono text-xs">
              pnpm prices:ingest --sector {matrix.sector.code} --apply
            </code>
            .
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
