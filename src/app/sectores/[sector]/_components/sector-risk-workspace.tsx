"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, CircleSlash } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { CompanyMark } from "@/app/_components/company-mark";
import type { BusinessExcerpt } from "@/modules/companies/domain/sec-business-excerpt";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  SectorRiskMatrix,
  SectorRiskPoint,
} from "@/modules/metrics/domain/sector-risk-matrix";
import type { SortinoResult } from "@/modules/metrics/domain/sortino";
import {
  formatAmount,
  formatCalendarDate,
  formatSignedAmount,
} from "@/modules/valuation/domain/display-format";

import { MatrixChart, type MatrixLogo } from "./matrix-chart";
import {
  describeCedear,
  describePoint,
  formatSortino,
  layoutMatrix,
  NULL_REASON_LABELS,
  pointLabel,
  QUADRANT_LABELS,
} from "./matrix-layout";

type SortKey =
  "ticker" | "sortino2y" | "sortino5y" | "distance2y" | "distance5y";

const SORT_LABELS: Record<SortKey, string> = {
  ticker: "Ticker",
  sortino2y: "Sortino 2 años",
  sortino5y: "Sortino 5 años",
  distance2y: "Vs. ref. 2 años",
  distance5y: "Vs. ref. 5 años",
};

function numericKey(point: SectorRiskPoint, key: SortKey): number | null {
  const raw =
    key === "sortino2y"
      ? point.sortino2y.status === "computed"
        ? point.sortino2y.value
        : null
      : key === "sortino5y"
        ? point.sortino5y.status === "computed"
          ? point.sortino5y.value
          : null
        : key === "distance2y"
          ? point.distanceToReference.window2y
          : point.distanceToReference.window5y;

  return raw === null ? null : Number(raw);
}

function sortPoints(
  points: readonly SectorRiskPoint[],
  key: SortKey,
  direction: "ascending" | "descending",
) {
  const sign = direction === "ascending" ? 1 : -1;

  return [...points].sort((left, right) => {
    if (key === "ticker") {
      return sign * pointLabel(left).localeCompare(pointLabel(right));
    }

    const a = numericKey(left, key);
    const b = numericKey(right, key);

    // Un `null` va siempre al final: no es el menor ni el mayor, no es un valor.
    if (a === null || b === null) {
      return a === b ? 0 : a === null ? 1 : -1;
    }

    return sign * (a - b);
  });
}

function SortinoCell({ result }: { readonly result: SortinoResult }) {
  if (result.status === "computed") {
    return (
      <span className="numeric" title={result.value}>
        {formatAmount(result.value, { scale: 2 })}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <CircleSlash className="size-3.5" aria-hidden="true" />
      {NULL_REASON_LABELS[result.reason] ?? result.reason}
    </span>
  );
}

function DistanceCell({ value }: { readonly value: string | null }) {
  return value === null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="numeric" title={value}>
      {formatSignedAmount(value, { scale: 2 })}
    </span>
  );
}

function CedearBadge({ point }: { readonly point: SectorRiskPoint }) {
  if (point.cedear.status !== "program") {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span
        aria-hidden="true"
        className="size-2 rounded-[2px] bg-[var(--chart-1)]"
      />
      {describeCedear(point.cedear)}
    </Badge>
  );
}

function SelectedPoint({
  point,
  matrix,
  businessExcerpt,
}: {
  readonly point: SectorRiskPoint | null;
  readonly matrix: SectorRiskMatrix;
  readonly businessExcerpt: BusinessExcerpt | null;
}) {
  if (point === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Elegí un punto con Tab, un click o desde la tabla para ver sus valores
        exactos. El rombo es la referencia: {matrix.reference.label}.
      </p>
    );
  }

  const rows: [string, React.ReactNode][] = [
    ["Sortino 2 años", <SortinoCell key="2y" result={point.sortino2y} />],
    ["Sortino 5 años", <SortinoCell key="5y" result={point.sortino5y} />],
    [
      "Vs. referencia 2 años",
      <DistanceCell key="d2" value={point.distanceToReference.window2y} />,
    ],
    [
      "Vs. referencia 5 años",
      <DistanceCell key="d5" value={point.distanceToReference.window5y} />,
    ],
    ["Acceso local", describeCedear(point.cedear)],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-base font-semibold">
          {pointLabel(point)}
          {point.mic === null ? null : (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {point.mic}
            </span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {point.issuerName ?? "Emisor sin nombre registrado"}
        </p>
      </div>
      {businessExcerpt === null ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay un extracto del 10-K para esta empresa.
          {point.ticker === null ? null : (
            <>
              {" "}
              <a
                href={`https://finviz.com/stock?t=${encodeURIComponent(point.ticker)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Ver perfil en Finviz
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </>
          )}
        </p>
      ) : (
        <figure className="space-y-1 text-sm">
          <blockquote lang="en" className="text-foreground">
            “{businessExcerpt.excerpt}”
          </blockquote>
          <figcaption className="text-xs text-muted-foreground">
            Extracto literal de Item 1, 10-K ·{" "}
            {formatCalendarDate(businessExcerpt.acceptedAt.slice(0, 10))} ·{" "}
            <a
              href={businessExcerpt.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              SEC
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </figcaption>
        </figure>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        {point.quadrant === null
          ? "Sin ubicación respecto de la referencia: falta una de las dos ventanas."
          : QUADRANT_LABELS[point.quadrant]}
      </p>
    </div>
  );
}

export function SectorRiskWorkspace({
  matrix,
  asOfLabel,
  logoUrls,
  businessExcerpts,
}: {
  readonly matrix: SectorRiskMatrix;
  readonly asOfLabel: string;
  /** El logo de cada security por su ID (ADR 0062); `null` muestra el monograma. */
  readonly logoUrls: Readonly<Record<string, string | null>>;
  readonly businessExcerpts: Readonly<Record<string, BusinessExcerpt>>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<{
    key: SortKey;
    direction: "ascending" | "descending";
  }>({ key: "sortino5y", direction: "descending" });

  const layout = useMemo(() => layoutMatrix(matrix), [matrix]);
  const descriptions = useMemo(
    () =>
      new Map(
        matrix.points.map((point) => [point.securityId, describePoint(point)]),
      ),
    [matrix],
  );
  const logos = useMemo(
    () =>
      new Map<string, MatrixLogo>(
        matrix.points.map((point) => [
          point.securityId,
          {
            url: logoUrls[point.securityId] ?? null,
            name: point.issuerName,
            ticker: point.ticker ?? point.securityId,
          },
        ]),
      ),
    [matrix, logoUrls],
  );
  const rows = useMemo(
    () => sortPoints(matrix.points, sort.key, sort.direction),
    [matrix, sort],
  );
  const selected =
    matrix.points.find((point) => point.securityId === selectedId) ?? null;
  const cedearCount = matrix.points.filter(
    (point) => point.cedear.status === "program",
  ).length;

  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? {
            key,
            direction:
              current.direction === "ascending" ? "descending" : "ascending",
          }
        : { key, direction: key === "ticker" ? "ascending" : "descending" },
    );

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle as="h2" id={titleId}>
              Sortino a 2 años contra Sortino a 5 años
            </CardTitle>
            <CardDescription id={descriptionId}>
              {layout.points.length} de {matrix.points.length} securities
              dibujadas; las demás están en «Sin valor» con su motivo. Las
              líneas punteadas cruzan en la referencia: arriba a la derecha
              queda quien la superó en las dos ventanas.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <MatrixChart
              layout={layout}
              descriptions={descriptions}
              logos={logos}
              selectedId={selectedId}
              onSelect={setSelectedId}
              titleId={titleId}
              descriptionId={descriptionId}
              asOfLabel={asOfLabel}
            />
            <ul
              aria-label="Cómo leer el gráfico"
              className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"
            >
              <li className="flex items-center gap-1.5">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 34 16"
                  className="h-4 w-[2.125rem]"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="7"
                    className="fill-muted stroke-foreground/25"
                    strokeWidth="1"
                  />
                  <circle
                    cx="27"
                    cy="8"
                    r="4.5"
                    className="fill-background stroke-muted-foreground"
                    strokeWidth="1.75"
                  />
                </svg>
                Sin CEDEAR: borde fino o punto hueco
              </li>
              <li className="flex items-center gap-1.5">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 34 16"
                  className="h-4 w-[2.125rem]"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="6.5"
                    className="fill-muted stroke-[var(--chart-1)]"
                    strokeWidth="2.5"
                  />
                  <rect
                    x="10"
                    y="10"
                    width="5.5"
                    height="5.5"
                    rx="1"
                    className="fill-[var(--chart-1)] stroke-background"
                    strokeWidth="1"
                  />
                  <rect
                    x="22.5"
                    y="3.5"
                    width="9"
                    height="9"
                    rx="1.5"
                    className="fill-[var(--chart-1)]"
                  />
                </svg>
                Con CEDEAR vigente ({cedearCount}): anillo grueso con insignia,
                o cuadrado
              </li>
              <li className="flex items-center gap-1.5">
                <svg aria-hidden="true" viewBox="0 0 28 20" className="h-5 w-7">
                  <path
                    d="M10 1 L19 10 L10 19 L1 10 Z"
                    className="fill-foreground stroke-background"
                    strokeWidth="2"
                  />
                  <circle cx="10" cy="10" r="2" className="fill-background" />
                </svg>
                {matrix.reference.label}: rombo y placa, misma base y ventanas
              </li>
              <li className="flex items-center gap-1.5">
                <svg aria-hidden="true" viewBox="0 0 16 12" className="h-3 w-4">
                  <line
                    x1="0"
                    y1="6"
                    x2="16"
                    y2="6"
                    stroke="var(--chart-4)"
                    strokeWidth="1.5"
                  />
                </svg>
                {matrix.fit.status === "computed"
                  ? `Ajuste lineal del sector (n = ${matrix.fit.n}), no un valor justo`
                  : `Sin recta de ajuste: ${matrix.fit.reason === "too_few_points" ? `hacen falta 3 puntos y hay ${matrix.fit.n}` : "los puntos no varían en 2 años"}`}
              </li>
              <li>
                Donde los logos se tapan, la marca queda como punto y muestra su
                logo al elegirla.
              </li>
              {layout.points.some(
                (point) => point.clipX !== 0 || point.clipY !== 0,
              ) ? (
                <li>
                  Un punto con flecha está fuera de escala: su valor exacto está
                  en la tabla.
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>

        <Card size="sm" className="xl:self-start">
          <CardHeader>
            <CardTitle as="h2">Punto seleccionado</CardTitle>
          </CardHeader>
          <CardContent aria-live="polite">
            <SelectedPoint
              point={selected}
              matrix={matrix}
              businessExcerpt={
                selected === null
                  ? null
                  : (businessExcerpts[selected.issuerLegalEntityId] ?? null)
              }
            />
          </CardContent>
        </Card>
      </div>

      {layout.notDrawn.length === 0 ? null : (
        <Card size="sm">
          <CardHeader>
            <CardTitle as="h2">Sin valor en alguna ventana</CardTitle>
            <CardDescription>
              No se dibujan ni cuentan para la recta: un valor faltante no es un
              cero.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {layout.notDrawn.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2"
                >
                  <span className="font-medium">{entry.label}</span>
                  <span className="text-muted-foreground">
                    2 años: {formatSortino(entry.window2y)} · 5 años:{" "}
                    {formatSortino(entry.window5y)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Tabla de la matriz</CardTitle>
          <CardDescription>
            Los mismos valores que el gráfico, sin recorte de escala. Elegir un
            ticker lo resalta en el gráfico.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <caption className="sr-only">
              Sortino a 2 y 5 años por security al {asOfLabel}, con la
              diferencia contra la referencia y el acceso por CEDEAR
            </caption>
            <TableHeader>
              <TableRow>
                {(
                  [
                    // Los números primero: en mobile la tabla se desplaza, y lo
                    // que se lee sin desplazar es la respuesta.
                    "ticker",
                    "sortino2y",
                    "sortino5y",
                    "distance2y",
                    "distance5y",
                    null,
                    null,
                  ] as const
                ).map((key, index) => {
                  if (key === null) {
                    return (
                      <TableHead key={index}>
                        {index === 6 ? "Emisor" : "CEDEAR"}
                      </TableHead>
                    );
                  }

                  const active = sort.key === key;
                  const Icon = !active
                    ? ArrowUpDown
                    : sort.direction === "ascending"
                      ? ArrowUp
                      : ArrowDown;

                  return (
                    <TableHead
                      key={key}
                      aria-sort={active ? sort.direction : "none"}
                      className={key === "ticker" ? undefined : "text-right"}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className="inline-flex items-center gap-1 rounded-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {SORT_LABELS[key]}
                        <Icon className="size-3.5" aria-hidden="true" />
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 12 12"
                      className="size-3"
                    >
                      <path
                        d="M6 1 L11 6 L6 11 L1 6 Z"
                        className="fill-background stroke-foreground"
                        strokeWidth="1.5"
                      />
                    </svg>
                    Referencia
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <SortinoCell result={matrix.reference.sortino2y} />
                </TableCell>
                <TableCell className="text-right">
                  <SortinoCell result={matrix.reference.sortino5y} />
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-muted-foreground">—</span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-muted-foreground">—</span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground">—</span>
                </TableCell>
                <TableCell>{matrix.reference.label}</TableCell>
              </TableRow>
              {rows.map((point) => {
                const active = point.securityId === selectedId;

                return (
                  <TableRow
                    key={point.securityId}
                    data-state={active ? "selected" : undefined}
                  >
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <CompanyMark
                          ticker={point.ticker ?? point.securityId}
                          name={point.issuerName}
                          logoUrl={logoUrls[point.securityId] ?? null}
                          size="sm"
                        />
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() => setSelectedId(point.securityId)}
                          className={cn(
                            "rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                            active && "text-primary",
                          )}
                        >
                          {pointLabel(point)}
                        </button>
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <SortinoCell result={point.sortino2y} />
                    </TableCell>
                    <TableCell className="text-right">
                      <SortinoCell result={point.sortino5y} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DistanceCell
                        value={point.distanceToReference.window2y}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <DistanceCell
                        value={point.distanceToReference.window5y}
                      />
                    </TableCell>
                    <TableCell>
                      <CedearBadge point={point} />
                    </TableCell>
                    <TableCell className="max-w-56 truncate">
                      {point.issuerName ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
