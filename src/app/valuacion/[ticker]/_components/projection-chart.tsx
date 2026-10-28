"use client";

import { Bar, BarChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

export type ProjectionYear = {
  /** «Año 1», como lo nombra el texto de los pasos. */
  readonly year: string;
  /** Sólo geometría, ya dividida por la magnitud; las cifras van en la tabla. */
  readonly fcff: number;
  readonly presentValue: number;
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
 * No hay tooltip: la tabla que acompaña al gráfico tiene las mismas cifras.
 */
export function ProjectionChart({
  years,
  label,
}: {
  years: readonly ProjectionYear[];
  label: string;
}) {
  return (
    <div role="img" aria-label={label}>
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
  );
}
