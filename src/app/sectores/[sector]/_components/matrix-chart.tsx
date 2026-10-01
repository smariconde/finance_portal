"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
} from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatAmount } from "@/modules/valuation/domain/display-format";

import {
  groupLabels,
  type LabelGroup,
  type LabelSide,
  type MatrixLayout,
  type PlotPoint,
} from "./matrix-layout";

const chartConfig = {
  security: { label: "Security", color: "var(--muted-foreground)" },
  cedear: { label: "Con CEDEAR", color: "var(--chart-1)" },
  reference: { label: "S&P 500 TR", color: "var(--foreground)" },
  fit: { label: "Ajuste lineal del sector", color: "var(--chart-4)" },
} satisfies ChartConfig;

/** Los decimales que la marca necesita: `1`, `0,5`, `0,25`, nunca `1,00`. */
const tick = (value: number) => {
  const cents = Math.round(value * 100);
  const scale = cents % 100 === 0 ? 0 : cents % 10 === 0 ? 1 : 2;

  return formatAmount(value.toFixed(2), { scale });
};

const LABEL_METRICS = { charWidth: 8, lineHeight: 16, gap: 8, overlap: 10 };

let labelContext: CanvasRenderingContext2D | null | undefined;

/**
 * Ancho real de un rótulo en la fuente de la página. Estimarlo con un ancho
 * fijo por carácter dejaba choques medidos entre rótulos vecinos.
 */
function measureLabel(text: string): number | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  if (labelContext === undefined) {
    labelContext = document.createElement("canvas").getContext("2d");

    if (labelContext !== null) {
      labelContext.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
    }
  }

  return labelContext === null
    ? undefined
    : labelContext.measureText(text).width;
}

/**
 * Chevron que apunta hacia donde está el valor real de un punto recortado: el
 * punto se dibuja en el borde, y la flecha dice que sigue más allá.
 */
function clipChevron(cx: number, cy: number, clipX: number, clipY: number) {
  // En pantalla, Y crece hacia abajo.
  const length = Math.hypot(clipX, clipY);
  const dx = clipX / length;
  const dy = -clipY / length;
  const tipX = cx + dx * 12;
  const tipY = cy + dy * 12;
  const backX = tipX - dx * 4;
  const backY = tipY - dy * 4;

  return `M ${backX - dy * 4} ${backY + dx * 4} L ${tipX} ${tipY} L ${backX + dy * 4} ${backY - dx * 4}`;
}

type PointsLayerProps = {
  readonly layout: MatrixLayout;
  readonly descriptions: ReadonlyMap<string, string>;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
};

/**
 * Capa de puntos dibujada con las escalas del gráfico. Recharts pone ejes,
 * grilla y líneas; los puntos van acá porque cada uno es un control: se enfoca
 * con Tab, se selecciona con Enter o click y lleva un nombre accesible con todo
 * lo que un tooltip diría. Un tooltip de hover no alcanza (`UI-02`).
 */
function PointsLayer({
  layout,
  descriptions,
  selectedId,
  onSelect,
}: PointsLayerProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();

  const groups = useMemo<readonly LabelGroup[]>(
    () =>
      plot === undefined
        ? []
        : groupLabels(
            layout.points,
            {
              width: plot.width,
              height: plot.height,
              domainX: layout.domainX,
              domainY: layout.domainY,
            },
            { ...LABEL_METRICS, measure: measureLabel },
            layout.reference,
          ),
    [layout, plot],
  );

  if (xScale === undefined || yScale === undefined || plot === undefined) {
    return null;
  }

  const at = (point: PlotPoint) => ({
    cx: xScale(point.x) ?? 0,
    cy: yScale(point.y) ?? 0,
  });
  const byId = new Map(layout.points.map((point) => [point.id, point]));

  return (
    <g className="matrix-points">
      {layout.fitSegment === null ? null : (
        <text
          x={xScale(layout.fitSegment[1].x) ?? 0}
          y={(yScale(layout.fitSegment[1].y) ?? 0) - 8}
          textAnchor="end"
          className="fill-[var(--color-fit)] text-xs"
          aria-hidden="true"
        >
          Ajuste lineal del sector
        </text>
      )}

      {layout.reference === null
        ? null
        : (() => {
            const { cx, cy } = at(layout.reference);

            return (
              <g aria-hidden="true">
                <path
                  d={`M ${cx} ${cy - 8} L ${cx + 8} ${cy} L ${cx} ${cy + 8} L ${cx - 8} ${cy} Z`}
                  className="fill-background stroke-foreground"
                  strokeWidth={2}
                />
                <text
                  x={cx + 12}
                  y={cy - 10}
                  className="fill-foreground text-xs font-medium"
                >
                  S&amp;P 500 TR
                </text>
              </g>
            );
          })()}

      {layout.points.map((point) => {
        const { cx, cy } = at(point);
        const selected = point.id === selectedId;
        const select = () => onSelect(point.id);

        return (
          <g
            key={point.id}
            role="button"
            tabIndex={0}
            aria-label={descriptions.get(point.id) ?? point.label}
            aria-pressed={selected}
            data-point-id={point.id}
            className="cursor-pointer outline-none [&:focus-visible>.focus-ring]:opacity-100"
            onClick={select}
            onFocus={select}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                select();
              }
            }}
          >
            {/* Área de toque más grande que la marca. */}
            <circle cx={cx} cy={cy} r={12} className="fill-transparent" />
            <circle
              cx={cx}
              cy={cy}
              r={10}
              className="focus-ring fill-none stroke-ring opacity-0"
              strokeWidth={2}
            />
            {selected ? (
              <circle
                cx={cx}
                cy={cy}
                r={9}
                className="fill-none stroke-primary"
                strokeWidth={2}
              />
            ) : null}
            {point.cedear ? (
              <rect
                x={cx - 4.5}
                y={cy - 4.5}
                width={9}
                height={9}
                rx={1.5}
                className="fill-[var(--color-cedear)] stroke-background"
                strokeWidth={1}
              />
            ) : (
              <circle
                cx={cx}
                cy={cy}
                r={4.5}
                className="fill-background stroke-[var(--color-security)]"
                strokeWidth={1.75}
              />
            )}
            {point.clipX !== 0 || point.clipY !== 0 ? (
              <path
                d={clipChevron(cx, cy, point.clipX, point.clipY)}
                className="fill-none stroke-foreground"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              />
            ) : null}
          </g>
        );
      })}

      {groups.map((group) => {
        const anchor = byId.get(group.anchorId);

        if (anchor === undefined) {
          return null;
        }

        const { cx, cy } = at(anchor);
        // Mismas cajas que `groupLabels`: el texto se escribe donde el
        // algoritmo verificó que no choca.
        const offsets: Record<
          LabelSide,
          readonly [number, number, "start" | "end" | "middle"]
        > = {
          right: [8, 4, "start"],
          left: [-8, 4, "end"],
          above: [0, -10, "middle"],
          below: [0, 19, "middle"],
          "above-right": [4, -7, "start"],
          "below-right": [4, 15, "start"],
          "above-left": [-4, -7, "end"],
          "below-left": [-4, 15, "end"],
        };
        const [dx, dy, textAnchor] = offsets[group.side];
        const position = { x: cx + dx, y: cy + dy, textAnchor };
        const active = group.memberIds.includes(selectedId ?? "");

        return (
          <text
            key={group.anchorId}
            x={position.x}
            y={position.y}
            textAnchor={position.textAnchor as "start" | "end" | "middle"}
            aria-hidden="true"
            className={
              active
                ? "fill-foreground text-xs font-semibold"
                : "fill-muted-foreground text-xs"
            }
          >
            {group.text}
          </text>
        );
      })}
    </g>
  );
}

export type MatrixChartProps = {
  readonly layout: MatrixLayout;
  readonly descriptions: ReadonlyMap<string, string>;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly titleId: string;
  readonly descriptionId: string;
  readonly asOfLabel: string;
};

export function MatrixChart({
  layout,
  descriptions,
  selectedId,
  onSelect,
  titleId,
  descriptionId,
  asOfLabel,
}: MatrixChartProps) {
  const reference = layout.reference;
  const container = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const element = container.current;

    if (element === null) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setCompact((entry?.contentRect.width ?? 0) < 520);
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={container}>
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-[26rem] w-full md:h-[32rem]"
        role="group"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <ScatterChart
          accessibilityLayer={false}
          margin={{ top: 16, right: compact ? 12 : 24, bottom: 28, left: 4 }}
        >
          <CartesianGrid strokeDasharray="2 4" className="stroke-border" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[layout.domainX[0], layout.domainX[1]]}
            ticks={[...layout.ticksX]}
            allowDataOverflow
            tickFormatter={tick}
            tickLine={false}
            className="numeric text-xs"
            label={{
              value: `Sortino 2 años al ${asOfLabel}`,
              position: "insideBottom",
              offset: -18,
              className: "fill-muted-foreground text-xs",
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[layout.domainY[0], layout.domainY[1]]}
            ticks={[...layout.ticksY]}
            allowDataOverflow
            tickFormatter={tick}
            tickLine={false}
            width={compact ? 40 : 56}
            className="numeric text-xs"
            label={{
              value: "Sortino 5 años",
              angle: -90,
              position: "insideLeft",
              offset: 12,
              className: "fill-muted-foreground text-xs",
            }}
          />
          {reference === null ? null : (
            <>
              <ReferenceLine
                x={reference.x}
                strokeDasharray="5 4"
                className="stroke-muted-foreground"
                ifOverflow="hidden"
              />
              <ReferenceLine
                y={reference.y}
                strokeDasharray="5 4"
                className="stroke-muted-foreground"
                ifOverflow="hidden"
              />
            </>
          )}
          {layout.fitSegment === null ? null : (
            <ReferenceLine
              segment={[layout.fitSegment[0], layout.fitSegment[1]]}
              stroke="var(--color-fit)"
              strokeWidth={1.5}
              ifOverflow="hidden"
            />
          )}
          {/* Registra los datos en los ejes; las marcas las dibuja la capa. */}
          <Scatter
            data={[...layout.points]}
            shape={() => <g />}
            isAnimationActive={false}
            legendType="none"
          />
          <PointsLayer
            layout={layout}
            descriptions={descriptions}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </ScatterChart>
      </ChartContainer>
    </div>
  );
}
