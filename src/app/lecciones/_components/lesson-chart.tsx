"use client";

import { Fragment, useMemo } from "react";
import {
  Bar,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  XAxis,
  YAxis,
} from "recharts";

import { CandleShape, VolumeShape } from "@/app/_components/candle-shape";
import {
  candlePriceScale,
  candleVolumeDomain,
  VOLUME_SHARE,
} from "@/app/_components/candle-scale";
import { CandleDirection } from "@/app/_components/candle-direction";
import {
  CandleWindowControls,
  handleCandleKeys,
  useCandleWindow,
} from "@/app/_components/candle-window";
import { InfoTip } from "@/app/_components/info-tip";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import {
  RULE_LABELS,
  type LessonChartRow,
  type LessonLevel,
  type LessonMark,
  type LessonOverlay,
  type LessonPanel,
  type LessonRule,
  type LessonTimeframe,
  type LessonZone,
  type LevelTone,
  type RuleKind,
} from "@/modules/education/domain/technical-lessons";
import { formatAmount } from "@/modules/valuation/domain/display-format";

export type LessonChartProps = {
  readonly title: string;
  readonly timeframe: LessonTimeframe;
  readonly rows: readonly LessonChartRow[];
  readonly overlays: readonly LessonOverlay[];
  readonly panels: readonly LessonPanel[];
  readonly levels: readonly LessonLevel[];
  readonly marks: readonly LessonMark[];
  readonly zones: readonly LessonZone[];
  readonly rules: readonly LessonRule[];
};

const MARGIN = { top: 26, right: 12, bottom: 0, left: 4 } as const;
const PANEL_MARGIN = { top: 6, right: 12, bottom: 0, left: 4 } as const;
const Y_AXIS_WIDTH = 52;
const HEIGHT = 360;
/** La altura del eje X: Recharts lo reserva aunque esté oculto en diarias. */
const X_AXIS_HEIGHT = 30;
const PANEL_HEIGHT = 92;
const MARK_OFFSET = 16;

const OVERLAYS: Readonly<
  Record<LessonOverlay, { label: string; color: string; dash?: string }>
> = {
  ema9: { label: "EMA 9", color: "var(--chart-2)" },
  ema20: { label: "EMA 20", color: "var(--chart-2)" },
  sma20: { label: "SMA 20", color: "var(--chart-2)" },
  sma50: { label: "SMA 50", color: "var(--chart-3)" },
  vwap: { label: "VWAP", color: "var(--chart-4)" },
};

const chartConfig = {
  candle: { label: "Vela", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Stop en rojo y target en verde con su rótulo escrito: el color no está solo. */
const LEVEL_CLASS: Readonly<Record<LevelTone, string>> = {
  stop: "stroke-negative-fill",
  target: "stroke-positive-fill",
  entry: "stroke-foreground",
  support: "stroke-muted-foreground",
  resistance: "stroke-muted-foreground",
  neutral: "stroke-muted-foreground/60",
};

const LEVEL_DASH: Readonly<Record<LevelTone, string>> = {
  stop: "4 3",
  target: "4 3",
  entry: "2 3",
  support: "7 3",
  resistance: "7 3",
  neutral: "1 3",
};

const KIND_CLASS: Readonly<Record<RuleKind, string>> = {
  read: "text-muted-foreground",
  context: "text-muted-foreground",
  entry: "text-foreground",
  stop: "text-negative",
  target: "text-positive",
  invalidation: "text-warning",
};

type Row = {
  readonly index: number;
  readonly range: [number, number];
  readonly open: number;
  readonly close: number;
  readonly volume: number;
  readonly markHigh: number | null;
  readonly markLow: number | null;
  readonly ema9: number | null;
  readonly ema20: number | null;
  readonly sma20: number | null;
  readonly sma50: number | null;
  readonly vwap: number | null;
  readonly rsi: number | null;
  readonly macd: number | null;
  readonly signal: number | null;
  readonly histogram: number | null;
};

function price(value: number): string {
  return value.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** El número de una marca en un círculo dibujado, nunca un glifo Unicode. */
export function MarkBadge({
  n,
  selected = false,
  className,
}: {
  readonly n: number;
  readonly selected?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "numeric inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] leading-none font-semibold",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-foreground/40 bg-card text-foreground",
        className,
      )}
    >
      {n}
    </span>
  );
}

function markShape(
  side: "high" | "low",
  marks: ReadonlyMap<number, LessonMark>,
  selected: number | null,
) {
  function Shape({
    cx = 0,
    cy = 0,
    payload,
  }: {
    cx?: number;
    cy?: number;
    payload?: Row;
  }) {
    const mark = payload === undefined ? undefined : marks.get(payload.index);
    if (mark === undefined || mark.at !== side) return null;
    const y = side === "high" ? cy - MARK_OFFSET : cy + MARK_OFFSET;
    const active = mark.n === selected;
    return (
      <g>
        <line
          x1={cx}
          x2={cx}
          y1={side === "high" ? cy - 4 : cy + 4}
          y2={side === "high" ? y + 8 : y - 8}
          className="stroke-foreground/40"
          strokeWidth={1}
        />
        <circle
          cx={cx}
          cy={y}
          r={8}
          className={
            active
              ? "fill-primary stroke-primary"
              : "fill-card stroke-foreground/50"
          }
          strokeWidth={1}
        />
        <text
          x={cx}
          y={y}
          dy="0.35em"
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          className={active ? "fill-primary-foreground" : "fill-foreground"}
        >
          {mark.n}
        </text>
      </g>
    );
  }
  return Shape;
}

function PriceChart({
  rows,
  props,
  selected,
}: {
  readonly rows: readonly Row[];
  readonly props: LessonChartProps;
  readonly selected: number | null;
}) {
  const marks = useMemo(
    () => new Map(props.marks.map((mark) => [mark.index, mark])),
    [props.marks],
  );
  // Los niveles son parte de la lección: entran en la escala con las velas.
  const { domain, ticks } = candlePriceScale(
    [
      ...rows.flatMap((row) => row.range),
      ...props.levels.map((level) => level.price),
    ],
    { padding: 0.08 },
  );
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
          hide={props.timeframe === "1d"}
          tickLine={false}
          axisLine={false}
          minTickGap={48}
          tickFormatter={(index: number) =>
            props.rows[index]?.clock ?? String(index + 1)
          }
        />
        <XAxis xAxisId="volume" dataKey="index" hide />
        <YAxis
          tick={{ fill: "var(--muted-foreground)" }}
          yAxisId="price"
          width={Y_AXIS_WIDTH}
          tickLine={false}
          axisLine={false}
          domain={domain}
          ticks={ticks}
          tickFormatter={(value: number) =>
            value.toLocaleString("es-AR", { maximumFractionDigits: 2 })
          }
        />
        <YAxis yAxisId="volume" hide domain={volumeDomain} />
        {props.zones
          .filter(
            (zone) =>
              zone.to >= rows[0]!.index && zone.from <= rows.at(-1)!.index,
          )
          .map((zone) => (
            <ReferenceArea
              key={zone.label}
              yAxisId="price"
              x1={Math.max(zone.from, rows[0]!.index)}
              x2={Math.min(zone.to, rows.at(-1)!.index)}
              y1={zone.low}
              y2={zone.high}
              fill="var(--muted-foreground)"
              fillOpacity={0.1}
              stroke="none"
              label={{
                value: zone.label,
                position: "insideTopLeft",
                fontSize: 11,
                className: "fill-muted-foreground",
              }}
            />
          ))}
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
        {props.overlays.map((overlay) => (
          <Line
            key={overlay}
            yAxisId="price"
            dataKey={overlay}
            type="linear"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            stroke={OVERLAYS[overlay].color}
            strokeWidth={1.75}
            connectNulls={false}
          />
        ))}
        {props.levels.map((level) => (
          <ReferenceLine
            key={level.label}
            yAxisId="price"
            y={level.price}
            strokeDasharray={LEVEL_DASH[level.tone]}
            className={LEVEL_CLASS[level.tone]}
          />
        ))}
        <Scatter
          yAxisId="price"
          dataKey="markHigh"
          isAnimationActive={false}
          shape={markShape("high", marks, selected)}
        />
        <Scatter
          yAxisId="price"
          dataKey="markLow"
          isAnimationActive={false}
          shape={markShape("low", marks, selected)}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function RsiPanel({ rows }: { readonly rows: readonly Row[] }) {
  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto w-full"
      style={{ height: PANEL_HEIGHT }}
      initialDimension={{ width: 720, height: PANEL_HEIGHT }}
    >
      <ComposedChart
        accessibilityLayer={false}
        data={rows as Row[]}
        margin={PANEL_MARGIN}
        barCategoryGap="20%"
      >
        <XAxis dataKey="index" hide />
        <YAxis
          tick={{ fill: "var(--muted-foreground)" }}
          width={Y_AXIS_WIDTH}
          tickLine={false}
          axisLine={false}
          domain={[0, 100]}
          ticks={[30, 70]}
        />
        <ReferenceArea
          y1={30}
          y2={70}
          fill="var(--muted-foreground)"
          fillOpacity={0.08}
          stroke="none"
        />
        <ReferenceLine
          y={70}
          strokeDasharray="3 3"
          className="stroke-muted-foreground/60"
        />
        <ReferenceLine
          y={30}
          strokeDasharray="3 3"
          className="stroke-muted-foreground/60"
        />
        <Line
          dataKey="rsi"
          type="linear"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
          stroke="var(--chart-4)"
          strokeWidth={1.5}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function MacdPanel({ rows }: { readonly rows: readonly Row[] }) {
  const values = rows.flatMap((row) =>
    [row.macd, row.signal, row.histogram].filter(
      (value): value is number => value !== null,
    ),
  );
  const extent = Math.max(...values.map(Math.abs), 0.01) * 1.1;
  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto w-full"
      style={{ height: PANEL_HEIGHT }}
      initialDimension={{ width: 720, height: PANEL_HEIGHT }}
    >
      <ComposedChart
        accessibilityLayer={false}
        data={rows as Row[]}
        margin={PANEL_MARGIN}
        barCategoryGap="20%"
      >
        <XAxis dataKey="index" hide />
        <YAxis
          tick={{ fill: "var(--muted-foreground)" }}
          width={Y_AXIS_WIDTH}
          tickLine={false}
          axisLine={false}
          domain={[-extent, extent]}
          ticks={[0]}
        />
        <ReferenceLine y={0} className="stroke-muted-foreground/60" />
        <Bar
          dataKey="histogram"
          isAnimationActive={false}
          fill="var(--muted-foreground)"
          fillOpacity={0.35}
        />
        <Line
          dataKey="macd"
          type="linear"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
          stroke="var(--chart-1)"
          strokeWidth={1.5}
        />
        <Line
          dataKey="signal"
          type="linear"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
          stroke="var(--chart-5)"
          strokeWidth={1.5}
          strokeDasharray="4 2"
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function Swatch({
  color,
  dash = false,
}: {
  readonly color: string;
  readonly dash?: boolean;
}) {
  return (
    <svg viewBox="0 0 16 4" aria-hidden="true" className="h-1 w-4">
      <line
        x1="0"
        x2="16"
        y1="2"
        y2="2"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray={dash ? "4 2" : undefined}
      />
    </svg>
  );
}

function LevelSwatch({ tone }: { readonly tone: LevelTone }) {
  return (
    <svg viewBox="0 0 20 4" aria-hidden="true" className="h-1 w-5">
      <line
        x1="0"
        x2="20"
        y1="2"
        y2="2"
        className={LEVEL_CLASS[tone]}
        strokeWidth="2"
        strokeDasharray={LEVEL_DASH[tone]}
      />
    </svg>
  );
}

function ReadingStrip({
  row,
  props,
}: {
  readonly row: LessonChartRow;
  readonly props: LessonChartProps;
}) {
  const value = (label: string, amount: number | null) => (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground">{label} </span>
      <span className="numeric">{amount === null ? "—" : price(amount)}</span>
    </span>
  );
  const mark = props.marks.find((item) => item.index === row.index);
  return (
    <div
      aria-live="polite"
      className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 text-xs"
    >
      <span className="numeric font-medium">
        {row.clock ?? `Vela ${row.index + 1}`}
      </span>
      {value("O", row.candle.open)}
      {value("H", row.candle.high)}
      {value("L", row.candle.low)}
      {value("C", row.candle.close)}
      <CandleDirection open={row.candle.open} close={row.candle.close} />
      <span className="whitespace-nowrap">
        <span className="text-muted-foreground">Vol </span>
        <span className="numeric">
          {formatAmount(String(row.candle.volume), { scale: 0 })}
        </span>
      </span>
      {props.overlays.map((overlay) => (
        <Fragment key={overlay}>
          {value(OVERLAYS[overlay].label, row.overlays[overlay] ?? null)}
        </Fragment>
      ))}
      {props.panels.includes("rsi") ? (
        <span className="whitespace-nowrap">
          <span className="text-muted-foreground">RSI </span>
          <span className="numeric">
            {row.rsi === null ? "—" : row.rsi.toFixed(1).replace(".", ",")}
          </span>
        </span>
      ) : null}
      {props.panels.includes("macd") ? (
        <span className="whitespace-nowrap">
          <span className="text-muted-foreground">MACD </span>
          <span className="numeric">
            {row.macd === null ? "—" : row.macd.toFixed(2).replace(".", ",")}
            {" / "}
            {row.signal === null
              ? "—"
              : row.signal.toFixed(2).replace(".", ",")}
          </span>
        </span>
      ) : null}
      {mark === undefined ? null : (
        <span className="inline-flex items-center gap-1 font-medium">
          <MarkBadge n={mark.n} selected />
          {mark.label}
        </span>
      )}
    </div>
  );
}

export function LessonChart(props: LessonChartProps) {
  const rows = useMemo<Row[]>(
    () =>
      props.rows.map((row) => {
        const mark = props.marks.find((item) => item.index === row.index);
        return {
          index: row.index,
          range: [row.candle.low, row.candle.high],
          open: row.candle.open,
          close: row.candle.close,
          volume: row.candle.volume,
          markHigh: mark?.at === "high" ? row.candle.high : null,
          markLow: mark?.at === "low" ? row.candle.low : null,
          ema9: row.overlays.ema9 ?? null,
          ema20: row.overlays.ema20 ?? null,
          sma20: row.overlays.sma20 ?? null,
          sma50: row.overlays.sma50 ?? null,
          vwap: row.overlays.vwap ?? null,
          rsi: row.rsi,
          macd: row.macd,
          signal: row.signal,
          histogram: row.histogram,
        };
      }),
    [props.rows, props.marks],
  );
  const firstMark = props.marks.toSorted((a, b) => a.n - b.n)[0] ?? null;
  const view = useCandleWindow(
    rows.length,
    firstMark?.index ?? rows.length - 1,
    MARGIN.left + Y_AXIS_WIDTH + MARGIN.right,
  );
  const { index, frame, width, move } = view;
  const markIndexes = useMemo(
    () => new Set(props.marks.map((mark) => mark.index)),
    [props.marks],
  );
  const visibleRows = useMemo(
    () => rows.slice(view.start, view.end),
    [rows, view.start, view.end],
  );

  const selected = props.marks.find((mark) => mark.index === index)?.n ?? null;

  // El dibujo depende de la marca elegida, no del cursor: moverlo no repinta.
  const chart = useMemo(
    () => <PriceChart rows={visibleRows} props={props} selected={selected} />,
    [visibleRows, props, selected],
  );
  const panels = useMemo(
    () => (
      <>
        {props.panels.includes("rsi") ? <RsiPanel rows={visibleRows} /> : null}
        {props.panels.includes("macd") ? (
          <MacdPanel rows={visibleRows} />
        ) : null}
      </>
    ),
    [visibleRows, props.panels],
  );

  const plotLeft = MARGIN.left + Y_AXIS_WIDTH;
  const plotWidth = Math.max(width - plotLeft - MARGIN.right, 1);
  const band = plotWidth / Math.max(visibleRows.length, 1);
  const panelsHeight = props.panels.length * PANEL_HEIGHT;
  const xAxisSpace = props.timeframe === "5m" ? X_AXIS_HEIGHT : 0;
  const plotHeight = HEIGHT - MARGIN.top - xAxisSpace;
  const row = props.rows[index]!;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-2">
        <ReadingStrip row={row} props={props} />
        <div
          ref={frame}
          role="group"
          tabIndex={0}
          aria-roledescription="gráfico de velas esquemático"
          aria-label={`${props.title}: ${rows.length} velas esquemáticas con ${props.marks.length} marcas numeradas. Flechas para recorrer las velas; las reglas de al lado describen cada marca.`}
          className="relative touch-pan-y rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            move(
              view.start +
                Math.min(
                  Math.max(
                    Math.floor((event.clientX - box.left - plotLeft) / band),
                    0,
                  ),
                  visibleRows.length - 1,
                ),
            );
          }}
          onKeyDown={(event) => handleCandleKeys(event, view)}
        >
          {width === 0 ||
          selected === null ||
          !markIndexes.has(index) ? null : (
            // La vela de la marca elegida, resaltada como en un libro de
            // análisis técnico: es lo que la regla describe.
            <span
              aria-hidden="true"
              className="pointer-events-none absolute rounded-sm bg-primary/10"
              style={{
                left: plotLeft + band * (index - view.start),
                width: band,
                top: MARGIN.top,
                height: plotHeight * (1 - VOLUME_SHARE),
              }}
            />
          )}
          {width === 0 ? null : (
            // Detrás de las velas: la línea no tapa la mecha de la elegida.
            <span
              aria-hidden="true"
              className="pointer-events-none absolute w-px bg-foreground/30"
              style={{
                left: plotLeft + band * (index - view.start + 0.5),
                top: MARGIN.top,
                height: plotHeight + panelsHeight,
              }}
            />
          )}
          {chart}
          {panels}
        </div>
        <CandleWindowControls window={view} />
        {props.levels.length === 0 ? null : (
          <ul
            aria-label="Niveles"
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
          >
            {props.levels
              .toSorted((a, b) => b.price - a.price)
              .map((level) => (
                <li
                  key={level.label}
                  className="inline-flex items-center gap-1.5"
                >
                  <LevelSwatch tone={level.tone} />
                  <span className="text-muted-foreground">{level.label}</span>
                  <span className="numeric">{price(level.price)}</span>
                </li>
              ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Badge variant="outline">Esquema</Badge>
          <span>
            {props.timeframe === "5m" ? "Velas de 5 min" : "Velas diarias"}
          </span>
          {props.overlays.map((overlay) => (
            <span key={overlay} className="inline-flex items-center gap-1">
              <Swatch color={OVERLAYS[overlay].color} />
              {OVERLAYS[overlay].label}
            </span>
          ))}
          {props.panels.includes("rsi") ? (
            <span className="inline-flex items-center gap-1">
              <Swatch color="var(--chart-4)" />
              RSI 14
            </span>
          ) : null}
          {props.panels.includes("macd") ? (
            <>
              <span className="inline-flex items-center gap-1">
                <Swatch color="var(--chart-1)" />
                MACD
              </span>
              <span className="inline-flex items-center gap-1">
                <Swatch color="var(--chart-5)" dash />
                Señal
              </span>
            </>
          ) : null}
          <InfoTip title="Las velas de la lección">
            <p>
              Son un <strong>esquema</strong>: no son de ningún ticker ni de
              ninguna fecha, y no gastan cuota de Schwab. Los ejemplos reales
              son tus trades etiquetados con el setup.
            </p>
            <p>
              Los indicadores se calculan sobre estas velas con
              technical-indicators-1.0.0.
            </p>
          </InfoTip>
        </div>
      </div>
      <ol className="flex flex-col gap-1" aria-label="Reglas">
        {props.rules.map((rule) => {
          const mark =
            rule.mark === undefined
              ? undefined
              : props.marks.find((item) => item.n === rule.mark);
          const body = (
            <>
              {mark === undefined ? (
                <span className="size-5 shrink-0" aria-hidden="true" />
              ) : (
                <MarkBadge n={mark.n} selected={mark.n === selected} />
              )}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn("text-xs font-medium", KIND_CLASS[rule.kind])}
                >
                  {RULE_LABELS[rule.kind]}
                </span>
                <span className="text-sm">{rule.text}</span>
              </span>
            </>
          );
          return (
            <li key={`${rule.kind}-${rule.text}`}>
              {mark === undefined ? (
                <div className="flex gap-2.5 px-2 py-2">{body}</div>
              ) : (
                <button
                  type="button"
                  aria-pressed={mark.n === selected}
                  aria-label={`${RULE_LABELS[rule.kind]}: ${rule.text} Marca ${mark.n}, ${mark.label}.`}
                  onClick={() => move(mark.index)}
                  className={cn(
                    "flex w-full gap-2.5 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                    mark.n === selected && "bg-muted",
                  )}
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
