"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

/**
 * Formatos de eje por nombre: un Server Component no puede pasarle funciones a
 * uno cliente, y así cada gráfico declara qué está midiendo.
 */
export type AxisFormat =
  "index" | "decimal" | "points" | "pesos" | "millions" | "fraction";

export type ChartRow = { readonly on: string } & Readonly<
  Record<string, number | string | null>
>;

export type ChartLine = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly dashed?: boolean;
};

export type ChartBar = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
};

const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

const group = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function axisLabel(format: AxisFormat, value: number): string {
  switch (format) {
    case "points":
      return `${oneDecimal.format(value)} %`;
    case "decimal":
      return oneDecimal.format(value);
    case "fraction":
      return `${oneDecimal.format(value * 100)} %`;
    case "millions":
      return Math.abs(value) >= 1000
        ? `${oneDecimal.format(value / 1000)} mil`
        : group.format(value);
    case "pesos":
    case "index":
      return group.format(value);
  }
}

function tickLabel(on: unknown): string {
  if (typeof on !== "string") return "";
  return `${MONTHS[Number(on.slice(5, 7)) - 1]} ${on.slice(2, 4)}`;
}

function legendOf(
  items: readonly {
    key: string;
    label: string;
    color: string;
    dashed?: boolean;
    shape?: "line" | "square";
  }[],
) {
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-hidden="true"
    >
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <svg width="18" height="10" viewBox="0 0 18 10" className="shrink-0">
            {item.shape === "square" ? (
              <rect
                x="4"
                y="0"
                width="10"
                height="10"
                rx="2"
                fill={item.color}
              />
            ) : (
              <line
                x1="1"
                x2="17"
                y1="5"
                y2="5"
                stroke={item.color}
                strokeWidth={2.5}
                strokeDasharray={item.dashed ? "4 3" : undefined}
                strokeLinecap="round"
              />
            )}
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Serie de tiempo en líneas. No hay tooltip: la última cifra va escrita en el
 * título del bloque y la tabla de abajo tiene todas, con sus fechas. Un punto
 * sin dato corta la línea en vez de unir sus vecinos.
 */
export function TimeSeriesChart({
  label,
  data,
  lines,
  format,
  zeroLine = false,
  height = "h-56",
}: {
  /** El nombre accesible: qué muestra y la lectura en una frase. */
  readonly label: string;
  readonly data: readonly ChartRow[];
  readonly lines: readonly ChartLine[];
  readonly format: AxisFormat;
  readonly zeroLine?: boolean;
  readonly height?: "h-40" | "h-56" | "h-64";
}) {
  const config = Object.fromEntries(
    lines.map((line) => [line.key, { label: line.label, color: line.color }]),
  ) satisfies ChartConfig;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div role="img" aria-label={label}>
        <ChartContainer
          config={config}
          className={`aspect-auto ${height} w-full`}
          initialDimension={{ width: 640, height: 224 }}
        >
          <LineChart
            accessibilityLayer={false}
            data={data.map((row) => ({ ...row }))}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="on"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={28}
              tickFormatter={tickLabel}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              domain={["auto", "auto"]}
              tickFormatter={(value: number) => axisLabel(format, value)}
            />
            {zeroLine ? <ReferenceLine y={0} stroke="var(--border)" /> : null}
            {lines.map((line) => (
              <Line
                key={line.key}
                dataKey={line.key}
                type="linear"
                stroke={`var(--color-${line.key})`}
                strokeWidth={line.dashed ? 1.5 : 2}
                strokeDasharray={line.dashed ? "4 3" : undefined}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </div>
      {legendOf(lines)}
    </div>
  );
}

/**
 * Barras desde cero con una línea opcional encima. Un negativo cae debajo de
 * la línea del cero: el signo lo dice la posición y la cifra de la tabla.
 */
export function BarSeriesChart({
  label,
  data,
  bars,
  line,
  format,
  category = "month",
}: {
  readonly label: string;
  readonly data: readonly ChartRow[];
  readonly bars: readonly ChartBar[];
  readonly line?: ChartLine;
  readonly format: AxisFormat;
  /** `year` rotula con la fila tal cual; `month` con mes y año corto. */
  readonly category?: "month" | "year";
}) {
  const config = Object.fromEntries(
    [...bars, ...(line ? [line] : [])].map((item) => [
      item.key,
      { label: item.label, color: item.color },
    ]),
  ) satisfies ChartConfig;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div role="img" aria-label={label}>
        <ChartContainer
          config={config}
          className="aspect-auto h-56 w-full"
          initialDimension={{ width: 640, height: 224 }}
        >
          <ComposedChart
            accessibilityLayer={false}
            data={data.map((row) => ({ ...row }))}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="on"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={category === "year" ? 4 : 28}
              tickFormatter={category === "year" ? undefined : tickLabel}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(value: number) => axisLabel(format, value)}
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" />
            {bars.map((bar) => (
              <Bar
                key={bar.key}
                dataKey={bar.key}
                fill={`var(--color-${bar.key})`}
                radius={2}
                isAnimationActive={false}
              />
            ))}
            {line ? (
              <Line
                dataKey={line.key}
                type="linear"
                stroke={`var(--color-${line.key})`}
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ) : null}
          </ComposedChart>
        </ChartContainer>
      </div>
      {legendOf([...bars.map((bar) => ({ ...bar })), ...(line ? [line] : [])])}
    </div>
  );
}
