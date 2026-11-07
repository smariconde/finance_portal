import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { DataTable, Fold } from "@/app/argentina/_components/block";
import { amount, shortMonth } from "@/app/argentina/_components/format";
import {
  TimelineChart,
  type ChartContext,
} from "@/app/argentina/_components/timeline-chart";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import { readIndicatorVintages } from "@/modules/macro-series/domain/argentina-indicator";
import {
  DECLARED_INDEC_EXPANDED_INDICATORS,
  declaredIndecExpandedIndicator,
} from "@/modules/macro-series/domain/declared-indec-expanded-indicators";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getArgentinaIndicatorRepository } from "@/server/persistence/get-argentina-indicator-repository";

export const metadata: Metadata = {
  title: "Series del INDEC | Portal Financiero",
  description:
    "Historias publicadas de IPC, canastas, industria, mayoristas, construcción y salarios, con sus bases y fechas propias.",
};

export const instant = false;

const GROUPS = [
  { title: "IPC por región", prefix: "ipc_", exclude: "ipc_division_" },
  { title: "IPC por división", prefix: "ipc_division_" },
  { title: "Canastas", prefix: "basket_" },
  { title: "Producción industrial", prefix: "ipi_" },
  { title: "Precios mayoristas", prefix: "sipm_" },
  { title: "Construcción", prefix: "icc_" },
  { title: "Salarios", prefix: "wages_" },
] as const;

const INDEC_CONTEXT: ChartContext = {
  toggleLabel: "Gobiernos",
  spansTitle: "",
  spans: [],
  seasons: [],
  seasonNote: "",
  eventsTitle: "",
  events: [],
  note: "Las presidencias son marcas de calendario, no explicaciones de la serie.",
};

const observedDate = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
  hour12: false,
});

type SearchParams = Promise<{ serie?: string | string[] }>;

/** Una serie por lectura: la unidad y la base nunca se mezclan en un eje. */
export default async function IndecSeriesPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice health={health} surface="Las series del INDEC" />
    );
  }

  const requested = (await searchParams).serie ?? "ipc_nacional";
  if (typeof requested !== "string") notFound();
  const indicator = declaredIndecExpandedIndicator(requested);
  if (indicator === null) notFound();

  const now = new Date().toISOString();
  let points;
  try {
    const stored = await getArgentinaIndicatorRepository().allObservations(
      indicator.id,
    );
    points = readIndicatorVintages(indicator, stored, {
      effectiveOn: now.slice(0, 10),
      knownAt: now,
      knowledgeBasis: "system_recorded",
    }).filter((point) => point.missingReason !== "withdrawn");
  } catch (error) {
    console.error(
      "indec expanded series read failed",
      error instanceof Error ? error.name : typeof error,
    );
    return <DataUnavailableNotice surface="Las series del INDEC" />;
  }

  const latest = points.at(-1);
  const latestValue = [...points]
    .reverse()
    .find((point) => point.value !== null);
  const isPesos = indicator.currency === "ARS";
  const level =
    latestValue?.value == null ? "Sin dato" : amount(latestValue.value, 2);
  const unit = isPesos ? "pesos por adulto equivalente" : "puntos de índice";
  const basis = indicator.indexBase ?? "precios corrientes, sin índice base";
  const rows = points.map((point) => ({
    on: point.periodOn,
    values: { level: point.value },
  }));
  const tableRows = [...points]
    .reverse()
    .map((point) => [
      shortMonth(point.periodOn),
      point.value === null
        ? "Sin dato publicado"
        : point.value.replace(".", ","),
      point.sourceNote ?? "—",
      observedDate.format(new Date(point.availableAt)),
      String(point.revision),
    ]);

  return (
    <main id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <nav aria-label="Volver al tablero argentino">
          <Link
            href="/argentina"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Volver a Argentina
          </Link>
        </nav>

        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Series del INDEC
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Elegí una serie para recorrer su historia publicada. Cada nivel
            conserva su unidad, base, mes y revisión. Son datos descriptivos;
            series con bases distintas no se comparan en un mismo eje.
          </p>
        </header>

        <form
          action="/argentina/indec"
          method="get"
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor="indec-serie" className="text-sm font-medium">
              Serie
            </label>
            <select
              id="indec-serie"
              name="serie"
              defaultValue={indicator.id}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {GROUPS.map((group) => (
                <optgroup key={group.title} label={group.title}>
                  {DECLARED_INDEC_EXPANDED_INDICATORS.filter(
                    (item) =>
                      item.id.startsWith(group.prefix) &&
                      (!("exclude" in group) ||
                        !item.id.startsWith(group.exclude)),
                  ).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.reportingScope}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className={buttonVariants({ variant: "secondary", size: "lg" })}
          >
            Ver serie
          </button>
        </form>

        <Card>
          <CardHeader className="gap-2">
            <CardTitle as="h2" className="text-lg">
              {indicator.reportingScope}
            </CardTitle>
            <p className="text-sm">
              {latestValue === undefined
                ? "Todavía no hay un nivel guardado."
                : `${level} ${unit} en ${shortMonth(latestValue.periodOn)}.`}
            </p>
            <p className="text-xs text-muted-foreground">
              Fuente: INDEC · {indicator.externalId} · {basis} · frecuencia
              mensual
              {latest ? ` · último período ${shortMonth(latest.periodOn)}` : ""}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {points.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Esta serie aún no tiene datos guardados en la base personal.
              </p>
            ) : (
              <>
                <TimelineChart
                  label={`Historia de ${indicator.reportingScope}, en ${unit}.`}
                  caption={`${indicator.reportingScope}, ${unit} por mes`}
                  monthly={rows}
                  frequency="monthly"
                  ranges={["2y", "5y", "10y", "max"]}
                  defaultRange="5y"
                  axis={isPesos ? "pesos" : "index"}
                  allowLog
                  showTable={false}
                  context={INDEC_CONTEXT}
                  series={[
                    {
                      key: "level",
                      label: indicator.reportingScope,
                      color: "var(--chart-1)",
                      mark: "line",
                      format: { kind: "amount", scale: 2 },
                      change: "ratio",
                    },
                  ]}
                />
                <DataTable
                  caption={`${indicator.reportingScope}: historia completa y revisiones visibles al corte actual`}
                  columns={[
                    { label: "Mes" },
                    {
                      label: `Nivel (${isPesos ? "ARS" : "índice"})`,
                      numeric: true,
                    },
                    { label: "Nota" },
                    { label: "Observado (ART)" },
                    { label: "Revisión", numeric: true },
                  ]}
                  rows={tableRows}
                />
              </>
            )}
            <Fold summary="Metodología y fuente">
              <div className="flex max-w-3xl flex-col gap-2 text-sm text-muted-foreground">
                <p>{indicator.methodology}</p>
                <p>
                  Unidad impresa por el INDEC: {indicator.unit}. Base: {basis}.
                  El portal guarda el nivel de cada mes tal como lo publica la
                  fuente; no concatena bases ni rellena meses sin dato.
                  «Observado (ART)» es cuando se consultó el servicio; no es una
                  fecha de publicación, que el INDEC no informa por punto.
                </p>
                <p>
                  Las notas convencionales se conservan como las imprime el
                  INDEC. «///» indica un valor faltante de la fuente; «*» indica
                  un dato provisorio. Una corrección futura abre una revisión,
                  sin borrar la anterior.
                </p>
              </div>
            </Fold>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
