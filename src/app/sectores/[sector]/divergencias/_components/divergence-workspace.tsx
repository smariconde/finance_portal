"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronsRight,
  CircleCheck,
  CircleSlash,
  CircleX,
} from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { CompanyMark } from "@/app/_components/company-mark";
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
  DivergenceHorizon,
  SectorDivergenceRow,
} from "@/modules/divergences/application/sector-divergence-matrix";
import type { EndpointBridge } from "@/modules/divergences/domain/dilution-bridge";
import { SHARE_COUNT_BIAS_TOLERANCE_PP } from "@/modules/divergences/domain/divergence-views";
import {
  formatCalendarDate,
  formatCompactAmount,
} from "@/modules/valuation/domain/display-format";

import { MatrixChart, type MatrixLogo } from "../../_components/matrix-chart";

import {
  CATEGORY_LABELS,
  describeDivergencePoint,
  filterDivergenceRows,
  filtersActive,
  formatPct,
  formatPp,
  layoutDivergence,
  MARKET_CAP_FLOOR_LABELS,
  NO_FILTERS,
  rowLabel,
  unavailableReason,
  VIEWS,
  type DivergenceFilters,
  type HorizonKey,
  type MarketCapFloor,
  type ViewKey,
} from "./divergence-layout";

const HORIZONS: Record<HorizonKey, string> = {
  twoYears: "2 años",
  fiveYears: "5 años",
};

const BASIS_LABELS = {
  shares_outstanding_at_close: "Acciones al cierre",
  weighted_diluted_shares: "Diluidas promedio",
} as const;

type SortKey =
  | "ticker"
  | "y"
  | "x"
  | "marketCap"
  | "fundamental"
  | "bias"
  | "perShare"
  | "aggregate"
  | "shares";

const SORT_LABELS: Record<Exclude<SortKey, "x" | "y">, string> = {
  ticker: "Ticker",
  marketCap: "Market cap (US$)",
  fundamental: "Brecha",
  bias: "Sesgo",
  perShare: "Por acción",
  aggregate: "Agregada",
  shares: "Acciones",
};

function sortValue(
  horizon: DivergenceHorizon,
  key: SortKey,
  view: ViewKey,
): string | null {
  const { views } = horizon;
  switch (key) {
    case "y":
      return views[view].y.value;
    case "x":
      return views[view].x.value;
    case "marketCap":
      return views.marketCap.latest;
    case "fundamental":
      return views.fundamental.gapPp;
    case "bias":
      return views.fundamental.shareCountBiasPp;
    case "perShare":
      return views.perShare.gapPp;
    case "aggregate":
      return views.aggregate.gapPp;
    case "shares":
      return views.growth.dilutedShares.value;
    default:
      return null;
  }
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: Record<T, string>;
  readonly value: T;
  readonly onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex w-fit flex-wrap rounded-lg border bg-muted/40 p-0.5"
    >
      {(Object.keys(options) as T[]).map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={key === value}
          onClick={() => onChange(key)}
          className={cn(
            "min-h-8 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            key === value && "bg-card text-foreground shadow-xs",
          )}
        >
          {options[key]}
        </button>
      ))}
    </div>
  );
}

function BiasGlyph({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={cn("inline size-3", className)}
    >
      <path
        d="M6 1 L11 6 L6 11 L1 6 Z"
        className="fill-foreground stroke-background"
        strokeWidth="1"
      />
    </svg>
  );
}

function BridgeCell({ bridge }: { readonly bridge: EndpointBridge | null }) {
  if (bridge === null || bridge.reconciled === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return bridge.reconciled ? (
    <span className="inline-flex items-center gap-1">
      <CircleCheck className="size-3.5 text-muted-foreground" aria-hidden />
      Concilia
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 numeric">
      <CircleX className="size-3.5" aria-hidden />
      {formatPct(bridge.residualPct)}
    </span>
  );
}

function SelectedRow({
  row,
  horizon,
  view,
}: {
  readonly row: SectorDivergenceRow | null;
  readonly horizon: HorizonKey;
  readonly view: ViewKey;
}) {
  if (row === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Elegí un punto con Tab, un click o desde la tabla para ver sus valores
        exactos y de dónde sale la brecha.
      </p>
    );
  }

  const data = row[horizon];
  const values = data.views[view];
  const fundamental = data.views.fundamental;
  const bridge = data.bridge.latest;
  const earlierBridge = data.bridge.earlier;
  const names = VIEWS[view];
  const entries: [string, React.ReactNode][] = [
    [`${names.y}`, `${formatPct(values.y.value)} por año`],
    [`${names.x}`, `${formatPct(values.x.value)} por año`],
    ["Brecha", `${formatPp(values.gapPp)} pp`],
  ];
  if (view === "fundamental") {
    entries.push(
      ["Por acción", `${formatPp(fundamental.perShareGapPp)} pp`],
      [
        "Sesgo por acciones",
        <span key="bias" className="inline-flex items-center gap-1">
          {fundamental.biasMarked ? <BiasGlyph /> : null}
          {formatPp(fundamental.shareCountBiasPp)} pp
        </span>,
      ],
    );
  }
  entries.push(
    [
      "Market cap",
      data.views.marketCap.latest === null
        ? "—"
        : `US$ ${formatCompactAmount(data.views.marketCap.latest)}`,
    ],
    [
      "Base del market cap",
      data.views.marketCapBasis === null
        ? "Sin market cap"
        : BASIS_LABELS[data.views.marketCapBasis],
    ],
    [
      "Acciones diluidas",
      `${formatPct(data.views.growth.dilutedShares.value)} por año`,
    ],
    ["Puente del EPS", <BridgeCell key="bridge" bridge={bridge} />],
    [
      "Puente, punta anterior",
      <BridgeCell key="earlier-bridge" bridge={earlierBridge} />,
    ],
    [
      "Dilutivos sobre básicas",
      bridge?.dilutivePct == null ? "—" : formatPct(bridge.dilutivePct),
    ],
    ["Acceso local", row.cedear ? "Con CEDEAR" : "Sin CEDEAR"],
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-base font-semibold">{rowLabel(row)}</p>
        <p className="text-sm text-muted-foreground">
          {row.issuerName ?? "Emisor sin nombre registrado"}
        </p>
        {data.earlierFiscalYearEnd === null ||
        data.latestFiscalYearEnd === null ? null : (
          <p className="text-xs text-muted-foreground">
            Ejercicios cerrados el{" "}
            <time dateTime={data.earlierFiscalYearEnd}>
              {formatCalendarDate(data.earlierFiscalYearEnd)}
            </time>{" "}
            y el{" "}
            <time dateTime={data.latestFiscalYearEnd}>
              {formatCalendarDate(data.latestFiscalYearEnd)}
            </time>
          </p>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {entries.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="numeric text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {view === "fundamental" && fundamental.gapPp !== null ? (
        <p className="text-sm">
          De la brecha, {formatPp(fundamental.shareCountBiasPp)} pp vienen del
          cambio de acciones y {formatPp(fundamental.perShareGapPp)} pp del EPS
          contra el precio.
        </p>
      ) : null}
      {bridge?.reconciled === false || earlierBridge?.reconciled === false ? (
        <p className="text-sm text-muted-foreground">
          El EPS diluido no cierra contra su numerador y las acciones diluidas
          más allá del redondeo: puede ser EPS de operaciones continuas, dos
          clases o preferidas.
        </p>
      ) : null}
      {row.ticker === null ? null : (
        <Link
          href={`/valuacion/${encodeURIComponent(row.ticker)}`}
          className="w-fit text-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Ver la valuación de {row.ticker}
        </Link>
      )}
    </div>
  );
}

export function DivergenceWorkspace({
  rows,
  logoUrls,
}: {
  readonly rows: readonly SectorDivergenceRow[];
  /** El logo de cada security por su ID (ADR 0062); `null` muestra el monograma. */
  readonly logoUrls: Readonly<Record<string, string | null>>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const [horizon, setHorizon] = useState<HorizonKey>("twoYears");
  const [view, setView] = useState<ViewKey>("fundamental");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<DivergenceFilters>(NO_FILTERS);
  const [sort, setSort] = useState<{
    key: SortKey;
    direction: "ascending" | "descending";
  }>({ key: "fundamental", direction: "descending" });

  // Gráfico, paneles y tabla leen el mismo conjunto: la tabla es el
  // equivalente accesible del gráfico, no una lista aparte.
  const filtered = useMemo(
    () => filterDivergenceRows(rows, horizon, filters),
    [rows, horizon, filters],
  );
  const layout = useMemo(
    () => layoutDivergence(filtered, horizon, view),
    [filtered, horizon, view],
  );
  const clips = useMemo(
    () =>
      new Map(
        layout.points.map((point) => [
          point.id,
          { x: point.clipX, y: point.clipY },
        ]),
      ),
    [layout],
  );
  const descriptions = useMemo(
    () =>
      new Map(
        rows.map((row) => [
          row.securityId,
          describeDivergencePoint(row, horizon, view),
        ]),
      ),
    [rows, horizon, view],
  );
  const logos = useMemo(
    () =>
      new Map<string, MatrixLogo>(
        rows.map((row) => [
          row.securityId,
          {
            url: logoUrls[row.securityId] ?? null,
            name: row.issuerName,
            ticker: row.ticker ?? row.securityId,
          },
        ]),
      ),
    [rows, logoUrls],
  );
  const markedIds = useMemo<ReadonlySet<string>>(
    () =>
      view === "fundamental"
        ? new Set(
            filtered
              .filter((row) => row[horizon].views.fundamental.biasMarked)
              .map((row) => row.securityId),
          )
        : new Set(),
    [filtered, horizon, view],
  );
  const categorized = useMemo(
    () =>
      (Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).map(
        (category) => ({
          category,
          rows: filtered.filter(
            (row) => row[horizon].views[view].category === category,
          ),
        }),
      ),
    [filtered, horizon, view],
  );
  const unavailable = filtered.filter(
    (row) => row[horizon].views[view].category === "unavailable",
  );
  const sorted = useMemo(() => {
    const sign = sort.direction === "ascending" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (sort.key === "ticker")
        return sign * rowLabel(left).localeCompare(rowLabel(right));
      const a = sortValue(left[horizon], sort.key, view);
      const b = sortValue(right[horizon], sort.key, view);
      // Un `null` va siempre al final: no es el menor ni el mayor.
      if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
      return sign * (Number(a) - Number(b));
    });
  }, [filtered, horizon, sort, view]);
  // Un punto que un filtro saca deja de estar seleccionado.
  const selected =
    filtered.find((row) => row.securityId === selectedId) ?? null;
  const active = filtersActive(filters);
  const setFilter = <K extends keyof DivergenceFilters>(
    key: K,
    value: DivergenceFilters[K],
  ) => setFilters((current) => ({ ...current, [key]: value }));
  const names = VIEWS[view];
  const clipped = layout.points.some(
    (point) => point.clipX !== 0 || point.clipY !== 0,
  );

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
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Horizonte"
          options={HORIZONS}
          value={horizon}
          onChange={setHorizon}
        />
        <Segmented
          label="Vista"
          options={{
            fundamental: VIEWS.fundamental.label,
            aggregate: VIEWS.aggregate.label,
            perShare: VIEWS.perShare.label,
          }}
          value={view}
          onChange={setView}
        />
      </div>

      <div
        role="group"
        aria-label="Filtros"
        className="flex flex-wrap items-end gap-x-5 gap-y-3"
      >
        <FilterGroup label="Acceso local">
          <Segmented
            label="Acceso local"
            options={{ all: "Todas", cedear: "Con CEDEAR" }}
            value={filters.cedearOnly ? "cedear" : "all"}
            onChange={(value) => setFilter("cedearOnly", value === "cedear")}
          />
        </FilterGroup>
        <FilterGroup label="Market cap al último cierre fiscal, US$">
          <Segmented<MarketCapFloor>
            label="Market cap al último cierre fiscal, US$"
            options={MARKET_CAP_FLOOR_LABELS}
            value={filters.marketCapFloor}
            onChange={(value) => setFilter("marketCapFloor", value)}
          />
        </FilterGroup>
        <FilterGroup label="Calidad del dato">
          <Segmented
            label="Calidad del dato"
            options={{ all: "Todas", reconciled: "Puente conciliado" }}
            value={filters.reconciledOnly ? "reconciled" : "all"}
            onChange={(value) =>
              setFilter("reconciledOnly", value === "reconciled")
            }
          />
        </FilterGroup>
        <div className="flex min-h-8 items-center gap-3 text-sm text-muted-foreground">
          <p role="status">
            {active
              ? `${filtered.length} de ${rows.length} securities pasan los filtros`
              : `${rows.length} securities del sector`}
          </p>
          {active ? (
            <button
              type="button"
              onClick={() => setFilters(NO_FILTERS)}
              className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Quitar filtros
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle as="h2" id={titleId}>
              {names.y} contra {names.x}, {HORIZONS[horizon]}
            </CardTitle>
            <CardDescription id={descriptionId}>
              {layout.points.length} de {filtered.length} comparables
              {active ? " con estos filtros" : ""}. Arriba de la diagonal,{" "}
              {view === "perShare" ? "el EPS" : "las ganancias"} crecieron más
              que {view === "perShare" ? "el precio" : "el valor de mercado"};
              no indica que esté barata.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {layout.points.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {active && filtered.length === 0
                  ? "Ninguna security pasa estos filtros."
                  : active
                    ? "Ninguna security que pasa estos filtros tiene esta vista comparable en este horizonte."
                    : "Ninguna security tiene esta vista comparable en este horizonte."}
              </p>
            ) : (
              <MatrixChart
                layout={layout}
                descriptions={descriptions}
                logos={logos}
                selectedId={selectedId}
                onSelect={setSelectedId}
                titleId={titleId}
                descriptionId={descriptionId}
                asOfLabel=""
                xLabel={`${names.x} (%/año)`}
                yLabel={`${names.y} (%/año)`}
                diagonal={layout.diagonal}
                markedIds={markedIds}
                className="mx-auto aspect-square max-h-[44rem] w-full"
              />
            )}
            <ul
              aria-label="Cómo leer el gráfico"
              className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"
            >
              <li>
                Anillo grueso con insignia: con CEDEAR; borde fino: sin CEDEAR
              </li>
              <li className="flex items-center gap-1.5">
                <svg aria-hidden="true" viewBox="0 0 16 12" className="h-3 w-4">
                  <line
                    x1="0"
                    y1="11"
                    x2="16"
                    y2="1"
                    className="stroke-foreground/60"
                    strokeWidth="1.25"
                    strokeDasharray="4 3"
                  />
                </svg>
                Diagonal: crecieron igual
              </li>
              {view === "fundamental" ? (
                <li className="flex items-center gap-1.5">
                  <BiasGlyph />
                  Recompras o dilución de más de {
                    SHARE_COUNT_BIAS_TOLERANCE_PP
                  }{" "}
                  pp por año
                </li>
              ) : null}
              {clipped ? (
                <li className="flex items-center gap-1.5">
                  <ChevronsRight className="size-3.5" aria-hidden="true" />
                  Un punto con flecha está fuera de escala: su valor exacto está
                  en la tabla, con la misma marca.
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
            <SelectedRow row={selected} horizon={horizon} view={view} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle as="h2">Sin tasa comparable</CardTitle>
            <CardDescription>
              Un beneficio no positivo en alguna punta no tiene tasa de
              crecimiento: se nombra, no se dibuja.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {categorized.map(({ category, rows: members }) => (
                <li
                  key={category}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2"
                >
                  <span className="font-medium">
                    {CATEGORY_LABELS[category]}
                  </span>
                  <span className="text-muted-foreground">
                    {members.length === 0
                      ? "—"
                      : members.map((row) => rowLabel(row)).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle as="h2">Sin valor</CardTitle>
            <CardDescription>
              Falta un dato para esta vista: un valor faltante no es un cero.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {unavailable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todas tienen los datos de esta vista.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {unavailable.map((row) => (
                  <li
                    key={row.securityId}
                    className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2"
                  >
                    <span className="font-medium">{rowLabel(row)}</span>
                    <span className="text-muted-foreground">
                      {unavailableReason(
                        row[horizon],
                        row[horizon].views[view],
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Tabla de la matriz</CardTitle>
          <CardDescription>
            Los dos ejes de la vista, el market cap, las tres brechas y el
            puente de acciones a {HORIZONS[horizon]}, sin recorte de escala.
            Tasas en % por año y brechas en puntos porcentuales; brecha = por
            acción + sesgo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <caption className="sr-only">
              {names.y} y {names.x}, market cap, brechas de divergencia, sesgo
              por acciones y puente del EPS por security a {HORIZONS[horizon]}
            </caption>
            <TableHeader>
              <TableRow>
                {(
                  [
                    "ticker",
                    "y",
                    "x",
                    "marketCap",
                    "fundamental",
                    "bias",
                    "perShare",
                    "aggregate",
                    "shares",
                  ] as const
                ).map((key) => {
                  const sorted = sort.key === key;
                  const Icon = !sorted
                    ? ArrowUpDown
                    : sort.direction === "ascending"
                      ? ArrowUp
                      : ArrowDown;
                  return (
                    <TableHead
                      key={key}
                      aria-sort={sorted ? sort.direction : "none"}
                      className={
                        key === "ticker"
                          ? undefined
                          : "h-auto py-2 text-right align-bottom whitespace-normal"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className="inline-flex items-center gap-1 rounded-sm text-right leading-tight font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {key === "y"
                          ? names.y
                          : key === "x"
                            ? names.x
                            : SORT_LABELS[key]}
                        <Icon className="size-3.5" aria-hidden="true" />
                      </button>
                    </TableHead>
                  );
                })}
                <TableHead>Puente EPS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => {
                const data = row[horizon];
                const isSelected = row.securityId === selectedId;
                const fundamental = data.views.fundamental;
                return (
                  <TableRow
                    key={row.securityId}
                    data-state={isSelected ? "selected" : undefined}
                  >
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <CompanyMark
                          ticker={row.ticker ?? row.securityId}
                          name={row.issuerName}
                          logoUrl={logoUrls[row.securityId] ?? null}
                          size="sm"
                        />
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelectedId(row.securityId)}
                          className={cn(
                            "rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                            isSelected && "text-primary",
                          )}
                        >
                          {rowLabel(row)}
                        </button>
                      </span>
                    </TableCell>
                    <RateCell
                      value={data.views[view].y.value}
                      clip={clips.get(row.securityId)?.y ?? 0}
                    />
                    <RateCell
                      value={data.views[view].x.value}
                      clip={clips.get(row.securityId)?.x ?? 0}
                    />
                    <TableCell className="text-right whitespace-nowrap">
                      {data.views.marketCap.latest === null ||
                      data.views.marketCapBasis === null ? (
                        "—"
                      ) : (
                        <>
                          <span className="numeric block">
                            {formatCompactAmount(data.views.marketCap.latest, {
                              scale: 0,
                            })}
                          </span>
                          {/* La base va con el número: es de qué acciones sale. */}
                          <span className="block text-xs text-muted-foreground">
                            {BASIS_LABELS[data.views.marketCapBasis]}
                          </span>
                        </>
                      )}
                    </TableCell>
                    <GapCell
                      value={fundamental.gapPp}
                      horizon={data}
                      view="fundamental"
                    />
                    <TableCell className="text-right">
                      <span className="numeric inline-flex items-center gap-1">
                        {fundamental.biasMarked ? <BiasGlyph /> : null}
                        {formatPp(fundamental.shareCountBiasPp)}
                      </span>
                    </TableCell>
                    <GapCell
                      value={data.views.perShare.gapPp}
                      horizon={data}
                      view="perShare"
                    />
                    <GapCell
                      value={data.views.aggregate.gapPp}
                      horizon={data}
                      view="aggregate"
                    />
                    <TableCell className="numeric text-right">
                      {formatPct(data.views.growth.dilutedShares.value)}
                    </TableCell>
                    <TableCell>
                      <BridgeCell bridge={data.bridge.latest} />
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

function GapCell({
  value,
  horizon,
  view,
}: {
  readonly value: string | null;
  readonly horizon: DivergenceHorizon;
  readonly view: ViewKey;
}) {
  if (value !== null) {
    return (
      <TableCell className="numeric text-right" title={value}>
        {formatPp(value)}
      </TableCell>
    );
  }
  const category = horizon.views[view].category;
  return (
    <TableCell className="text-right whitespace-normal text-muted-foreground">
      <span className="inline-flex items-center justify-end gap-1 leading-tight">
        <CircleSlash className="size-3.5" aria-hidden="true" />
        {category === "comparable" || category === "unavailable"
          ? "Sin valor"
          : CATEGORY_LABELS[category]}
      </span>
    </TableCell>
  );
}

function FilterGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Una tasa de un eje con su valor exacto. Si el gráfico la recortó, lleva la
 * misma flecha que el punto y lo dice en palabras.
 */
function RateCell({
  value,
  clip,
}: {
  readonly value: string | null;
  readonly clip: -1 | 0 | 1;
}) {
  return (
    <TableCell
      className="numeric text-right whitespace-nowrap"
      title={value ?? undefined}
    >
      <span className="inline-flex items-center gap-1">
        {clip === 0 ? null : (
          <>
            <ChevronsRight
              aria-hidden="true"
              className={cn("size-3.5", clip < 0 && "rotate-180")}
            />
            <span className="sr-only">
              {clip > 0
                ? "Fuera de escala, por encima: "
                : "Fuera de escala, por debajo: "}
            </span>
          </>
        )}
        {formatPct(value)}
      </span>
    </TableCell>
  );
}
