"use client";

import { useId, useState, type KeyboardEvent } from "react";
import {
  Bar,
  BarChart,
  ReferenceLine,
  XAxis,
  YAxis,
  type MouseHandlerDataParam,
} from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

export type ProjectionYear = {
  /** «Año 1», como lo nombra el texto de los pasos. */
  readonly year: string;
  /** Sólo geometría, ya dividida por la magnitud. */
  readonly fcff: number;
  readonly presentValue: number;
  /** Las cifras que se leen, en la misma magnitud que la tabla. */
  readonly fcffLabel: string;
  readonly presentValueLabel: string;
};

const chartConfig = {
  fcff: { label: "Flujo de caja libre", color: "var(--chart-1)" },
  presentValue: { label: "Valor hoy", color: "var(--chart-2)" },
} satisfies ChartConfig;

const tickFormat = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

/**
 * La proyección año por año (`F6-17`): el flujo de caja libre de cada año al
 * lado de lo que vale hoy. La distancia entre las dos barras es el descuento,
 * que crece con los años. Barras desde cero: un año con flujo negativo cae
 * debajo de la línea.
 *
 * Desde `F9-13` las dos cifras de un año se leen arriba del gráfico con
 * mouse, toque o flechas; la tabla que lo acompaña sigue teniendo todas.
 */
export function ProjectionChart({
  years,
  label,
  unit,
}: {
  years: readonly ProjectionYear[];
  label: string;
  /** La magnitud y la moneda de las cifras: «millones de USD». */
  unit: string;
}) {
  const instructionsId = useId();
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const shown = active === null ? undefined : years[active];

  function describe(year: ProjectionYear) {
    return `${year.year}: FCFF ${year.fcffLabel}, PV ${year.presentValueLabel}, ${unit}.`;
  }

  function track(state: MouseHandlerDataParam) {
    const index = Number(state.activeTooltipIndex);
    if (Number.isInteger(index) && years[index] !== undefined) setActive(index);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? -1;
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
    if (event.key === "Escape") {
      setActive(null);
      event.preventDefault();
      return;
    }
    if (next === null || years[next] === undefined) return;
    setActive(next);
    setAnnouncement(describe(years[next]));
    event.preventDefault();
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="min-h-5 text-xs text-muted-foreground" aria-hidden="true">
        {shown === undefined ? (
          "Pasá el mouse, tocá una barra o usá las flechas para leer un año."
        ) : (
          <>
            <span className="font-medium text-foreground">{shown.year}</span>
            {" · "}FCFF{" "}
            <span className="numeric font-medium text-foreground">
              {shown.fcffLabel}
            </span>
            {" · "}PV{" "}
            <span className="numeric font-medium text-foreground">
              {shown.presentValueLabel}
            </span>
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
          className="aspect-auto h-52 w-full"
          initialDimension={{ width: 480, height: 208 }}
        >
          <BarChart
            accessibilityLayer={false}
            data={years.map((year) => ({ ...year }))}
            margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
            barGap={2}
            barCategoryGap="22%"
            onMouseMove={track}
            onTouchMove={track}
            onTouchStart={track}
            onClick={track}
            onMouseLeave={() => setActive(null)}
          >
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              interval="preserveStartEnd"
              tickFormatter={(value: string) => value.replace("Año ", "")}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(value: number) => tickFormat.format(value)}
            />
            <ReferenceLine y={0} stroke="var(--border)" />
            {shown === undefined ? null : (
              <ReferenceLine
                x={shown.year}
                stroke="var(--foreground)"
                strokeOpacity={0.08}
                strokeWidth={28}
              />
            )}
            <Bar
              dataKey="fcff"
              fill="var(--color-fcff)"
              fillOpacity={0.45}
              radius={2}
              isAnimationActive={false}
            />
            <Bar
              dataKey="presentValue"
              fill="var(--color-presentValue)"
              radius={2}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
