"use client";

import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  ComposedChart,
  ReferenceLine,
  Scatter,
  XAxis,
  YAxis,
} from "recharts";

import { CandleShape, VolumeShape } from "@/app/_components/candle-shape";
import { CandleDirection } from "@/app/_components/candle-direction";
import {
  candlePriceScale,
  candleVolumeDomain,
} from "@/app/_components/candle-scale";
import {
  CandleWindowControls,
  handleCandleKeys,
  useCandleWindow,
} from "@/app/_components/candle-window";
import { Segmented } from "@/app/_components/segmented";
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
import {
  aggregateCandles,
  candleIntervalsOf,
} from "@/modules/trading/domain/candle-interval";
import type { Candle } from "@/modules/trading/domain/schwab-price-history";
import type { TradePlan } from "@/modules/trading/domain/trade-annotation";
import type { FillMarker } from "@/modules/trading/domain/trade-chart";
import { formatAmount } from "@/modules/valuation/domain/display-format";

import { loadTradeChart, type TradeChartResult } from "../../actions";

type Reading = Extract<TradeChartResult, { state: "read" }>;

const MARGIN = { top: 12, right: 12, bottom: 0, left: 4 } as const;
const Y_AXIS_WIDTH = 56;
const HEIGHT = 360;
const X_AXIS_HEIGHT = 30;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom - X_AXIS_HEIGHT;

/**
 * Qué entra en la escala de precio. «Velas» (por defecto) es la autoescala de
 * TradingView: las velas y las ejecuciones visibles, y un nivel del plan que
 * queda fuera se nombra arriba del gráfico. «Plan» suma stop, target y entrada.
 */
type ScaleMode = "candles" | "plan";

/** Las velas que se dibujan: las de Schwab o reagrupadas en un intervalo. */
type View = {
  readonly candles: readonly Candle[];
  readonly markers: readonly FillMarker[];
  /** En minutos; `null` en diarias. */
  readonly minutes: number | null;
};

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

function resolutionLabel(minutes: number | null): string {
  return minutes === null ? "Velas diarias" : `Velas de ${minutes} min`;
}

function candleLabel(view: View, time: number): string {
  return view.minutes === null
    ? SESSION_DAY.format(new Date(time))
    : `${NY_DAY.format(new Date(time))} ${NY_CLOCK.format(new Date(time))} NY`;
}

/** Las velas en el intervalo elegido, con cada ejecución en su vela agrupada. */
function viewOf(reading: Reading, minutes: number | null): View {
  if (
    minutes === null ||
    reading.resolution.kind === "daily" ||
    minutes === reading.resolution.minutes
  ) {
    return {
      candles: reading.candles,
      markers: reading.markers,
      minutes: reading.resolution.kind === "daily" ? null : minutes,
    };
  }
  const grouped = aggregateCandles(reading.candles, minutes);
  return {
    candles: grouped.candles,
    markers: reading.markers.map((marker) => ({
      ...marker,
      candleIndex:
        marker.candleIndex === null
          ? null
          : (grouped.indexOf[marker.candleIndex] ?? null),
    })),
    minutes,
  };
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

function planLevels(
  plan: TradePlan | null,
): { readonly label: string; readonly price: number }[] {
  const levels: { readonly label: string; readonly price: number }[] = [];
  if (plan?.stop != null)
    levels.push({ label: "Stop", price: Number(plan.stop) });
  if (plan?.target != null)
    levels.push({ label: "Target", price: Number(plan.target) });
  if (plan?.entry != null)
    levels.push({ label: "Entrada", price: Number(plan.entry) });
  return levels;
}

function CandleChart({
  view,
  plan,
  rows,
  domain,
  ticks,
}: {
  readonly view: View;
  readonly plan: TradePlan | null;
  readonly rows: readonly Row[];
  readonly domain: [number, number];
  readonly ticks: number[];
}) {
  const volumeDomain = candleVolumeDomain(rows.map((row) => row.volume));

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
        barCategoryGap="22%"
        maxBarSize={24}
      >
        <XAxis
          tick={{ fill: "var(--muted-foreground)" }}
          dataKey="index"
          height={X_AXIS_HEIGHT}
          tickLine={false}
          axisLine={false}
          minTickGap={56}
          tickFormatter={(index: number) => {
            const candle = view.candles[index];
            if (candle === undefined) return "";
            return view.minutes === null
              ? SESSION_DAY.format(new Date(candle.time)).slice(0, 5)
              : NY_CLOCK.format(new Date(candle.time));
          }}
        />
        <XAxis xAxisId="volume" dataKey="index" hide />
        <YAxis
          tick={{ fill: "var(--muted-foreground)" }}
          yAxisId="price"
          width={Y_AXIS_WIDTH}
          orientation="left"
          tickLine={false}
          axisLine={false}
          domain={domain}
          ticks={ticks}
          tickFormatter={(value: number) =>
            value.toLocaleString("es-AR", { maximumFractionDigits: 2 })
          }
        />
        <YAxis yAxisId="volume" hide domain={volumeDomain} />
        <Bar
          xAxisId="volume"
          yAxisId="volume"
          dataKey="volume"
          isAnimationActive={false}
          shape={VolumeShape}
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
            className="stroke-negative-fill"
            label={{ value: "Stop", position: "insideTopRight", fontSize: 11 }}
          />
        )}
        {plan?.target == null ? null : (
          <ReferenceLine
            yAxisId="price"
            y={Number(plan.target)}
            strokeDasharray="4 3"
            className="stroke-positive-fill"
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
  view,
  index,
}: {
  readonly view: View;
  readonly index: number;
}) {
  const candle = view.candles[index];
  if (candle === undefined) return null;
  const fills = view.markers.filter((marker) => marker.candleIndex === index);
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
        {candleLabel(view, candle.time)}
      </span>
      {value("O", candle.open)}
      {value("H", candle.high)}
      {value("L", candle.low)}
      {value("C", candle.close)}
      <CandleDirection
        open={Number(candle.open)}
        close={Number(candle.close)}
      />
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

/**
 * Un nivel del plan que la escala de velas deja fuera, con su dirección. Es un
 * botón: llevarlo a la vista es pasar la escala a «Plan».
 */
function OffScaleLevel({
  label,
  price,
  above,
  onShow,
}: {
  readonly label: string;
  readonly price: number;
  readonly above: boolean;
  readonly onShow: () => void;
}) {
  const Icon = above ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onShow}
      aria-label={`${label} ${formatMoney(String(price))}, ${above ? "arriba" : "abajo"} de la escala. Incluir el plan en la escala.`}
      className="inline-flex min-h-6 items-center gap-1 rounded-md border px-1.5 text-xs whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
      <span className="numeric text-foreground">
        {formatMoney(String(price))}
      </span>
    </button>
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
  const intervals = candleIntervalsOf(reading.resolution);
  const [minutes, setMinutes] = useState<number | null>(intervals[0] ?? null);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("candles");
  const view = useMemo(() => viewOf(reading, minutes), [reading, minutes]);

  const rows = useMemo<Row[]>(
    () =>
      view.candles.map((candle, index) => {
        const fills = view.markers.filter(
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
    [view],
  );
  const firstFill =
    view.markers.find((marker) => marker.candleIndex !== null)?.candleIndex ??
    rows.length - 1;
  // Otro intervalo es otra serie: la ventana arranca de nuevo en la entrada.
  return (
    <CandleBody
      key={view.minutes ?? "daily"}
      reading={reading}
      view={view}
      rows={rows}
      firstFill={firstFill}
      plan={plan}
      symbol={symbol}
      intervals={intervals}
      onInterval={setMinutes}
      scaleMode={scaleMode}
      onScaleMode={setScaleMode}
    />
  );
}

function CandleBody({
  reading,
  view,
  rows,
  firstFill,
  plan,
  symbol,
  intervals,
  onInterval,
  scaleMode,
  onScaleMode,
}: {
  readonly reading: Reading;
  readonly view: View;
  readonly rows: readonly Row[];
  readonly firstFill: number;
  readonly plan: TradePlan | null;
  readonly symbol: string;
  readonly intervals: readonly number[];
  readonly onInterval: (minutes: number) => void;
  readonly scaleMode: ScaleMode;
  readonly onScaleMode: (mode: ScaleMode) => void;
}) {
  const pane = useCandleWindow(
    rows.length,
    firstFill,
    MARGIN.left + Y_AXIS_WIDTH + MARGIN.right,
  );
  const { index, frame, width, move } = pane;
  const visibleRows = useMemo(
    () => rows.slice(pane.start, pane.end),
    [rows, pane.start, pane.end],
  );

  const levels = useMemo(() => planLevels(plan), [plan]);
  const scale = useMemo(() => {
    const prices = visibleRows.flatMap((row) => [
      ...row.range,
      ...(row.buy === null ? [] : [row.buy]),
      ...(row.sell === null ? [] : [row.sell]),
    ]);
    return candlePriceScale(
      scaleMode === "plan"
        ? [...prices, ...levels.map((level) => level.price)]
        : prices,
    );
  }, [visibleRows, levels, scaleMode]);
  const [bottom, top] = scale.price;
  const offScale = levels.filter(
    (level) => level.price > top || level.price < bottom,
  );

  // El dibujo no depende del cursor: moverlo no vuelve a pintar las velas.
  const chart = useMemo(
    () => (
      <CandleChart
        view={view}
        plan={plan}
        rows={visibleRows}
        domain={scale.domain}
        ticks={scale.ticks}
      />
    ),
    [view, plan, visibleRows, scale],
  );

  const plotLeft = MARGIN.left + Y_AXIS_WIDTH;
  const plotWidth = Math.max(width - plotLeft - MARGIN.right, 1);
  const band = plotWidth / Math.max(visibleRows.length, 1);

  const placed = view.markers.filter((m) => m.candleIndex !== null);
  const outside = view.markers.filter((m) => m.outsideCandle).length;
  const missing = view.markers.length - placed.length;

  return (
    <div className="flex flex-col gap-2">
      <ReadingStrip view={view} index={index} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {intervals.length > 1 ? (
            <Segmented
              label="Intervalo de las velas"
              options={intervals.map((value) => ({
                value: String(value),
                label: `${value} min`,
              }))}
              value={String(view.minutes)}
              onChange={(value) => onInterval(Number(value))}
            />
          ) : null}
          {levels.length === 0 ? null : (
            <Segmented
              label="Escala de precio"
              options={[
                { value: "candles", label: "Velas" },
                { value: "plan", label: "Plan" },
              ]}
              value={scaleMode}
              onChange={onScaleMode}
            />
          )}
        </div>
        {offScale.length === 0 ? null : (
          <div
            aria-label="Niveles fuera de la escala"
            role="group"
            className="flex flex-wrap items-center gap-1.5"
          >
            {offScale.map((level) => (
              <OffScaleLevel
                key={level.label}
                label={level.label}
                price={level.price}
                above={level.price > top}
                onShow={() => onScaleMode("plan")}
              />
            ))}
          </div>
        )}
      </div>
      <div
        ref={frame}
        role="group"
        tabIndex={0}
        aria-roledescription="gráfico de velas"
        aria-label={`${resolutionLabel(view.minutes)} de ${symbol}, ${rows.length} velas y ${placed.length} ejecuciones. Flechas para recorrer las velas, más y menos para el zoom; la tabla de ejecuciones está abajo.`}
        className="relative touch-pan-y rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          move(
            pane.start +
              Math.min(
                Math.max(
                  Math.floor((event.clientX - box.left - plotLeft) / band),
                  0,
                ),
                visibleRows.length - 1,
              ),
          );
        }}
        onKeyDown={(event) => handleCandleKeys(event, pane)}
      >
        {width === 0 ? null : (
          // Detrás de las velas: la línea no tapa la mecha de la elegida.
          <span
            aria-hidden="true"
            className="pointer-events-none absolute w-px bg-foreground/30"
            style={{
              left: plotLeft + band * (index - pane.start + 0.5),
              top: MARGIN.top,
              height: PLOT_HEIGHT,
            }}
          />
        )}
        {chart}
      </div>
      <CandleWindowControls window={pane} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Schwab · {resolutionLabel(view.minutes)}
          {view.minutes !== null &&
          reading.resolution.kind === "minute" &&
          view.minutes !== reading.resolution.minutes
            ? ` (de ${reading.resolution.minutes} min)`
            : null}
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
          <p>
            <strong>Intervalo</strong> reagrupa las mismas velas (1 minuto casi
            no tiene cuerpo; 5 o 15 sí). <strong>Escala</strong>: «Velas» ajusta
            el precio a lo visible y nombra arriba un nivel que queda afuera;
            «Plan» incluye stop y target. <strong>Zoom</strong>: lupas, o + y −
            con el gráfico enfocado.
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
