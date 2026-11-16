"use client";

import { useId, useState, type KeyboardEvent } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
  type MouseHandlerDataParam,
} from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

export type ScenarioPathYear = {
  /** 1, 2, …: el año de la proyección. */
  readonly year: number;
  /** Sólo geometría: el porcentaje como número (15 es 15 %). */
  readonly base: number;
  readonly bear: number;
  readonly bull: number;
  /** Las cifras que se leen, ya formateadas como en la tabla. */
  readonly baseLabel: string;
  readonly bearLabel: string;
  readonly bullLabel: string;
};

const SERIES = [
  {
    key: "bear",
    label: "Bear",
    color: "var(--chart-5)",
    dash: "6 4",
    width: 2,
  },
  {
    key: "base",
    label: "Base",
    color: "var(--chart-1)",
    dash: undefined,
    width: 2.5,
  },
  {
    key: "bull",
    label: "Bull",
    color: "var(--chart-2)",
    dash: "1.5 3.5",
    width: 2.25,
  },
] as const;

const chartConfig = {
  bear: { label: "Bear", color: "var(--chart-5)" },
  base: { label: "Base", color: "var(--chart-1)" },
  bull: { label: "Bull", color: "var(--chart-2)" },
} satisfies ChartConfig;

const tickFormat = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

/** La muestra del trazo de cada serie, igual que en el dibujo. */
function Swatch({ series }: { series: (typeof SERIES)[number] }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 6" className="h-1.5 w-5 shrink-0">
      <line
        x1="0"
        y1="3"
        x2="20"
        y2="3"
        stroke={series.color}
        strokeWidth={series.width}
        strokeDasharray={series.dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * El camino de un driver año por año en los tres escenarios (decisión del
 * owner del 2026-11-16: dibujarlo en vez de escribir diez cifras por fila).
 * Bear, base y bull se distinguen por el trazo —guiones, sólido, puntos— y
 * no sólo por el color; la franja de arriba dice las tres cifras del año que
 * se señala con mouse, toque o flechas, y la tabla plegada las tiene todas.
 */
export function ScenarioPathChart({
  years,
  label,
}: {
  years: readonly ScenarioPathYear[];
  /** Nombre accesible del gráfico: «Revenue growth por año, bear, base y bull». */
  label: string;
}) {
  const instructionsId = useId();
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const shown = active === null ? undefined : years[active];

  function describe(year: ScenarioPathYear) {
    return `Año ${year.year}: bear ${year.bearLabel}, base ${year.baseLabel}, bull ${year.bullLabel}.`;
  }

  function track(state: MouseHandlerDataParam) {
    // Sin punto activo Recharts pasa `null`, y `Number(null)` es 0.
    if (state.activeTooltipIndex == null) return;
    const index = Number(state.activeTooltipIndex);
    if (Number.isInteger(index) && years[index] !== undefined) setActive(index);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? -1;
    if (event.key === "Escape") {
      setActive(null);
      event.preventDefault();
      return;
    }
    const next =
      event.key === "ArrowRight"
        ? Math.min(years.length - 1, current + 1)
        : event.key === "ArrowLeft"
          ? Math.max(0, current - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? years.length - 1
              : null;
    if (next === null || years[next] === undefined) return;
    setActive(next);
    setAnnouncement(describe(years[next]));
    event.preventDefault();
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p
        aria-hidden="true"
        className="flex min-h-5 flex-wrap gap-x-3 text-xs text-muted-foreground"
      >
        {shown === undefined ? (
          "Pasá el mouse, tocá o usá las flechas para leer un año."
        ) : (
          <>
            <span className="font-medium text-foreground">
              Año {shown.year}
            </span>
            {SERIES.map((series) => (
              <span key={series.key} className="inline-flex items-center gap-1">
                <Swatch series={series} />
                {series.label}
                <span className="numeric font-medium text-foreground">
                  {shown[`${series.key}Label`]}
                </span>
              </span>
            ))}
          </>
        )}
      </p>
      <div
        role="group"
        tabIndex={0}
        aria-label={label}
        aria-describedby={instructionsId}
        onKeyDown={onKeyDown}
        className="touch-pan-y rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span id={instructionsId} className="sr-only">
          Flechas izquierda y derecha para leer cada año.
        </span>
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-44 w-full"
          initialDimension={{ width: 480, height: 176 }}
        >
          <LineChart
            accessibilityLayer={false}
            data={years.map((year) => ({ ...year }))}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onMouseMove={track}
            onTouchMove={track}
            onTouchStart={track}
            onClick={track}
            onMouseLeave={() => setActive(null)}
          >
            <CartesianGrid vertical={false} strokeDasharray="2 4" />
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              interval="preserveStartEnd"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(value: number) => `${tickFormat.format(value)} %`}
            />
            <ReferenceLine y={0} stroke="var(--border)" />
            {shown === undefined ? null : (
              <ReferenceLine
                x={shown.year}
                stroke="var(--foreground)"
                strokeOpacity={0.25}
              />
            )}
            {SERIES.map((series) => (
              <Line
                key={series.key}
                dataKey={series.key}
                type="linear"
                stroke={`var(--color-${series.key})`}
                strokeWidth={series.width}
                strokeDasharray={series.dash}
                strokeLinecap="round"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </div>
      <p
        aria-hidden="true"
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      >
        {SERIES.map((series) => (
          <span key={series.key} className="inline-flex items-center gap-1.5">
            <Swatch series={series} />
            {series.label}
          </span>
        ))}
      </p>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
