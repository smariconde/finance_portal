"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
  useXAxisScale,
  useYAxisScale,
  type MouseHandlerDataParam,
} from "recharts";

import { InfoTip } from "@/app/_components/info-tip";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PRESIDENTIAL_TERMS } from "@/modules/argentina-dashboard/domain/argentina-timeline";
import type {
  ComparisonBasis,
  GovernmentPath,
} from "@/modules/argentina-dashboard/domain/government-comparison";

import { Fold } from "./block";
import {
  axisLabel,
  ChartToolbar,
  formatValue,
  logTicks,
  Segmented,
  type AxisFormat,
  type ValueFormat,
} from "./chart-kit";
import { calendarDate, shortMonth } from "./format";

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--foreground)",
] as const;

/** Más de seis líneas a la vez no se distinguen ni con sus rótulos. */
const MAX_SELECTED = 6;
const DEFAULT_SELECTED = 5;
const MILESTONES = [12, 24, 36, 48] as const;

const UNAVAILABLE: Record<
  Extract<GovernmentPath, { status: "unavailable" }>["reason"],
  string
> = {
  interim: "Interinato: queda fuera de la comparación",
  no_base: "La serie empieza después de que asumió",
  non_positive_base: "Base en cero o negativa",
  no_points: "Sin datos en su mandato",
};

export type GovernmentOption = {
  readonly id: string;
  readonly label: string;
  readonly paths: readonly GovernmentPath[];
  /** Cómo se escribe la base, en la unidad de la serie. */
  readonly baseFormat: ValueFormat;
  /** Si la base es un día (serie diaria) o un mes. */
  readonly baseIsDay: boolean;
};

type Computed = Extract<GovernmentPath, { status: "computed" }>;

function termOf(termId: string) {
  return PRESIDENTIAL_TERMS.find((term) => term.id === termId);
}

function monthLabel(month: number): string {
  if (month === 0) return "Asume";
  if (month % 12 === 0) {
    const years = month / 12;
    return `${years} ${years === 1 ? "año" : "años"}`;
  }
  return `${month} m`;
}

/** `0` es la base; `14` es «Mes 14 de mandato (1 año y 2 meses)». */
function monthReading(month: number): string {
  if (month === 0) return "Al asumir (base)";
  const years = Math.floor(month / 12);
  const rest = month % 12;
  const span = [
    years > 0 ? `${years} ${years === 1 ? "año" : "años"}` : null,
    rest > 0 ? `${rest} ${rest === 1 ? "mes" : "meses"}` : null,
  ]
    .filter(Boolean)
    .join(" y ");
  return `Mes ${month} de mandato (${span})`;
}

/**
 * El nombre de cada gobierno al final de su línea, para que la línea no
 * dependa del color. Los rótulos que chocan se separan hacia arriba o abajo.
 */
function EndLabels({
  lines,
}: {
  readonly lines: readonly {
    readonly id: string;
    readonly label: string;
    readonly color: string;
    readonly month: number;
    readonly value: number;
  }[];
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (xScale === undefined || yScale === undefined) return null;
  const placed = lines
    .map((line) => ({
      ...line,
      x: Number(xScale(line.month)),
      y: Number(yScale(line.value)),
    }))
    .filter((line) => Number.isFinite(line.x) && Number.isFinite(line.y))
    .sort((a, b) => a.y - b.y);
  for (let index = 1; index < placed.length; index += 1) {
    const previous = placed[index - 1]!;
    const current = placed[index]!;
    if (Math.abs(current.x - previous.x) < 70 && current.y - previous.y < 12) {
      current.y = previous.y + 12;
    }
  }
  return (
    <g aria-hidden="true" className="pointer-events-none">
      {placed.map((line) => (
        <g key={line.id}>
          <circle
            cx={line.x}
            cy={Number(yScale(line.value))}
            r={3}
            fill={line.color}
          />
          <text
            x={line.x + 6}
            y={line.y + 3.5}
            className="text-[10px] font-medium"
            fill={line.color}
          >
            {line.label}
          </text>
        </g>
      ))}
    </g>
  );
}

/**
 * Cada presidencia desde el día que asumió (`F9-13`,
 * `government-comparison-1.0.0`): el eje horizontal son los meses de
 * mandato, así dos gobiernos se comparan en el mismo mes de su gestión. Se
 * eligen hasta seis; cada línea lleva su nombre al final. Describe el
 * recorrido; no lo atribuye.
 */
export function GovernmentChart({
  label,
  caption,
  options,
  basis,
  format,
  axis,
  basisNote,
  allowLog = false,
}: {
  readonly label: string;
  readonly caption: string;
  readonly options: readonly GovernmentOption[];
  readonly basis: ComparisonBasis;
  /** Cómo se escribe un punto comparado. */
  readonly format: ValueFormat;
  readonly axis: AxisFormat;
  /** Qué es 100 o 0, en una frase. */
  readonly basisNote: string;
  readonly allowLog?: boolean;
}) {
  const instructionsId = useId();
  const [optionId, setOptionId] = useState(options[0]?.id ?? "");
  const option = options.find((item) => item.id === optionId) ?? options[0];
  const computed = useMemo(
    () =>
      (option?.paths ?? []).filter(
        (path): path is Computed => path.status === "computed",
      ),
    [option],
  );
  const colorOf = useMemo(
    () =>
      new Map(
        computed.map((path, index) => [
          path.termId,
          PALETTE[(computed.length - 1 - index) % PALETTE.length]!,
        ]),
      ),
    [computed],
  );
  const [selected, setSelected] = useState<readonly string[]>(() =>
    computed.slice(-DEFAULT_SELECTED).map((path) => path.termId),
  );
  const [logScale, setLogScale] = useState(false);
  const [activeMonth, setActiveMonth] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const shownPaths = computed.filter((path) => selected.includes(path.termId));
  const maxMonth = Math.max(
    1,
    ...shownPaths.map((path) => path.points.at(-1)?.month ?? 0),
  );
  const rows = useMemo(
    () =>
      Array.from({ length: maxMonth + 1 }, (_, month) => {
        const row: Record<string, number | null> = { month };
        for (const path of shownPaths) {
          const point = path.points.find((p) => p.month === month);
          const value = point?.value == null ? null : Number(point.value);
          row[path.termId] =
            value !== null && Number.isFinite(value) ? value : null;
        }
        return row;
      }),
    [shownPaths, maxMonth],
  );
  const values = rows.flatMap((row) =>
    shownPaths
      .map((path) => row[path.termId])
      .filter((value): value is number => typeof value === "number"),
  );
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const levelBasis = basis === "index" || basis === "cumulative_rate";
  const logAvailable = allowLog && levelBasis && min > 0;
  const useLog = logScale && logAvailable;
  const reference = levelBasis ? 100 : 0;

  const config = Object.fromEntries(
    shownPaths.map((path) => [
      path.termId,
      {
        label: termOf(path.termId)?.label ?? path.termId,
        color: colorOf.get(path.termId)!,
      },
    ]),
  ) satisfies ChartConfig;

  function valueAt(path: Computed, month: number) {
    return path.points.find((point) => point.month === month) ?? null;
  }

  function describe(month: number): string {
    return `${monthReading(month)}: ${shownPaths
      .map((path) => {
        const point = valueAt(path, month);
        return `${termOf(path.termId)?.label} ${point ? formatValue(point.value, format) : "sin dato"}`;
      })
      .join(", ")}.`;
  }

  function moveTo(month: number) {
    setActiveMonth(month);
    setAnnouncement(describe(month));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = activeMonth ?? maxMonth;
    const step = event.shiftKey ? 12 : 1;
    switch (event.key) {
      case "ArrowLeft":
        moveTo(Math.max(0, current - step));
        break;
      case "ArrowRight":
        moveTo(Math.min(maxMonth, current + step));
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(maxMonth);
        break;
      case "Escape":
        setActiveMonth(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function track(state: MouseHandlerDataParam) {
    const index = Number(state.activeTooltipIndex);
    if (Number.isInteger(index) && index >= 0 && index <= maxMonth) {
      setActiveMonth(index);
    }
  }

  function toggle(termId: string) {
    setSelected((current) =>
      current.includes(termId)
        ? current.filter((id) => id !== termId)
        : current.length >= MAX_SELECTED
          ? current
          : [...current, termId],
    );
  }

  const ticks = Array.from(
    { length: Math.floor(maxMonth / 12) + 1 },
    (_, index) => index * 12,
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ChartToolbar>
        {options.length > 1 ? (
          <Segmented
            label="Serie"
            options={options.map((item) => ({
              value: item.id,
              label: item.label,
            }))}
            value={option?.id ?? ""}
            onChange={(value) => {
              setOptionId(value);
              setActiveMonth(null);
            }}
          />
        ) : null}
        {allowLog && levelBasis ? (
          <Segmented
            label="Escala"
            options={[
              { value: "linear", label: "Lineal" },
              { value: "log", label: "Log", disabled: !logAvailable },
            ]}
            value={useLog ? "log" : "linear"}
            onChange={(value) => setLogScale(value === "log")}
          />
        ) : null}
        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
          {basisNote}
          <InfoTip title="Cómo se compara cada gobierno">
            <p>
              Cada línea empieza el día que asumió el presidente: el mes 0 es el
              último dato anterior a la asunción y el mes 1, el de la asunción,
              que cuenta para quien asume. El último mes de un mandato es el
              anterior al de la asunción siguiente.
            </p>
            <p>
              Un mes sin dato corta la línea; en un acumulado la termina. Los
              tres interinatos de diciembre de 2001 quedan afuera. La
              comparación describe recorridos, no atribuye a un gobierno lo que
              hizo la serie (
              <code className="text-xs">government-comparison-1.0.0</code>).
            </p>
          </InfoTip>
        </span>
      </ChartToolbar>

      <div
        role="group"
        aria-label="Gobiernos a comparar"
        className="flex flex-wrap gap-1.5"
      >
        {computed.map((path) => {
          const term = termOf(path.termId);
          const on = selected.includes(path.termId);
          const full = !on && selected.length >= MAX_SELECTED;
          return (
            <button
              key={path.termId}
              type="button"
              aria-pressed={on}
              disabled={full}
              title={full ? `Hasta ${MAX_SELECTED} a la vez` : term?.president}
              onClick={() => toggle(path.termId)}
              className={cn(
                "inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
                on && "bg-card font-medium text-foreground shadow-sm",
              )}
            >
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full border"
                style={
                  on
                    ? {
                        background: colorOf.get(path.termId),
                        borderColor: colorOf.get(path.termId),
                      }
                    : undefined
                }
              />
              {term?.label}
            </button>
          );
        })}
      </div>

      <div
        className="min-h-14 rounded-md border bg-muted/30 px-3 py-2 text-xs"
        aria-hidden="true"
      >
        <p className="mb-1 font-medium text-foreground">
          {activeMonth === null
            ? "Último mes de cada uno"
            : monthReading(activeMonth)}
        </p>
        {shownPaths.length === 0 ? (
          <p className="text-muted-foreground">Elegí al menos un gobierno.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
            {shownPaths.map((path) => {
              const point =
                activeMonth === null
                  ? path.points.at(-1)!
                  : valueAt(path, activeMonth);
              return (
                <li key={path.termId} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ background: colorOf.get(path.termId) }}
                  />
                  <span className="text-muted-foreground">
                    {termOf(path.termId)?.label}
                  </span>
                  <span className="numeric font-medium text-foreground">
                    {point ? formatValue(point.value, format) : "—"}
                  </span>
                  {point ? (
                    <span className="text-muted-foreground">
                      ({shortMonth(point.on)})
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div
        role="group"
        tabIndex={0}
        aria-label={label}
        aria-describedby={instructionsId}
        onKeyDown={onKeyDown}
        className="touch-pan-y rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span id={instructionsId} className="sr-only">
          Flechas izquierda y derecha para recorrer los meses de mandato,
          Mayúscula más flecha para saltar un año.
        </span>
        <ChartContainer
          config={config}
          className="aspect-auto h-72 w-full"
          initialDimension={{ width: 640, height: 288 }}
        >
          <LineChart
            accessibilityLayer={false}
            data={rows}
            margin={{ top: 8, right: 92, bottom: 0, left: 0 }}
            onMouseMove={track}
            onTouchMove={track}
            onTouchStart={track}
            onClick={track}
            onMouseLeave={() => setActiveMonth(null)}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              type="number"
              domain={[0, maxMonth]}
              ticks={ticks}
              tickFormatter={monthLabel}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              scale={useLog ? "log" : "linear"}
              domain={useLog ? [min * 0.92, max * 1.08] : ["auto", "auto"]}
              allowDataOverflow={useLog}
              ticks={useLog ? logTicks(min, max) : undefined}
              tickFormatter={(value: number) => axisLabel(axis, value)}
            />
            <ReferenceLine y={reference} stroke="var(--muted-foreground)" />
            {activeMonth === null ? null : (
              <ReferenceLine
                x={activeMonth}
                stroke="var(--foreground)"
                strokeOpacity={0.35}
              />
            )}
            {shownPaths.map((path) => (
              <Line
                key={path.termId}
                dataKey={path.termId}
                type="linear"
                stroke={colorOf.get(path.termId)}
                strokeWidth={path.running ? 2.5 : 1.75}
                dot={false}
                activeDot={{ r: 3.5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            <EndLabels
              lines={shownPaths.flatMap((path) => {
                const last = [...path.points]
                  .reverse()
                  .find((point) => point.value !== null);
                const value = last ? Number(last.value) : Number.NaN;
                return last && Number.isFinite(value)
                  ? [
                      {
                        id: path.termId,
                        label: termOf(path.termId)?.label ?? path.termId,
                        color: colorOf.get(path.termId)!,
                        month: last.month,
                        value,
                      },
                    ]
                  : [];
              })}
            />
          </LineChart>
        </ChartContainer>
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      <Fold
        summary={`Ver la comparación (${option?.paths.length ?? 0} gobiernos)`}
      >
        <div className="max-h-96 overflow-auto rounded-md border">
          <Table>
            <TableCaption className="sr-only">{caption}</TableCaption>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead scope="col">Gobierno</TableHead>
                <TableHead scope="col" className="text-right">
                  Base
                </TableHead>
                {MILESTONES.map((month) => (
                  <TableHead key={month} scope="col" className="text-right">
                    {monthLabel(month)}
                  </TableHead>
                ))}
                <TableHead scope="col" className="text-right">
                  Último mes
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...(option?.paths ?? [])].reverse().map((path) => {
                const term = termOf(path.termId);
                if (path.status === "unavailable") {
                  return (
                    <TableRow key={path.termId}>
                      <TableHead scope="row" className="font-normal">
                        {term?.president}
                      </TableHead>
                      <TableCell
                        colSpan={MILESTONES.length + 2}
                        className="text-muted-foreground"
                      >
                        {UNAVAILABLE[path.reason]}
                      </TableCell>
                    </TableRow>
                  );
                }
                const last = path.points.at(-1)!;
                return (
                  <TableRow key={path.termId}>
                    <TableHead scope="row" className="font-normal">
                      {term?.president}
                      {path.running ? " (en curso)" : ""}
                    </TableHead>
                    <TableCell className="numeric text-right">
                      {formatValue(path.baseValue, option!.baseFormat)}{" "}
                      <span className="text-muted-foreground">
                        (
                        {option!.baseIsDay
                          ? calendarDate(path.baseOn)
                          : shortMonth(path.baseOn)}
                        )
                      </span>
                    </TableCell>
                    {MILESTONES.map((month) => {
                      const point = valueAt(path, month);
                      return (
                        <TableCell key={month} className="numeric text-right">
                          {point ? formatValue(point.value, format) : "—"}
                        </TableCell>
                      );
                    })}
                    <TableCell className="numeric text-right">
                      {formatValue(last.value, format)}{" "}
                      <span className="text-muted-foreground">
                        ({monthLabel(last.month)}, {shortMonth(last.on)})
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Fold>
    </div>
  );
}
