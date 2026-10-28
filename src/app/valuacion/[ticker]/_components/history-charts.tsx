"use client";

import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

export type HistoryBar = {
  /** Año del cierre del ejercicio, como se lee en el eje. */
  readonly year: string;
  /** Sólo para la geometría; la cifra que se lee es `label`. */
  readonly value: number | null;
  readonly label: string;
};

export type HistoryMetric = {
  readonly id: string;
  readonly title: string;
  readonly unit: string;
  /** La lectura en una frase: es también el nombre accesible del gráfico. */
  readonly reading: string;
  readonly bars: readonly HistoryBar[];
  /** La cifra del último ejercicio con dato y su año, o `null` si no hay. */
  readonly latest: { readonly year: string; readonly label: string } | null;
};

const chartConfig = {
  value: { label: "Valor", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * Un gráfico chico por métrica (`F6-17`). Las barras van desde cero, así que
 * un año negativo cae debajo de la línea: el signo lo dice la posición y la
 * cifra escrita, no el color. Un año sin dato no tiene barra y lo dice.
 *
 * No hay tooltip: cada cifra está escrita sobre su barra y la tabla de abajo
 * tiene los mismos números con sus motivos.
 */
export function HistoryCharts({
  metrics,
}: {
  metrics: readonly HistoryMetric[];
}) {
  return (
    <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
      {metrics.map((metric) => {
        const hasNegative = metric.bars.some(
          (bar) => bar.value !== null && bar.value < 0,
        );

        return (
          <figure key={metric.id} className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{metric.title}</span>
                <span className="text-xs text-muted-foreground">
                  {metric.unit}
                </span>
              </span>
              {metric.latest === null ? null : (
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="numeric text-lg leading-none font-semibold">
                    {metric.latest.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {metric.latest.year}
                  </span>
                </span>
              )}
            </figcaption>
            <div role="img" aria-label={`${metric.title}: ${metric.reading}`}>
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-36 w-full"
                initialDimension={{ width: 320, height: 144 }}
              >
                <BarChart
                  accessibilityLayer={false}
                  data={metric.bars.map((bar) => ({ ...bar }))}
                  margin={{
                    top: 24,
                    right: 4,
                    bottom: hasNegative ? 20 : 0,
                    left: 4,
                  }}
                >
                  <XAxis
                    dataKey="year"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={6}
                    interval={0}
                  />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Bar
                    dataKey="value"
                    fill="var(--color-value)"
                    radius={3}
                    isAnimationActive={false}
                  >
                    {metric.bars.map((bar) => (
                      <Cell
                        key={bar.year}
                        fillOpacity={
                          bar.year === metric.bars.at(-1)?.year ? 1 : 0.55
                        }
                      />
                    ))}
                    <LabelList
                      dataKey="label"
                      position="top"
                      className="fill-foreground text-xs tabular-nums"
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </div>
            <p className="text-sm text-muted-foreground">{metric.reading}</p>
          </figure>
        );
      })}
    </div>
  );
}
