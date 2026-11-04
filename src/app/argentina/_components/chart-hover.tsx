"use client";

import { useEffect } from "react";
import { usePlotArea } from "recharts";

import { cn } from "@/lib/utils";

import {
  nearestByY,
  readingPlacement,
  readingWidth,
  type PlotArea,
} from "./chart-kit";

/**
 * Informa el área del dibujo cuando cambia: el gráfico la calcula al medirse
 * y la capa de lectura la necesita para ubicar cada punto sin pedirle a
 * Recharts que redibuje.
 */
export function PlotAreaProbe({
  onChange,
}: {
  readonly onChange: (plot: PlotArea) => void;
}) {
  const plot = usePlotArea();
  const x = plot?.x;
  const y = plot?.y;
  const width = plot?.width;
  const height = plot?.height;
  useEffect(() => {
    if (
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined
    ) {
      return;
    }
    onChange({ x, y, width, height });
  }, [x, y, width, height, onChange]);
  return null;
}

export function samePlot(a: PlotArea | null, b: PlotArea): boolean {
  return (
    a !== null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

export type HoverPoint = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  /** La altura en píxeles; `null` cuando el punto no tiene cifra. */
  readonly y: number | null;
  /** La cifra exacta, como la escribe la tabla. */
  readonly value: string;
  /** La cifra en las unidades del eje, para el rótulo sobre el eje Y. */
  readonly axisValue: string | null;
};

const TITLE_HEIGHT = 20;
const DETAIL_HEIGHT = 16;
const ROW_HEIGHT = 18;
const PADDING = 14;

/**
 * La lectura de un punto encima del gráfico (`F9-14`): la línea vertical del
 * punto, una horizontal hasta el eje Y con la cifra de la serie más cercana al
 * puntero, y al costado una etiqueta con todas las series. Va fuera del árbol
 * de Recharts, así mover el puntero no redibuja las líneas. Es sólo visual:
 * el teclado y el lector de pantalla leen la franja y la región `polite`.
 */
export function HoverLayer({
  plot,
  x,
  title,
  detail,
  points,
  pointerY,
  touch,
}: {
  readonly plot: PlotArea;
  readonly x: number;
  readonly title: string;
  readonly detail?: string;
  readonly points: readonly HoverPoint[];
  /** La altura del puntero; `null` con el teclado. */
  readonly pointerY: number | null;
  readonly touch: boolean;
}) {
  const focus = nearestByY(points, pointerY);
  // Cada fila es punto, nombre, un espacio y la cifra.
  const width = readingWidth(
    [
      title,
      detail ?? "",
      ...points.map((point) => `${point.label}  ${point.value}`),
    ],
    14,
  );
  const height =
    TITLE_HEIGHT +
    (detail ? DETAIL_HEIGHT : 0) +
    ROW_HEIGHT * points.length +
    PADDING;
  // Con el dedo encima del punto, la etiqueta se aparta más.
  const anchorY = focus?.y ?? pointerY ?? plot.y + plot.height / 2;
  const placement = readingPlacement({
    x,
    y: anchorY,
    plot,
    width,
    height,
    gap: touch ? 32 : 14,
  });

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <svg className="absolute inset-0 size-full overflow-visible">
        <line
          x1={x}
          x2={x}
          y1={plot.y}
          y2={plot.y + plot.height}
          stroke="var(--foreground)"
          strokeOpacity={0.35}
        />
        {focus?.y != null ? (
          <line
            x1={plot.x}
            x2={x}
            y1={focus.y}
            y2={focus.y}
            stroke={focus.color}
            strokeOpacity={0.8}
            strokeDasharray="3 3"
          />
        ) : null}
        {points.map((point) =>
          point.y === null ? null : (
            <circle
              key={point.key}
              cx={x}
              cy={point.y}
              r={point.key === focus?.key ? 4.5 : 3.5}
              fill="var(--card)"
              stroke={point.color}
              strokeWidth={2}
            />
          ),
        )}
      </svg>
      {focus?.y != null && focus.axisValue !== null ? (
        <span
          className="numeric absolute -translate-y-1/2 rounded-sm border bg-popover px-1 text-[10px] leading-4 font-medium text-popover-foreground"
          style={{
            right: `calc(100% - ${plot.x - 2}px)`,
            top: focus.y,
            borderColor: focus.color,
          }}
        >
          {focus.axisValue}
        </span>
      ) : null}
      {placement === null ? null : (
        <div
          className="absolute flex flex-col gap-0.5 rounded-md border bg-popover/95 px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          style={{ left: placement.left, top: placement.top, width }}
        >
          <span className="leading-5 font-medium">{title}</span>
          {detail ? (
            <span className="truncate leading-4 text-muted-foreground">
              {detail}
            </span>
          ) : null}
          <ul className="flex flex-col">
            {points.map((point) => (
              <li
                key={point.key}
                className="flex h-[18px] items-center gap-1.5 leading-none"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: point.color }}
                />
                <span
                  className={cn(
                    "truncate text-muted-foreground",
                    point.key === focus?.key && "text-popover-foreground",
                  )}
                >
                  {point.label}
                </span>
                <span
                  className={cn(
                    "numeric ml-auto shrink-0",
                    point.key === focus?.key && "font-semibold",
                  )}
                >
                  {point.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
