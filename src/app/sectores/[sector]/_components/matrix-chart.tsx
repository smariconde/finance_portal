"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import {
  companyHue,
  companyInitials,
} from "@/modules/configuration/domain/company-logo";
import { formatAmount } from "@/modules/valuation/domain/display-format";

import {
  DOT_MARK_RADIUS,
  groupLabels,
  LOGO_MARK_RADIUS,
  placeLogoMarks,
  referenceCaptionBox,
  type LabelGroup,
  type MatrixLayout,
  type PlotPoint,
} from "./matrix-layout";

/** Lo que una marca necesita para su logo: la URL de logo.dev y el monograma. */
export type MatrixLogo = {
  readonly url: string | null;
  readonly name: string | null;
  readonly ticker: string;
};

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
function clipChevron(
  cx: number,
  cy: number,
  clipX: number,
  clipY: number,
  radius: number,
) {
  // En pantalla, Y crece hacia abajo.
  const length = Math.hypot(clipX, clipY);
  const dx = clipX / length;
  const dy = -clipY / length;
  const reach = Math.max(12, radius + 6);
  const tipX = cx + dx * reach;
  const tipY = cy + dy * reach;
  const backX = tipX - dx * 4;
  const backY = tipY - dy * 4;

  return `M ${backX - dy * 4} ${backY + dx * 4} L ${tipX} ${tipY} L ${backX + dy * 4} ${backY - dx * 4}`;
}

/**
 * Lado del cuadrado donde entra el logo, como fracción del diámetro: casi el
 * inscripto en el círculo (0,71), para que un logo cuadrado y uno apaisado
 * entren enteros y con aire, sin que el borde los corte.
 */
const LOGO_INSET = 0.72;

/**
 * La marca con logo (`F6-27`): un círculo de 24 px con el logo entero
 * —ajustado al cuadrado inscripto, nunca recortado—, sobre una placa blanca
 * en los dos temas porque muchos logos son oscuros sobre transparente. Sin URL o si la imagen no carga, el monograma
 * de `CompanyMark`. Con CEDEAR, anillo grueso y la insignia cuadrada de la
 * leyenda; sin CEDEAR, un borde fino. El anillo y la insignia distinguen
 * CEDEAR en escala de grises: el color sólo los refuerza.
 */
function LogoMark({
  cx,
  cy,
  clipId,
  logo,
  cedear,
  failed,
  onFail,
}: {
  readonly cx: number;
  readonly cy: number;
  readonly clipId: string;
  readonly logo: MatrixLogo | undefined;
  readonly cedear: boolean;
  readonly failed: boolean;
  readonly onFail: () => void;
}) {
  const r = LOGO_MARK_RADIUS;
  const ticker = logo?.ticker ?? "";
  const url = failed ? null : (logo?.url ?? null);

  return (
    <g>
      <clipPath id={clipId}>
        <circle cx={cx} cy={cy} r={r} />
      </clipPath>
      {url === null ? (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            style={{ fill: `oklch(0.48 0.11 ${companyHue(ticker)})` }}
          />
          <text
            x={cx}
            y={cy}
            dy="0.35em"
            textAnchor="middle"
            className="fill-white text-xs font-semibold tracking-tight select-none"
          >
            {companyInitials(logo?.name ?? null, ticker)}
          </text>
        </>
      ) : (
        <>
          <circle cx={cx} cy={cy} r={r} className="fill-white" />
          {/*
           * Un `<image>` SVG lo carga el navegador directo de logo.dev, con la
           * misma URL que `CompanyMark`: comparte su caché de 24 h (ADR 0062).
           */}
          <image
            href={url}
            x={cx - r * LOGO_INSET}
            y={cy - r * LOGO_INSET}
            width={r * 2 * LOGO_INSET}
            height={r * 2 * LOGO_INSET}
            preserveAspectRatio="xMidYMid meet"
            clipPath={`url(#${clipId})`}
            onError={onFail}
          />
        </>
      )}
      {cedear ? (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            className="fill-none stroke-[var(--color-cedear)]"
            strokeWidth={2.5}
          />
          <rect
            x={cx + r * 0.45}
            y={cy + r * 0.45}
            width={8}
            height={8}
            rx={1.5}
            className="fill-[var(--color-cedear)] stroke-background"
            strokeWidth={1.5}
          />
        </>
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          className="fill-none stroke-foreground/25"
          strokeWidth={1}
        />
      )}
    </g>
  );
}

/** La marca sin logo, la de siempre: cuadrado relleno con CEDEAR, círculo hueco sin él. */
function DotMark({
  cx,
  cy,
  cedear,
}: {
  readonly cx: number;
  readonly cy: number;
  readonly cedear: boolean;
}) {
  return cedear ? (
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
  );
}

type PointsLayerProps = {
  readonly layout: MatrixLayout;
  readonly descriptions: ReadonlyMap<string, string>;
  readonly logos: ReadonlyMap<string, MatrixLogo>;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /** Puntos con el glifo ◆ de la leyenda, como el sesgo de acciones. */
  readonly markedIds: ReadonlySet<string>;
};

/**
 * Capa de puntos dibujada con las escalas del gráfico. Recharts pone ejes,
 * grilla y líneas; los puntos van acá porque cada uno es un control: se enfoca
 * con Tab, se selecciona con Enter o click y lleva un nombre accesible con todo
 * lo que un tooltip diría. Un tooltip de hover no alcanza (`UI-02`).
 *
 * Son dos capas. La visual ordena lo que se tapa: puntos abajo, logos encima
 * y la selección arriba de todo. La interactiva va después, en el orden de
 * siempre, para que Tab no cambie de recorrido al cambiar quién tiene logo.
 */
function PointsLayer({
  layout,
  descriptions,
  logos,
  selectedId,
  onSelect,
  markedIds,
}: PointsLayerProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  const clipPrefix = useId();
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  const area = useMemo(
    () =>
      plot === undefined
        ? undefined
        : {
            width: plot.width,
            height: plot.height,
            domainX: layout.domainX,
            domainY: layout.domainY,
          },
    [layout, plot],
  );
  const withLogo = useMemo<ReadonlySet<string>>(
    () =>
      area === undefined
        ? new Set()
        : placeLogoMarks(layout.points, area, layout.reference, measureLabel),
    [area, layout],
  );
  const groups = useMemo<readonly LabelGroup[]>(
    () =>
      area === undefined
        ? []
        : groupLabels(
            layout.points,
            area,
            { ...LABEL_METRICS, measure: measureLabel },
            layout.reference,
            (id) => (withLogo.has(id) ? LOGO_MARK_RADIUS : DOT_MARK_RADIUS),
          ),
    [area, layout, withLogo],
  );

  if (xScale === undefined || yScale === undefined || plot === undefined) {
    return null;
  }

  const at = (point: PlotPoint) => ({
    cx: xScale(point.x) ?? 0,
    cy: yScale(point.y) ?? 0,
  });
  // `groupLabels` mide desde la esquina del área; la capa, desde el SVG.
  const offsetX = plot.x;
  const offsetY = plot.y;
  // La seleccionada muestra su logo aunque no le haya tocado lugar.
  const radiusOf = (id: string) =>
    withLogo.has(id) || id === selectedId ? LOGO_MARK_RADIUS : DOT_MARK_RADIUS;
  const drawOrder = [
    ...layout.points.filter(
      (point) => !withLogo.has(point.id) && point.id !== selectedId,
    ),
    ...layout.points.filter(
      (point) => withLogo.has(point.id) && point.id !== selectedId,
    ),
    ...layout.points.filter((point) => point.id === selectedId),
  ];

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

      <g aria-hidden="true" className="pointer-events-none">
        {drawOrder.map((point) => {
          const { cx, cy } = at(point);
          const radius = radiusOf(point.id);
          const logo = logos.get(point.id);

          return (
            <g
              key={point.id}
              data-mark-for={point.id}
              data-mark={radius === LOGO_MARK_RADIUS ? "logo" : "dot"}
            >
              {radius === LOGO_MARK_RADIUS ? (
                <LogoMark
                  cx={cx}
                  cy={cy}
                  clipId={`${clipPrefix}-${point.id}`}
                  logo={logo}
                  cedear={point.cedear}
                  failed={logo?.url != null && failed.has(logo.url)}
                  onFail={() => {
                    const url = logo?.url;

                    if (url != null) {
                      setFailed((current) => new Set(current).add(url));
                    }
                  }}
                />
              ) : (
                <DotMark cx={cx} cy={cy} cedear={point.cedear} />
              )}
              {point.id === selectedId ? (
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius + 3.5}
                  className="fill-none stroke-primary"
                  strokeWidth={2}
                />
              ) : null}
              {markedIds.has(point.id) ? (
                <path
                  data-marked="true"
                  d={`M ${cx + radius * 0.75} ${cy - radius * 0.75 - 5} l 5 5 l -5 5 l -5 -5 Z`}
                  className="fill-foreground stroke-background"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
              ) : null}
              {point.clipX !== 0 || point.clipY !== 0 ? (
                <path
                  d={clipChevron(cx, cy, point.clipX, point.clipY, radius)}
                  className="fill-none stroke-foreground"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
            </g>
          );
        })}
      </g>

      {layout.reference === null || area === undefined
        ? null
        : (() => {
            const { cx, cy } = at(layout.reference);
            const box = referenceCaptionBox(
              layout.reference,
              area,
              measureLabel,
            );

            return (
              <g
                aria-hidden="true"
                data-reference-mark="true"
                className="pointer-events-none"
              >
                {/* Rombo hueco y rótulo sin placa (`F6-28`): los puntos de
                    abajo siguen visibles. */}
                <path
                  d={`M ${cx} ${cy - 10} L ${cx + 10} ${cy} L ${cx} ${cy + 10} L ${cx - 10} ${cy} Z`}
                  className="fill-background stroke-foreground"
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                />
                <circle cx={cx} cy={cy} r={1.75} className="fill-foreground" />
                <text
                  x={plot.x + box.x0}
                  y={plot.y + box.y0 + 11}
                  paintOrder="stroke"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  className="fill-muted-foreground stroke-background text-xs font-semibold"
                >
                  S&amp;P 500 TR
                </text>
              </g>
            );
          })()}

      {layout.points.map((point) => {
        const { cx, cy } = at(point);
        const radius = radiusOf(point.id);
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
            {/* Área de toque de al menos 24 px (`UI-02`). */}
            <circle
              cx={cx}
              cy={cy}
              r={Math.max(12, radius + 2)}
              className="fill-transparent"
            />
            <circle
              cx={cx}
              cy={cy}
              r={radius + 6}
              className="focus-ring fill-none stroke-ring opacity-0"
              strokeWidth={2}
            />
          </g>
        );
      })}

      {groups.map((group) => {
        const textAnchor = group.side.endsWith("left")
          ? "end"
          : group.side === "above" || group.side === "below"
            ? "middle"
            : "start";
        // El texto se escribe en la caja que `groupLabels` verificó libre.
        const x =
          textAnchor === "start"
            ? group.box.x0
            : textAnchor === "end"
              ? group.box.x1
              : (group.box.x0 + group.box.x1) / 2;
        const active = group.memberIds.includes(selectedId ?? "");

        return (
          <text
            key={group.anchorId}
            x={offsetX + x}
            y={offsetY + group.box.y1 - 4}
            textAnchor={textAnchor}
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
  readonly logos: ReadonlyMap<string, MatrixLogo>;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly titleId: string;
  readonly descriptionId: string;
  readonly asOfLabel: string;
  /** Rótulos de los ejes; por defecto, las dos ventanas de Sortino. */
  readonly xLabel?: string;
  readonly yLabel?: string;
  /** Tramo de una recta de lectura, como `y = x` en divergencias. */
  readonly diagonal?: readonly [
    { readonly x: number; readonly y: number },
    { readonly x: number; readonly y: number },
  ];
  readonly markedIds?: ReadonlySet<string>;
  /** Alto del gráfico; divergencias lo quiere cuadrado. */
  readonly className?: string;
};

const NO_MARKS: ReadonlySet<string> = new Set();

export function MatrixChart({
  layout,
  descriptions,
  logos,
  selectedId,
  onSelect,
  titleId,
  descriptionId,
  asOfLabel,
  xLabel,
  yLabel,
  diagonal,
  markedIds = NO_MARKS,
  className = "aspect-auto h-[26rem] w-full md:h-[36rem] lg:h-[44rem]",
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

  // Un rótulo largo girado no entra en el alto de un gráfico angosto: se
  // recorta. En pantallas chicas va horizontal arriba del gráfico.
  const yLabelAbove = compact && yLabel !== undefined;

  return (
    <div ref={container}>
      {yLabelAbove ? (
        <p
          aria-hidden="true"
          className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"
        >
          <ArrowUp className="size-3" />
          {yLabel}
        </p>
      ) : null}
      <ChartContainer
        config={chartConfig}
        className={className}
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
              value: xLabel ?? `Sortino 2 años al ${asOfLabel}`,
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
            width={
              yLabel === undefined ? (compact ? 40 : 56) : compact ? 40 : 64
            }
            className="numeric text-xs"
            label={
              yLabelAbove
                ? undefined
                : {
                    value: yLabel ?? "Sortino 5 años",
                    angle: -90,
                    position: "insideLeft",
                    offset: yLabel === undefined ? 12 : 0,
                    className: "fill-muted-foreground text-xs",
                  }
            }
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
          {diagonal === undefined ? null : (
            <ReferenceLine
              segment={[diagonal[0], diagonal[1]]}
              strokeDasharray="6 4"
              className="stroke-foreground/60"
              strokeWidth={1.25}
              ifOverflow="hidden"
            />
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
            logos={logos}
            selectedId={selectedId}
            onSelect={onSelect}
            markedIds={markedIds}
          />
        </ScatterChart>
      </ChartContainer>
    </div>
  );
}
