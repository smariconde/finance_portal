"use client";

import {
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { termShort } from "@/app/_components/financial-terms";
import { InfoTip } from "@/app/_components/info-tip";
import {
  formatSession,
  formatSignedMoney,
} from "@/app/_components/trading-format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import type {
  CurvePoint,
  Drawdown,
} from "@/modules/trading/domain/trading-stats";

import { Money } from "../../_components/pnl-values";

/**
 * La curva de lo realizado salida por salida y, debajo, cuánto está bajo su
 * máximo (`trading-stats-1.0.0`). El eje es la secuencia de salidas, como el
 * gráfico del diario. La lectura va en una franja fija y se recorre con
 * puntero, toque o flechas; el cursor se dibuja fuera de Recharts y el dibujo
 * se memoiza, así moverse no vuelve a pintar los dos gráficos.
 */
const Y_AXIS_WIDTH = 56;
const PLOT_RIGHT = 8;

const chartConfig = {
  cumulative: { label: "Acumulado", color: "var(--chart-2)" },
  drawdown: { label: "Drawdown", color: "var(--color-negative-fill)" },
} satisfies ChartConfig;

const axisMoney = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type Row = {
  readonly index: number;
  readonly cumulative: number;
  readonly drawdown: number;
};

function monthTicks(curve: readonly CurvePoint[]): number[] {
  const ticks: number[] = [];
  curve.forEach((point, index) => {
    if (
      index === 0 ||
      point.session.slice(0, 7) !== curve[index - 1]!.session.slice(0, 7)
    ) {
      ticks.push(index);
    }
  });
  return ticks;
}

function monthLabel(session: string | undefined): string {
  if (session === undefined) return "";
  const [year, month] = session.split("-");
  return `${month}/${year!.slice(2)}`;
}

function describe(point: CurvePoint): string {
  return `${point.symbol}, ${formatSession(point.session)}: salida ${formatSignedMoney(point.pnl)}, acumulado ${formatSignedMoney(point.cumulative)}, drawdown ${formatSignedMoney(point.drawdown)}.`;
}

function Charts({
  rows,
  curve,
  span,
}: {
  readonly rows: readonly Row[];
  readonly curve: readonly CurvePoint[];
  readonly span: { readonly from: number; readonly to: number } | null;
}) {
  const ticks = monthTicks(curve);
  const last = Math.max(rows.length - 1, 1);
  const xAxis = (hide: boolean) => (
    <XAxis
      dataKey="index"
      type="number"
      domain={[0, last]}
      ticks={ticks}
      hide={hide}
      tickLine={false}
      axisLine={false}
      minTickGap={32}
      tickFormatter={(index: number) => monthLabel(curve[index]?.session)}
    />
  );
  const yAxis = (
    <YAxis
      width={Y_AXIS_WIDTH}
      tickLine={false}
      axisLine={false}
      tickFormatter={(value: number) => axisMoney.format(value)}
    />
  );
  const margin = { top: 8, right: PLOT_RIGHT, bottom: 0, left: 0 };

  return (
    <div className="flex flex-col">
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-56 w-full"
        initialDimension={{ width: 640, height: 224 }}
      >
        <LineChart accessibilityLayer={false} data={rows} margin={margin}>
          <CartesianGrid vertical={false} />
          {xAxis(true)}
          {yAxis}
          {span === null ? null : (
            <ReferenceArea
              x1={span.from}
              x2={span.to}
              // `currentColor` y una clase de texto: el `fill` de una clase no
              // le gana al atributo que pone Recharts.
              fill="currentColor"
              fillOpacity={0.1}
              className="text-negative"
              ifOverflow="extendDomain"
            />
          )}
          <ReferenceLine y={0} className="stroke-border" />
          <Line
            dataKey="cumulative"
            type="linear"
            dot={false}
            strokeWidth={2}
            stroke="var(--color-cumulative)"
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-24 w-full"
        initialDimension={{ width: 640, height: 96 }}
      >
        <AreaChart accessibilityLayer={false} data={rows} margin={margin}>
          <CartesianGrid vertical={false} />
          {xAxis(false)}
          {yAxis}
          <Area
            dataKey="drawdown"
            type="linear"
            baseValue={0}
            fill="currentColor"
            fillOpacity={0.2}
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-negative"
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

export function RealizedCurve({
  drawdown,
}: {
  readonly drawdown: Drawdown | null;
}) {
  const instructionsId = useId();
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const curve = useMemo(() => drawdown?.curve ?? [], [drawdown]);

  // Number sólo para la geometría: las cifras que se leen son las decimales.
  const rows = useMemo(
    () =>
      curve.map((point, index) => ({
        index,
        cumulative: Number(point.cumulative),
        drawdown: Number(point.drawdown),
      })),
    [curve],
  );

  const span = useMemo(() => {
    if (drawdown === null || drawdown.max.troughAt === null) return null;
    const from =
      drawdown.max.peakAt === null
        ? 0
        : curve.findIndex((p) => p.executedAt === drawdown.max.peakAt);
    const to = curve.findIndex((p) => p.executedAt === drawdown.max.troughAt);
    return from < 0 || to < 0 ? null : { from, to };
  }, [curve, drawdown]);

  const charts = useMemo(
    () => <Charts rows={rows} curve={curve} span={span} />,
    [rows, curve, span],
  );

  if (drawdown === null || curve.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2">Curva realizada</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-10 text-center text-sm text-muted-foreground">
            Sin salidas con P&amp;L.
          </p>
        </CardContent>
      </Card>
    );
  }

  const shownIndex = active ?? curve.length - 1;
  const shown = curve[shownIndex]!;
  const last = Math.max(curve.length - 1, 1);

  function moveTo(index: number) {
    const point = curve[index];
    if (point === undefined) return;
    setActive(index);
    setAnnouncement(describe(point));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 1;
    switch (event.key) {
      case "ArrowLeft":
        moveTo(Math.max(0, shownIndex - step));
        break;
      case "ArrowRight":
        moveTo(Math.min(curve.length - 1, shownIndex + step));
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(curve.length - 1);
        break;
      case "Escape":
        setActive(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /** La salida más cercana al puntero, desde su posición sobre el área. */
  function track(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const width = box.width - Y_AXIS_WIDTH - PLOT_RIGHT;
    if (width <= 0) return;
    const share = (event.clientX - box.left - Y_AXIS_WIDTH) / width;
    const index = Math.round(Math.min(1, Math.max(0, share)) * last);
    setActive(Math.min(index, curve.length - 1));
  }

  const cursorLeft = `calc(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH + PLOT_RIGHT}px) * ${shownIndex / last})`;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2" className="flex items-center gap-1">
          Curva realizada
          <InfoTip title="Cómo se lee">
            <p>
              Arriba, lo realizado acumulado salida por salida, en el orden en
              que se ejecutaron. Abajo, cuánto está bajo su máximo previo.
            </p>
            <p>
              La franja sombreada es el {termShort("maxDrawdown")}: del máximo
              al piso.
            </p>
          </InfoTip>
        </CardTitle>
        <span className="text-sm text-muted-foreground">
          Desde el máximo{" "}
          <Money value={drawdown.current} signed className="font-semibold" />
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          className="min-h-9 rounded-md border bg-muted/30 px-3 py-2 text-xs"
          aria-hidden="true"
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
            <span className="font-medium text-foreground">
              {shown.symbol} · {formatSession(shown.session)}
            </span>
            <span>
              <span className="text-muted-foreground">Salida </span>
              <Money value={shown.pnl} signed className="font-medium" />
            </span>
            <span>
              <span className="text-muted-foreground">Acumulado </span>
              <Money value={shown.cumulative} signed className="font-medium" />
            </span>
            <span>
              <span className="text-muted-foreground">Drawdown </span>
              <Money value={shown.drawdown} signed className="font-medium" />
            </span>
          </div>
        </div>
        <div
          role="group"
          tabIndex={0}
          aria-label={`Curva realizada de ${curve.length} salidas: acumulado ${formatSignedMoney(curve.at(-1)!.cumulative)}, ${termShort("maxDrawdown")} ${formatSignedMoney(drawdown.max.amount === "0" ? "0" : `-${drawdown.max.amount}`)}.`}
          aria-describedby={instructionsId}
          onKeyDown={onKeyDown}
          onPointerMove={track}
          onPointerDown={track}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setActive(null);
          }}
          className="relative touch-pan-y rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span id={instructionsId} className="sr-only">
            Flechas izquierda y derecha para recorrer las salidas, Mayúscula más
            flecha para saltar diez, Inicio y Fin para los extremos.
          </span>
          {charts}
          {active === null ? null : (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-2 bottom-6 w-px border-l border-dashed border-foreground/50"
              style={{ left: cursorLeft }}
            />
          )}
        </div>
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </CardContent>
    </Card>
  );
}
