"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  ComposedChart,
  ReferenceLine,
  Scatter,
  XAxis,
  YAxis,
} from "recharts";

import { CandleShape } from "@/app/_components/candle-shape";
import { linearTicks } from "@/app/_components/chart-ticks";
import { InfoTip } from "@/app/_components/info-tip";
import {
  formatClock,
  formatMoney,
  formatQuantity,
} from "@/app/_components/trading-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TradePlan } from "@/modules/trading/domain/trade-annotation";
import { formatAmount } from "@/modules/valuation/domain/display-format";

import { loadTradeChart, type TradeChartResult } from "../../actions";

type Reading = Extract<TradeChartResult, { state: "read" }>;

const MARGIN = { top: 12, right: 12, bottom: 0, left: 4 } as const;
const Y_AXIS_WIDTH = 56;
const HEIGHT = 320;

const chartConfig = {
  candle: { label: "Vela", color: "var(--chart-1)" },
} satisfies ChartConfig;

const NY_CLOCK = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/New_York",
});
const NY_DAY = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/New_York",
});
// La vela diaria viene a la medianoche de Chicago: su fecha es la de allá.
const SESSION_DAY = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "America/Chicago",
});

function resolutionLabel(reading: Reading): string {
  return reading.resolution.kind === "daily"
    ? "Velas diarias"
    : `Velas de ${reading.resolution.minutes} min`;
}

function candleLabel(reading: Reading, time: number): string {
  return reading.resolution.kind === "daily"
    ? SESSION_DAY.format(new Date(time))
    : `${NY_DAY.format(new Date(time))} ${NY_CLOCK.format(new Date(time))} NY`;
}

type Row = {
  readonly index: number;
  readonly range: [number, number];
  readonly open: number;
  readonly close: number;
  readonly volume: number;
  readonly buy: number | null;
  readonly sell: number | null;
};

function FillShape(direction: "up" | "down") {
  function Shape({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) {
    // La punta toca el precio: una compra entra desde abajo, una venta desde arriba.
    const points =
      direction === "up"
        ? `${cx},${cy} ${cx - 6},${cy + 10} ${cx + 6},${cy + 10}`
        : `${cx},${cy} ${cx - 6},${cy - 10} ${cx + 6},${cy - 10}`;
    return (
      <polygon
        points={points}
        className={
          direction === "up"
            ? "fill-foreground stroke-card"
            : "fill-primary stroke-card"
        }
        strokeWidth={1.5}
      />
    );
  }
  return Shape;
}

const BuyShape = FillShape("up");
const SellShape = FillShape("down");

function CandleChart({
  reading,
  plan,
  rows,
}: {
  readonly reading: Reading;
  readonly plan: TradePlan | null;
  readonly rows: readonly Row[];
}) {
  const levels = [plan?.stop, plan?.target, plan?.entry]
    .filter((value): value is string => value != null)
    .map(Number);
  const lows = rows.map((row) => row.range[0]);
  const highs = rows.map((row) => row.range[1]);
  const low = Math.min(...lows, ...levels);
  const high = Math.max(...highs, ...levels);
  const pad = (high - low) * 0.04 || high * 0.01;
  // Pasos redondos: un eje en «372,56» obliga a hacer la cuenta para leerlo.
  const ticks = linearTicks(low - pad, high + pad, 5);
  const maxVolume = Math.max(...rows.map((row) => row.volume), 1);

  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto w-full"
      style={{ height: HEIGHT }}
      initialDimension={{ width: 720, height: HEIGHT }}
    >
      <ComposedChart
        accessibilityLayer={false}
        data={rows as Row[]}
        margin={MARGIN}
        barCategoryGap="20%"
      >
        <XAxis
          dataKey="index"
          tickLine={false}
          axisLine={false}
          minTickGap={56}
          tickFormatter={(index: number) => {
            const candle = reading.candles[index];
            if (candle === undefined) return "";
            return reading.resolution.kind === "daily"
              ? SESSION_DAY.format(new Date(candle.time)).slice(0, 5)
              : NY_CLOCK.format(new Date(candle.time));
          }}
        />
        <YAxis
          yAxisId="price"
          width={Y_AXIS_WIDTH}
          orientation="left"
          tickLine={false}
          axisLine={false}
          domain={[ticks[0]!, ticks.at(-1)!]}
          ticks={ticks}
          tickFormatter={(value: number) =>
            value.toLocaleString("es-AR", { maximumFractionDigits: 2 })
          }
        />
        <YAxis yAxisId="volume" hide domain={[0, maxVolume * 5]} />
        <Bar
          yAxisId="volume"
          dataKey="volume"
          isAnimationActive={false}
          fill="var(--muted-foreground)"
          fillOpacity={0.18}
        />
        <Bar
          yAxisId="price"
          dataKey="range"
          isAnimationActive={false}
          shape={CandleShape}
        />
        {plan?.stop == null ? null : (
          <ReferenceLine
            yAxisId="price"
            y={Number(plan.stop)}
            strokeDasharray="4 3"
            className="stroke-red-600 dark:stroke-red-500"
            label={{ value: "Stop", position: "insideTopRight", fontSize: 11 }}
          />
        )}
        {plan?.target == null ? null : (
          <ReferenceLine
            yAxisId="price"
            y={Number(plan.target)}
            strokeDasharray="4 3"
            className="stroke-emerald-600 dark:stroke-emerald-500"
            label={{
              value: "Target",
              position: "insideTopRight",
              fontSize: 11,
            }}
          />
        )}
        {plan?.entry == null ? null : (
          <ReferenceLine
            yAxisId="price"
            y={Number(plan.entry)}
            strokeDasharray="2 3"
            className="stroke-muted-foreground"
          />
        )}
        <Scatter
          yAxisId="price"
          dataKey="buy"
          isAnimationActive={false}
          shape={BuyShape}
        />
        <Scatter
          yAxisId="price"
          dataKey="sell"
          isAnimationActive={false}
          shape={SellShape}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

/** La misma forma que la marca del gráfico, para la lectura y la leyenda. */
function FillGlyph({ side }: { readonly side: "buy" | "sell" }) {
  return (
    <svg
      viewBox="0 0 12 10"
      aria-hidden="true"
      className={cn(
        "inline size-3 align-[-1px]",
        side === "buy" ? "fill-foreground" : "rotate-180 fill-primary",
      )}
    >
      <polygon points="6,0 0,10 12,10" />
    </svg>
  );
}

function ReadingStrip({
  reading,
  index,
}: {
  readonly reading: Reading;
  readonly index: number;
}) {
  const candle = reading.candles[index];
  if (candle === undefined) return null;
  const fills = reading.markers.filter(
    (marker) => marker.candleIndex === index,
  );
  const value = (label: string, amount: string) => (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground">{label} </span>
      <span className="numeric">{formatMoney(amount)}</span>
    </span>
  );
  return (
    <div
      aria-live="polite"
      className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 text-xs"
    >
      <span className="numeric font-medium">
        {candleLabel(reading, candle.time)}
      </span>
      {value("O", candle.open)}
      {value("H", candle.high)}
      {value("L", candle.low)}
      {value("C", candle.close)}
      <span className="whitespace-nowrap">
        <span className="text-muted-foreground">Vol </span>
        <span className="numeric">
          {formatAmount(candle.volume, { scale: 0 })}
        </span>
      </span>
      {fills.map((fill) => (
        <span key={fill.fillId} className="font-medium whitespace-nowrap">
          <FillGlyph side={fill.side} />{" "}
          {fill.side === "buy" ? "Compra" : "Venta"}{" "}
          <span className="numeric">
            {formatQuantity(fill.quantity)} @ {formatMoney(fill.price)}
          </span>
        </span>
      ))}
    </div>
  );
}

function ChartBody({
  reading,
  plan,
  symbol,
}: {
  readonly reading: Reading;
  readonly plan: TradePlan | null;
  readonly symbol: string;
}) {
  const rows = useMemo<Row[]>(
    () =>
      reading.candles.map((candle, index) => {
        const fills = reading.markers.filter(
          (marker) => marker.candleIndex === index,
        );
        const buy = fills.find((fill) => fill.side === "buy");
        const sell = fills.find((fill) => fill.side === "sell");
        return {
          index,
          range: [Number(candle.low), Number(candle.high)],
          open: Number(candle.open),
          close: Number(candle.close),
          volume: Number(candle.volume),
          buy: buy === undefined ? null : Number(buy.price),
          sell: sell === undefined ? null : Number(sell.price),
        };
      }),
    [reading],
  );
  const firstFill =
    reading.markers.find((marker) => marker.candleIndex !== null)
      ?.candleIndex ?? rows.length - 1;
  const [index, setIndex] = useState(firstFill);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry?.contentRect.width ?? 0),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // El dibujo no depende del cursor: moverlo no vuelve a pintar las velas.
  const chart = useMemo(
    () => <CandleChart reading={reading} plan={plan} rows={rows} />,
    [reading, plan, rows],
  );

  const plotLeft = MARGIN.left + Y_AXIS_WIDTH;
  const plotWidth = Math.max(width - plotLeft - MARGIN.right, 1);
  const band = plotWidth / Math.max(rows.length, 1);
  const move = (next: number) =>
    setIndex(Math.min(Math.max(next, 0), rows.length - 1));

  const placed = reading.markers.filter((m) => m.candleIndex !== null);
  const outside = reading.markers.filter((m) => m.outsideCandle).length;
  const missing = reading.markers.length - placed.length;

  return (
    <div className="flex flex-col gap-2">
      <ReadingStrip reading={reading} index={index} />
      <div
        ref={frame}
        role="group"
        tabIndex={0}
        aria-roledescription="gráfico de velas"
        aria-label={`${resolutionLabel(reading)} de ${symbol}, ${rows.length} velas y ${placed.length} ejecuciones. Flechas para recorrer las velas; la tabla de ejecuciones está abajo.`}
        className="relative touch-pan-y rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          move(Math.floor((event.clientX - box.left - plotLeft) / band));
        }}
        onKeyDown={(event) => {
          const step: Record<string, number> = {
            ArrowLeft: -1,
            ArrowRight: 1,
            PageUp: -10,
            PageDown: 10,
          };
          if (event.key in step) {
            event.preventDefault();
            move(index + step[event.key]!);
          } else if (event.key === "Home") {
            event.preventDefault();
            move(0);
          } else if (event.key === "End") {
            event.preventDefault();
            move(rows.length - 1);
          }
        }}
      >
        {chart}
        {width === 0 ? null : (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute w-px bg-foreground/30"
            style={{
              left: plotLeft + band * (index + 0.5),
              top: MARGIN.top,
              height: HEIGHT - MARGIN.top - 30,
            }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Schwab · {resolutionLabel(reading)}
          {reading.resolution.kind === "minute"
            ? reading.extendedHours
              ? " · horario extendido"
              : " · horario regular"
            : null}{" "}
          · leídas {formatClock(reading.readAt)}
        </span>
        <InfoTip title="Las velas">
          <p>
            Se piden a Schwab al abrir el trade y <strong>no se guardan</strong>
            . Las marcas son tus ejecuciones: <FillGlyph side="buy" /> compra,{" "}
            <FillGlyph side="sell" /> venta. Las líneas punteadas son el stop,
            el target y la entrada del plan.
          </p>
          {reading.fallback === null ? null : (
            <p>
              Schwab sirve velas de 1 minuto de unos 47 días y de 5 minutos de
              unos 8 meses. Para este day trade
              {reading.fallback === "intraday_empty"
                ? " no devolvió velas de minutos"
                : " ya no hay velas de minutos"}
              , así que se dibuja con velas diarias.
            </p>
          )}
        </InfoTip>
        {reading.fallback === null ? null : (
          <Badge variant="outline">Sin velas de minutos</Badge>
        )}
        {outside === 0 ? null : (
          <span className="inline-flex items-center">
            <Badge variant="outline">
              {outside} {outside === 1 ? "ejecución" : "ejecuciones"} fuera de
              su vela
            </Badge>
            <InfoTip title="Fuera de su vela">
              <p>
                El precio de la ejecución no cae entre el mínimo y el máximo de
                su vela. Schwab ajusta las velas viejas por un split o un
                dividendo posterior, y la ejecución conserva el precio que se
                pagó: medido en un reverse split (×3) y en un dividendo (~5 %).
              </p>
            </InfoTip>
          </span>
        )}
        {missing === 0 ? null : (
          <Badge variant="outline">
            {missing} {missing === 1 ? "ejecución" : "ejecuciones"} sin vela
          </Badge>
        )}
      </div>
    </div>
  );
}

const FAILURE_LABELS: Readonly<Record<string, string>> = {
  not_connected: "Schwab desconectado",
  source_daily_budget_exhausted: "Cuota diaria de Schwab agotada",
  source_source_disabled: "Schwab apagado con el kill switch",
  symbol_not_chartable: "Símbolo sin velas",
};

export function TradeChart({
  tradeRef,
  symbol,
  plan,
}: {
  readonly tradeRef: string;
  readonly symbol: string;
  readonly plan: TradePlan | null;
}) {
  const [result, setResult] = useState<TradeChartResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    loadTradeChart({ ref: tradeRef }).then(
      (next) => {
        if (current) setResult(next);
      },
      () => {
        if (current) setResult({ state: "unavailable" });
      },
    );
    return () => {
      current = false;
    };
  }, [tradeRef, attempt]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2">Gráfico</CardTitle>
      </CardHeader>
      <CardContent>
        {result === null ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="w-full" style={{ height: HEIGHT }} />
            <span className="sr-only">Pidiendo las velas a Schwab…</span>
          </div>
        ) : result.state === "read" ? (
          result.candles.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Schwab no devolvió velas para estas fechas.
            </p>
          ) : (
            <ChartBody reading={result} plan={plan} symbol={symbol} />
          )
        ) : (
          <div
            role="alert"
            className={cn(
              "flex flex-wrap items-center gap-3 py-6 text-sm text-muted-foreground",
            )}
          >
            <span>
              {result.state === "failed"
                ? (FAILURE_LABELS[result.code] ?? "Velas no disponibles")
                : "Velas no disponibles"}
              {result.state === "failed" ? (
                <code className="ml-2 font-mono text-xs">{result.code}</code>
              ) : null}
            </span>
            {result.state === "failed" && result.code === "not_connected" ? (
              <Link
                href="/cuenta"
                className="text-foreground underline underline-offset-4"
              >
                Conectar en Cuenta
              </Link>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setResult(null);
                  setAttempt(attempt + 1);
                }}
              >
                <RefreshCw data-icon="inline-start" />
                Reintentar
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
