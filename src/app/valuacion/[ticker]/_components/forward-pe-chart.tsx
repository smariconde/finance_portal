"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

export type ForwardPeChartPoint = {
  /** ISO date, the axis key. */
  readonly date: string;
  /** Only for geometry; the text a reader sees is `label`. */
  readonly value: number | null;
  readonly label: string;
};

const chartConfig = {
  value: { label: "Forward P/E", color: "var(--chart-1)" },
} satisfies ChartConfig;

const shortDate = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

function dateLabel(iso: string): string {
  return shortDate.format(new Date(`${iso}T00:00:00.000Z`));
}

function multiple(value: number): string {
  return `${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })}×`;
}

/**
 * Forward P/E since the first capture (ADR 0083). The owner's threshold and the
 * trailing GAAP median are dashed reference lines with their names written on
 * them, never a colour alone; a close without a comparable consensus breaks
 * the line instead of being drawn as zero. The reading by point works by
 * keyboard (Recharts' accessibility layer) and by click; the table below holds
 * the same numbers.
 */
export function ForwardPeChart({
  points,
  threshold,
  trailingMedian,
  label,
}: {
  readonly points: readonly ForwardPeChartPoint[];
  readonly threshold: number | null;
  readonly trailingMedian: number | null;
  /** Accessible name: what it shows and the reading in one sentence. */
  readonly label: string;
}) {
  const values = [
    ...points.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...(threshold === null ? [] : [threshold]),
    ...(trailingMedian === null ? [] : [trailingMedian]),
  ];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.15, 1);
  const domain: [number, number] = [
    Math.max(0, Math.floor(low - pad)),
    Math.ceil(high + pad),
  ];

  return (
    // A group, not an image: the chart's points are reachable by keyboard.
    <div role="group" aria-label={label}>
      <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
        <LineChart
          data={[...points]}
          margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
          accessibilityLayer
        >
          <CartesianGrid vertical={false} strokeDasharray="2 4" />
          <XAxis
            dataKey="date"
            tickFormatter={dateLabel}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            domain={domain}
            tickFormatter={multiple}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          {trailingMedian === null ? null : (
            <ReferenceLine
              y={trailingMedian}
              stroke="var(--muted-foreground)"
              strokeDasharray="2 3"
              label={{
                value: `mediana trailing ${multiple(trailingMedian)}`,
                position: "insideBottomLeft",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
          )}
          {threshold === null ? null : (
            <ReferenceLine
              y={threshold}
              stroke="var(--primary)"
              strokeDasharray="6 4"
              label={{
                value: `tu umbral ${multiple(threshold)}`,
                position: "insideTopLeft",
                fill: "var(--primary)",
                fontSize: 11,
              }}
            />
          )}
          <Tooltip
            trigger="click"
            cursor={{ stroke: "var(--border)" }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as
                ForwardPeChartPoint | undefined;
              if (!active || point === undefined) return null;
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  <p className="text-muted-foreground">
                    {dateLabel(point.date)}
                  </p>
                  <p className="numeric font-medium">{point.label}</p>
                </div>
              );
            }}
          />
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={points.length <= 12}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
