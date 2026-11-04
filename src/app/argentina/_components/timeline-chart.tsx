"use client";

import { X } from "lucide-react";
import {
  useCallback,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
} from "recharts";

import { InfoTip } from "@/app/_components/info-tip";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  PRESIDENTIAL_TERMS_SOURCE,
  regimesOverlapping,
  termOn,
  termsOverlapping,
} from "@/modules/argentina-dashboard/domain/argentina-timeline";
import {
  pointChange,
  type ChangeKind,
} from "@/modules/argentina-dashboard/domain/chart-history";

import { Fold } from "./block";
import { HoverLayer, PlotAreaProbe, samePlot } from "./chart-hover";
import {
  axisLabel,
  axisReading,
  ChartToolbar,
  dateOf,
  dayNumber,
  formatValue,
  linearTicks,
  logTicks,
  periodLabel,
  Segmented,
  Swatch,
  timeTicks,
  toPixel,
  type AxisFormat,
  type LegendItem,
  type PlotArea,
  type ValueFormat,
} from "./chart-kit";
import { calendarDate, fractionAsPoints, signedAmount } from "./format";

export type TimelineSeries = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly mark: "line" | "dashed" | "bar";
  /** Cómo se escribe la cifra en la lectura y en la tabla. */
  readonly format: ValueFormat;
  /** Un nivel cambia por su cociente; una tasa o un saldo, por su diferencia. */
  readonly change: ChangeKind;
  /** Sólo para el dibujo: la unidad del eje la dice el título. */
  readonly divisor?: number;
};

/** Una banda sombreada entre dos claves de la fila, como las cambiarias. */
export type TimelineBand = {
  readonly lowKey: string;
  readonly highKey: string;
  readonly label: string;
  readonly color: string;
  readonly format: ValueFormat;
};

export type TimelineRow = {
  readonly on: string;
  readonly values: Readonly<Record<string, string | null>>;
};

/**
 * Un contexto propio en lugar de los regímenes generales (`F9-15`): tramos
 * rotulados en el primer carril, temporadas sombreadas en el segundo y
 * fechas puntuales como líneas verticales. Son datos declarados que el
 * gráfico sólo ubica; las presidencias se dibujan igual.
 */
export type ChartContextSpan = {
  readonly id: string;
  readonly label: string;
  readonly from: string;
  /** Exclusivo, como en `argentina-timeline-1.0.0`. */
  readonly to: string;
  readonly description: string;
  readonly source: string;
};

export type ChartContextEvent = {
  readonly id: string;
  readonly on: string;
  readonly label: string;
  readonly description: string;
  readonly source: string;
};

export type ChartContext = {
  /** El nombre del botón que muestra u oculta las marcas. */
  readonly toggleLabel: string;
  readonly spansTitle: string;
  readonly spans: readonly ChartContextSpan[];
  readonly seasons: readonly ChartContextSpan[];
  readonly seasonNote: string;
  readonly eventsTitle: string;
  readonly events: readonly ChartContextEvent[];
  /** Cierra la lista plegada: qué versión declara las fechas. */
  readonly note: string;
};

/** Lo que la capa dibuja: un tramo en su carril, o una fecha. */
type DrawnSpan = {
  readonly id: string;
  readonly label: string;
  readonly from: string;
  readonly to: string | null;
  readonly lane: 0 | 1;
  readonly color: string;
};

function overlapping<T extends { readonly from: string; readonly to: string }>(
  spans: readonly T[],
  fromOn: string,
  toOn: string,
): T[] {
  return spans.filter((span) => span.from <= toOn && span.to > fromOn);
}

/** El último día de un tramo de fin exclusivo. */
function lastDayOf(to: string): string {
  return dateOf(dayNumber(to) - 1);
}

export type RangeId = "1y" | "2y" | "3y" | "5y" | "10y" | "20y" | "max";

const RANGE_YEARS: Record<RangeId, number> = {
  "1y": 1,
  "2y": 2,
  "3y": 3,
  "5y": 5,
  "10y": 10,
  "20y": 20,
  max: Number.POSITIVE_INFINITY,
};

const RANGE_LABEL: Record<RangeId, string> = {
  "1y": "1A",
  "2y": "2A",
  "3y": "3A",
  "5y": "5A",
  "10y": "10A",
  "20y": "20A",
  max: "Máx",
};

/** Hasta cinco años, una serie diaria se dibuja día por día. */
const DAILY_MAX_YEARS = 5;

/**
 * Las filas diarias son la unión de las fechas de todas las series: un día
 * que publicó el CCL y no el mayorista deja un nulo que cortaría la línea
 * como si faltara un tramo. Una línea cruza los nulos entre dos datos a lo
 * sumo a una semana —un fin de semana largo—; un hueco mayor sigue cortado.
 * Es sólo el trazo: la lectura y la tabla siguen diciendo «Sin dato».
 */
const DAILY_BRIDGE_DAYS = 7;

/** La clave con que se dibuja una serie: la suya, con los nulos cortos cruzados. */
function drawnKey(key: string): string {
  return `${key}__drawn`;
}

function bridgeShortGaps(
  rows: Record<string, number | string | null | readonly number[]>[],
  key: string,
  maxDays: number,
): void {
  let previous = -1;
  rows.forEach((row, index) => {
    const value = row[key];
    row[drawnKey(key)] = typeof value === "number" ? value : null;
    if (typeof value !== "number") return;
    const before = rows[previous];
    if (before !== undefined && index - previous > 1) {
      const fromT = before.t as number;
      const toT = row.t as number;
      const fromValue = before[key] as number;
      if (toT - fromT <= maxDays) {
        // Sobre el segmento recto entre los dos datos: el mismo trazo que
        // dibujaría la línea si el día del medio no existiera.
        for (let middle = previous + 1; middle < index; middle += 1) {
          const share = ((rows[middle]!.t as number) - fromT) / (toT - fromT);
          rows[middle]![drawnKey(key)] =
            fromValue + (value - fromValue) * share;
        }
      }
    }
    previous = index;
  });
}

/** El ancho del eje Y y el margen derecho: entre ellos está el área del dibujo. */
const Y_AXIS_WIDTH = 56;
const PLOT_RIGHT = 8;

const HEIGHT = { sm: "h-56", md: "h-72", lg: "h-80" } as const;

type Resolution = "daily" | "month_end" | "monthly" | "annual";

type PlotRow = {
  readonly t: number;
  readonly on: string;
  readonly [key: string]: number | string | null | readonly number[];
};

function yearsBefore(on: string, years: number): string {
  if (!Number.isFinite(years)) return "0000-01-01";
  const date = new Date(`${on}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function elapsed(fromOn: string, toOn: string): string {
  const [fy, fm, fd] = fromOn.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [ty, tm, td] = toOn.split("-").map(Number) as [number, number, number];
  const days = Math.round(dayNumber(toOn) - dayNumber(fromOn));
  if (Math.abs(days) < 90) return `${days} días`;
  let months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  const years = Math.floor(months / 12);
  months -= years * 12;
  const parts = [
    years > 0 ? `${years} ${years === 1 ? "año" : "años"}` : null,
    months > 0 ? `${months} ${months === 1 ? "mes" : "meses"}` : null,
  ].filter(Boolean);
  return parts.join(" y ") || "menos de un mes";
}

function changeText(
  from: string | null,
  to: string | null,
  series: TimelineSeries,
): string {
  const change = pointChange(from, to, series.change);
  if (change.status === "unavailable") {
    return change.reason === "missing_value" ? "Sin dato" : "Base no positiva";
  }
  if (series.change === "ratio") return fractionAsPoints(change.value);
  switch (series.format.kind) {
    case "points":
    case "signedPoints":
      return `${signedAmount(change.value, series.format.scale ?? 1)} pp`;
    case "fraction":
      return fractionAsPoints(change.value).replace(" %", " pp");
    default:
      return signedAmount(change.value, series.format.scale ?? 0);
  }
}

function compareNote(series: readonly TimelineSeries[]): string {
  const ratio = series.some((item) => item.change === "ratio");
  const difference = series.some((item) => item.change === "difference");
  const rule =
    ratio && difference
      ? "Un nivel se compara por su variación porcentual; una tasa o un saldo, por su diferencia (pp son puntos porcentuales)."
      : ratio
        ? "Se compara la variación porcentual entre los dos puntos."
        : "Se compara la diferencia entre los dos puntos (pp son puntos porcentuales).";
  return `${rule} Describe el cambio entre dos fechas; no dice por qué ocurrió.`;
}

/**
 * La capa de contexto: gobiernos como franjas alternadas con su nombre arriba
 * y regímenes como barras sobre el área del gráfico. Va por encima del
 * margen superior, así nunca tapa la serie. Sólo ubica fechas declaradas.
 */
function MarksLayer({
  fromOn,
  toOn,
  spans,
  events,
}: {
  readonly fromOn: string;
  readonly toOn: string;
  readonly spans: readonly DrawnSpan[];
  readonly events: readonly ChartContextEvent[];
}) {
  const xScale = useXAxisScale();
  const plot = usePlotArea();
  if (xScale === undefined || plot === undefined) return null;
  const x = (on: string) => {
    const clamped = on < fromOn ? fromOn : on > toOn ? toOn : on;
    return Number(xScale(dayNumber(clamped)));
  };
  const terms = termsOverlapping(fromOn, toOn);
  // Una fecha se rotula sólo si su nombre no pisa el de la anterior ni se
  // sale del dibujo.
  const placedEvents: {
    readonly event: ChartContextEvent;
    readonly left: number;
    readonly labeled: boolean;
  }[] = [];
  let lastLabelEnd = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (event.on < fromOn || event.on > toOn) continue;
    const left = x(event.on);
    const labelEnd = left + 3 + event.label.length * 5.6 + 6;
    const labeled = left + 3 >= lastLabelEnd && labelEnd <= plot.x + plot.width;
    if (labeled) lastLabelEnd = labelEnd;
    placedEvents.push({ event, left, labeled });
  }

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {terms.map((term, index) => {
        const left = x(term.from);
        const right = x(term.to ?? toOn);
        const width = right - left;
        if (!(width > 0)) return null;
        const fits = width >= term.label.length * 6 + 10;
        return (
          <g key={term.id}>
            {index % 2 === 0 ? null : (
              <rect
                x={left}
                y={plot.y}
                width={width}
                height={plot.height}
                fill="var(--muted-foreground)"
                fillOpacity={0.07}
              />
            )}
            {term.from >= fromOn ? (
              <line
                x1={left}
                x2={left}
                y1={plot.y - 14}
                y2={plot.y + plot.height}
                stroke="var(--muted-foreground)"
                strokeOpacity={0.45}
                strokeDasharray="2 3"
              />
            ) : null}
            {fits ? (
              <text
                x={left + 4}
                y={plot.y - 4}
                className="fill-muted-foreground text-[10px]"
              >
                {term.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {spans.map((span) => {
        const left = x(span.from);
        const right = x(span.to ?? toOn);
        const width = right - left;
        if (!(width > 1)) return null;
        const y = plot.y - 36 + span.lane * 11;
        const fits = width >= span.label.length * 5.6 + 8;
        return (
          <g key={span.id}>
            <rect
              x={left}
              y={y}
              width={width}
              height={9}
              rx={2}
              fill={span.color}
              fillOpacity={0.22}
            />
            {fits ? (
              <text
                x={left + 3}
                y={y + 7.5}
                className="fill-foreground text-[9px]"
              >
                {span.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {placedEvents.map(({ event, left, labeled }) => (
        <g key={event.id}>
          <line
            x1={left}
            x2={left}
            y1={plot.y}
            y2={plot.y + plot.height}
            stroke="var(--chart-5)"
            strokeOpacity={0.6}
            strokeDasharray="3 3"
          />
          {labeled ? (
            <text
              x={left + 3}
              y={plot.y + 10}
              className="fill-muted-foreground text-[9px]"
            >
              {event.label}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  );
}

/** Los puntos fijados para comparar, dibujados con las mismas escalas. */
function ActiveDots({
  rows,
  series,
  active,
}: {
  readonly rows: readonly PlotRow[];
  readonly series: readonly TimelineSeries[];
  readonly active: readonly number[];
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (xScale === undefined || yScale === undefined) return null;
  return (
    <g aria-hidden="true" className="pointer-events-none">
      {active.map((index) => {
        const row = rows[index];
        if (row === undefined) return null;
        return series
          .filter((item) => item.mark !== "bar")
          .map((item) => {
            const value = row[item.key];
            if (typeof value !== "number") return null;
            const cx = Number(xScale(row.t));
            const cy = Number(yScale(value));
            if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
            return (
              <circle
                key={`${index}-${item.key}`}
                cx={cx}
                cy={cy}
                r={4}
                fill="var(--card)"
                stroke={item.color}
                strokeWidth={2}
              />
            );
          });
      })}
    </g>
  );
}

/**
 * Una serie de tiempo que se recorre (`F9-13`): la cifra de cualquier punto
 * con mouse, toque o flechas; rangos de un año a toda la historia, con la
 * resolución dicha a la vista; escala lineal o logarítmica; dos puntos
 * fijados que se comparan; y detrás, los gobiernos y los regímenes con su
 * fecha. Un punto sin dato corta la línea. La tabla plegada tiene las mismas
 * filas que el rango a la vista.
 */
export function TimelineChart({
  label,
  series,
  band,
  daily,
  monthly,
  frequency,
  ranges = ["2y", "5y", "10y", "max"],
  defaultRange,
  axis,
  zeroLine = false,
  allowLog = false,
  height = "md",
  caption,
  showTable = true,
  context,
}: {
  /** El nombre accesible: qué muestra y la lectura en una frase. */
  readonly label: string;
  readonly series: readonly TimelineSeries[];
  readonly band?: TimelineBand;
  /** Las filas diarias de los últimos años, sólo para una serie diaria. */
  readonly daily?: readonly TimelineRow[];
  /** Toda la historia: cierre de mes para una serie diaria, o sus meses. */
  readonly monthly: readonly TimelineRow[];
  readonly frequency: "daily" | "monthly" | "annual";
  readonly ranges?: readonly RangeId[];
  readonly defaultRange?: RangeId;
  readonly axis: AxisFormat;
  readonly zeroLine?: boolean;
  /** Ofrecer escala logarítmica: sólo para niveles. */
  readonly allowLog?: boolean;
  readonly height?: keyof typeof HEIGHT;
  /** El caption de la tabla equivalente. */
  readonly caption: string;
  /**
   * `false` cuando la sección trae su propia tabla, porque la suya escribe
   * el motivo de cada ausencia y esta sólo «Sin dato».
   */
  readonly showTable?: boolean;
  /** Las fechas propias de la serie en lugar de los regímenes generales. */
  readonly context?: ChartContext;
}) {
  const instructionsId = useId();
  const firstOn = monthly[0]?.on ?? daily?.[0]?.on;
  const lastOn = (daily?.at(-1) ?? monthly.at(-1))?.on;
  const spanYears =
    firstOn && lastOn ? (dayNumber(lastOn) - dayNumber(firstOn)) / 365.25 : 0;
  const offered = ranges.filter(
    (range) => range === "max" || RANGE_YEARS[range] < spanYears + 0.25,
  );
  const [range, setRange] = useState<RangeId>(
    defaultRange && offered.includes(defaultRange)
      ? defaultRange
      : (offered[0] ?? "max"),
  );
  const [logScale, setLogScale] = useState(false);
  const [showMarks, setShowMarks] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [pins, setPins] = useState<readonly string[]>([]);
  const [activeOn, setActiveOn] = useState<string | null>(null);
  /** La altura del puntero sobre el gráfico; `null` con el teclado. */
  const [pointer, setPointer] = useState<{
    readonly y: number;
    readonly touch: boolean;
  } | null>(null);
  const [plot, setPlot] = useState<PlotArea | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [tableOpen, setTableOpen] = useState(false);
  const onPlot = useCallback(
    (next: PlotArea) =>
      setPlot((current) => (samePlot(current, next) ? current : next)),
    [],
  );

  const years = RANGE_YEARS[range];
  const resolution: Resolution =
    frequency === "annual"
      ? "annual"
      : frequency === "monthly"
        ? "monthly"
        : daily !== undefined && years <= DAILY_MAX_YEARS
          ? "daily"
          : "month_end";
  const source = resolution === "daily" && daily ? daily : monthly;
  // Memo a mano: mover el puntero cambia el punto activo y re-renderiza el
  // componente, y nada de lo que se dibuja debe recalcularse por eso.
  const visible = useMemo(() => {
    const fromOn = lastOn ? yearsBefore(lastOn, years) : "0000-01-01";
    return source.filter((row) => row.on >= fromOn);
  }, [source, lastOn, years]);

  const plotted = useMemo(() => {
    const keys = [
      ...series.map((item) => item.key),
      ...(band ? [band.lowKey, band.highKey] : []),
    ];
    const numbers = (row: TimelineRow, key: string) => {
      const text = row.values[key] ?? null;
      if (text === null) return null;
      const divisor =
        series.find((item) => item.key === key)?.divisor ??
        series[0]?.divisor ??
        1;
      const value = Number(text) / divisor;
      return Number.isFinite(value) ? value : null;
    };
    const entries = visible.map((row) => {
      const entry: Record<string, number | string | null | readonly number[]> =
        { t: dayNumber(row.on), on: row.on };
      for (const key of keys) entry[key] = numbers(row, key);
      return entry;
    });
    for (const key of keys) {
      bridgeShortGaps(
        entries,
        key,
        resolution === "daily" ? DAILY_BRIDGE_DAYS : 0,
      );
    }
    if (band) {
      for (const entry of entries) {
        const low = entry[drawnKey(band.lowKey)];
        const high = entry[drawnKey(band.highKey)];
        entry.band =
          typeof low === "number" && typeof high === "number"
            ? [low, high]
            : null;
      }
    }
    const rows = entries as PlotRow[];
    const values = rows.flatMap((row) =>
      keys
        .map((key) => row[key])
        .filter((value): value is number => typeof value === "number"),
    );
    return {
      rows,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
    };
  }, [visible, series, band, resolution]);

  const hasBars = series.some((item) => item.mark === "bar");
  const logAvailable = allowLog && !hasBars && plotted.min > 0;
  const useLog = logScale && logAvailable;
  const indexOf = useMemo(
    () => new Map(plotted.rows.map((row, index) => [row.on, index])),
    [plotted],
  );
  const activeIndex =
    activeOn === null ? undefined : (indexOf.get(activeOn) ?? undefined);
  // Sin un punto activo se lee el último que tiene alguna cifra: la base real
  // de un mes cuyo IPC todavía no salió no es «el último dato».
  const latestIndex = visible.findLastIndex((row) =>
    series.some((item) => row.values[item.key] != null),
  );
  const shownIndex =
    activeIndex ?? (latestIndex >= 0 ? latestIndex : visible.length - 1);
  const shown = visible[shownIndex];
  const pinned = useMemo(
    () =>
      pins
        .map((on) => visible[indexOf.get(on) ?? -1])
        .filter((row): row is TimelineRow => row !== undefined),
    [pins, visible, indexOf],
  );

  const first = plotted.rows[0]?.t ?? 0;
  const last = plotted.rows.at(-1)?.t ?? 1;
  const axisTicks = useMemo(() => timeTicks(first, last), [first, last]);
  // Una barra se centra en su punto: sin medio intervalo de cada lado la
  // primera tapa el eje Y y la última queda cortada.
  const halfStep =
    hasBars && plotted.rows.length > 1
      ? (last - first) / (plotted.rows.length - 1) / 2
      : 0;
  const domainFirst = first - halfStep;
  const domainLast = last + halfStep;
  const config = useMemo(
    () =>
      Object.fromEntries(
        series.map((item) => [
          item.key,
          { label: item.label, color: item.color },
        ]),
      ) satisfies ChartConfig,
    [series],
  );

  const legend: LegendItem[] = [
    ...series.map((item) => ({
      key: item.key,
      label: item.label,
      color: item.color,
      shape:
        item.mark === "bar"
          ? ("square" as const)
          : item.mark === "dashed"
            ? ("dashed" as const)
            : ("line" as const),
    })),
    ...(band
      ? [
          {
            key: "band",
            label: band.label,
            color: band.color,
            shape: "band" as const,
          },
        ]
      : []),
  ];

  function describe(row: TimelineRow): string {
    const values = series
      .map(
        (item) =>
          `${item.label} ${formatValue(row.values[item.key] ?? null, item.format)}`,
      )
      .join(", ");
    const term = termOn(row.on);
    return `${periodLabel(row.on, resolution)}: ${values}${term ? `. Presidencia de ${term.president}` : ""}.`;
  }

  function pin(on: string) {
    setPins((current) =>
      current.length >= 2 || current.includes(on)
        ? [on]
        : [...current, on].sort(),
    );
  }

  function moveTo(index: number) {
    const row = visible[index];
    if (row === undefined) return;
    setActiveOn(row.on);
    setPointer(null);
    setAnnouncement(describe(row));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const count = visible.length;
    if (count === 0) return;
    const current = activeIndex ?? (latestIndex >= 0 ? latestIndex : count - 1);
    const step = event.shiftKey ? 10 : 1;
    switch (event.key) {
      case "ArrowLeft":
        moveTo(Math.max(0, current - step));
        break;
      case "ArrowRight":
        moveTo(Math.min(count - 1, current + step));
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(count - 1);
        break;
      case "Enter":
      case " ":
        if (!comparing) return;
        pin(visible[current]!.on);
        setAnnouncement(`Punto fijado: ${describe(visible[current]!)}`);
        break;
      case "Escape":
        setPins([]);
        setActiveOn(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /**
   * La fila más cercana al puntero, calculada desde su posición. El índice que
   * Recharts pasa al click es el de su último movimiento: un toque sin
   * arrastre fijaba el punto anterior, y un índice nulo, el primero.
   */
  function rowAt(
    clientX: number,
    element: HTMLElement,
  ): TimelineRow | undefined {
    const rows = plotted.rows;
    if (rows.length === 0) return undefined;
    const box = element.getBoundingClientRect();
    const width = box.width - Y_AXIS_WIDTH - PLOT_RIGHT;
    if (width <= 0) return undefined;
    const share = Math.min(
      1,
      Math.max(0, (clientX - box.left - Y_AXIS_WIDTH) / width),
    );
    const t = domainFirst + share * (domainLast - domainFirst);
    let low = 0;
    let high = rows.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (rows[middle]!.t < t) low = middle + 1;
      else high = middle;
    }
    if (low > 0 && t - rows[low - 1]!.t < rows[low]!.t - t) low -= 1;
    return visible[low];
  }

  function track(event: PointerEvent<HTMLDivElement>) {
    const row = rowAt(event.clientX, event.currentTarget);
    if (row === undefined) return;
    setActiveOn(row.on);
    const box = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - box.top;
    const touch = event.pointerType !== "mouse";
    setPointer((current) =>
      current?.y === y && current.touch === touch ? current : { y, touch },
    );
  }

  const yTicks = useMemo(
    () =>
      useLog
        ? logTicks(plotted.min, plotted.max)
        : hasBars || zeroLine
          ? linearTicks(Math.min(0, plotted.min), Math.max(0, plotted.max))
          : linearTicks(plotted.min, plotted.max),
    [useLog, hasBars, zeroLine, plotted],
  );
  const yDomain = useMemo(
    (): [number, number] =>
      useLog
        ? [plotted.min * 0.92, plotted.max * 1.08]
        : [yTicks[0] ?? 0, yTicks.at(-1) ?? 1],
    [useLog, plotted, yTicks],
  );

  // «De cierre de ene 2000 a cierre de…» se lee mejor con el mes solo; la
  // resolución ya está dicha en la barra.
  const compareResolution: Resolution =
    resolution === "month_end" ? "monthly" : resolution;

  const rangeOptions = offered.map((value) => ({
    value,
    label: RANGE_LABEL[value],
  }));
  const rangeFrom = plotted.rows.length ? visible[0]!.on : null;
  const termsInRange =
    rangeFrom && lastOn ? termsOverlapping(rangeFrom, lastOn) : [];
  const regimesInRange =
    rangeFrom && lastOn && context === undefined
      ? regimesOverlapping(rangeFrom, lastOn)
      : [];
  const contextSpansInRange =
    rangeFrom && lastOn && context
      ? overlapping(context.spans, rangeFrom, lastOn)
      : [];
  const contextEventsInRange =
    rangeFrom && lastOn && context
      ? context.events.filter(
          (event) => event.on >= rangeFrom && event.on <= lastOn,
        )
      : [];
  const marksInRange =
    regimesInRange.length +
    contextSpansInRange.length +
    contextEventsInRange.length;

  /** Lo que la franja y la etiqueta dicen del día, además del gobierno. */
  function contextOn(on: string): string[] {
    if (context === undefined) {
      return regimesOverlapping(on, on).map((regime) => regime.label);
    }
    const span = context.spans.find((item) => on >= item.from && on < item.to);
    const event = context.events.findLast((item) => item.on <= on);
    return [span?.label, event?.label].filter(
      (label): label is string => label !== undefined,
    );
  }

  const resolutionText =
    resolution === "daily"
      ? "Diario"
      : resolution === "month_end"
        ? "Cierre de cada mes"
        : resolution === "monthly"
          ? "Mensual"
          : "Anual";

  const drawnSpans = useMemo((): DrawnSpan[] => {
    if (rangeFrom === null || !lastOn) return [];
    if (context === undefined) {
      return regimesOverlapping(rangeFrom, lastOn).map((regime) => ({
        id: regime.id,
        label: regime.label,
        from: regime.from,
        to: regime.to,
        // El INDEC intervenido se superpone con el primer cepo: otro carril.
        lane: regime.id === "indec-intervention" ? 1 : 0,
        color:
          regime.id === "indec-intervention"
            ? "var(--chart-4)"
            : "var(--chart-3)",
      }));
    }
    return [
      ...overlapping(context.spans, rangeFrom, lastOn).map((span) => ({
        ...span,
        lane: 0 as const,
        color: "var(--chart-3)",
      })),
      ...overlapping(context.seasons, rangeFrom, lastOn).map((span) => ({
        ...span,
        lane: 1 as const,
        color: "var(--chart-2)",
      })),
    ];
  }, [context, rangeFrom, lastOn]);

  // El dibujo no depende del punto activo: la lectura va en su propia capa.
  const chart = useMemo(
    () => (
      <ChartContainer
        config={config}
        className={`aspect-auto ${HEIGHT[height]} w-full`}
        initialDimension={{ width: 640, height: 288 }}
      >
        <ComposedChart
          accessibilityLayer={false}
          data={plotted.rows as PlotRow[]}
          margin={{
            top: showMarks ? 40 : 8,
            right: PLOT_RIGHT,
            bottom: 0,
            left: 0,
          }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            domain={[domainFirst, domainLast]}
            ticks={axisTicks.ticks}
            tickFormatter={axisTicks.label}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            minTickGap={8}
            allowDuplicatedCategory={false}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={Y_AXIS_WIDTH}
            scale={useLog ? "log" : "linear"}
            domain={yDomain}
            allowDataOverflow={useLog}
            ticks={yTicks}
            tickFormatter={(value: number) => axisLabel(axis, value)}
          />
          {showMarks && plotted.rows.length > 1 ? (
            <MarksLayer
              fromOn={visible[0]!.on}
              toOn={dateOf(last)}
              spans={drawnSpans}
              events={context?.events ?? []}
            />
          ) : null}
          {zeroLine || hasBars ? (
            <ReferenceLine y={0} stroke="var(--muted-foreground)" />
          ) : null}
          {band ? (
            <Area
              dataKey="band"
              type="linear"
              stroke={band.color}
              strokeDasharray="3 2"
              strokeWidth={1}
              fill={band.color}
              fillOpacity={0.12}
              connectNulls={false}
              isAnimationActive={false}
              activeDot={false}
            />
          ) : null}
          {series.map((item) =>
            item.mark === "bar" ? (
              <Bar
                key={item.key}
                dataKey={item.key}
                fill={item.color}
                radius={1}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={item.key}
                dataKey={drawnKey(item.key)}
                type="linear"
                stroke={item.color}
                strokeWidth={item.mark === "dashed" ? 1.5 : 2}
                strokeDasharray={item.mark === "dashed" ? "4 3" : undefined}
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ),
          )}
          {pinned.map((row, index) => (
            <ReferenceLine
              key={row.on}
              x={dayNumber(row.on)}
              stroke="var(--primary)"
              strokeWidth={1.5}
              label={{
                value: index === 0 ? "A" : "B",
                position: "insideTopLeft",
                fill: "var(--primary)",
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          ))}
          <ActiveDots
            rows={plotted.rows}
            series={series}
            active={pinned.map((row) => indexOf.get(row.on) ?? -1)}
          />
          <PlotAreaProbe onChange={onPlot} />
        </ComposedChart>
      </ChartContainer>
    ),
    [
      config,
      height,
      plotted,
      showMarks,
      visible,
      last,
      zeroLine,
      hasBars,
      band,
      series,
      pinned,
      indexOf,
      axis,
      yDomain,
      yTicks,
      useLog,
      axisTicks,
      domainFirst,
      domainLast,
      onPlot,
      drawnSpans,
      context,
    ],
  );

  const hover = (() => {
    if (plot === null || activeIndex === undefined) return null;
    const row = plotted.rows[activeIndex]!;
    const entry = visible[activeIndex]!;
    const x = toPixel(
      row.t,
      [domainFirst, domainLast],
      [plot.x, plot.x + plot.width],
    );
    if (x === null) return null;
    const detail = [termOn(entry.on)?.label, ...contextOn(entry.on)]
      .filter((label): label is string => label !== undefined)
      .join(" · ");
    return (
      <HoverLayer
        plot={plot}
        x={x}
        title={periodLabel(entry.on, resolution)}
        detail={detail || undefined}
        pointerY={pointer?.y ?? null}
        touch={pointer?.touch ?? false}
        points={series.map((item) => {
          const value = row[item.key];
          const y =
            typeof value === "number"
              ? toPixel(value, yDomain, [plot.y + plot.height, plot.y], useLog)
              : null;
          return {
            key: item.key,
            label: item.label,
            color: item.color,
            y,
            value: formatValue(entry.values[item.key] ?? null, item.format),
            axisValue:
              typeof value === "number" ? axisReading(axis, value) : null,
          };
        })}
      />
    );
  })();

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ChartToolbar>
        {rangeOptions.length > 1 ? (
          <Segmented
            label="Período"
            options={rangeOptions}
            value={range}
            onChange={(value) => {
              setRange(value);
              setPins([]);
              setActiveOn(null);
            }}
          />
        ) : null}
        {allowLog ? (
          <span className="inline-flex items-center gap-0.5">
            <Segmented
              label="Escala"
              options={[
                { value: "linear", label: "Lineal" },
                {
                  value: "log",
                  label: "Log",
                  disabled: !logAvailable,
                },
              ]}
              value={useLog ? "log" : "linear"}
              onChange={(value) => setLogScale(value === "log")}
            />
            <InfoTip title="Escala logarítmica">
              <p>
                En escala logarítmica la misma distancia vertical es la misma
                variación porcentual: pasar de 10 a 20 ocupa lo mismo que de
                1.000 a 2.000. Sirve para comparar épocas cuando la serie se
                multiplicó muchas veces.
              </p>
              {logAvailable ? null : (
                <p>
                  No está disponible en este rango porque la serie tiene valores
                  en cero o negativos.
                </p>
              )}
            </InfoTip>
          </span>
        ) : null}
        <button
          type="button"
          aria-pressed={comparing}
          onClick={() => {
            setComparing((value) => !value);
            setPins([]);
          }}
          className={cn(
            "min-h-7 rounded-md border px-2 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
            comparing && "border-primary bg-primary/10 text-foreground",
          )}
        >
          Comparar dos puntos
        </button>
        <button
          type="button"
          aria-pressed={showMarks}
          onClick={() => setShowMarks((value) => !value)}
          className={cn(
            "min-h-7 rounded-md border px-2 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
            showMarks && "bg-muted text-foreground",
          )}
        >
          {context?.toggleLabel ?? "Gobiernos y regímenes"}
        </button>
        <span className="text-xs text-muted-foreground">{resolutionText}</span>
      </ChartToolbar>

      <div
        className="min-h-14 rounded-md border bg-muted/30 px-3 py-2 text-xs"
        aria-hidden="true"
      >
        {shown === undefined ? (
          <span className="text-muted-foreground">Sin datos en el rango.</span>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-foreground">
                {periodLabel(shown.on, resolution)}
              </span>
              <span className="text-muted-foreground">
                {activeIndex === undefined ? "último dato · " : ""}
                {termOn(shown.on)?.label ?? "antes de 1983"}
                {contextOn(shown.on)
                  .map((label) => ` · ${label}`)
                  .join("")}
              </span>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
              {series.map((item, index) => (
                <li key={item.key} className="flex items-center gap-1.5">
                  <Swatch item={legend[index]!} />
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="numeric font-medium text-foreground">
                    {formatValue(shown.values[item.key] ?? null, item.format)}
                  </span>
                </li>
              ))}
              {band &&
              shown.values[band.lowKey] != null &&
              shown.values[band.highKey] != null ? (
                <li className="flex items-center gap-1.5">
                  <Swatch item={legend.at(-1)!} />
                  <span className="text-muted-foreground">{band.label}</span>
                  <span className="numeric font-medium text-foreground">
                    {formatValue(shown.values[band.lowKey]!, band.format)} a{" "}
                    {formatValue(shown.values[band.highKey]!, band.format)}
                  </span>
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </div>

      <div
        role="group"
        tabIndex={0}
        aria-label={label}
        aria-describedby={instructionsId}
        onKeyDown={onKeyDown}
        onPointerMove={track}
        onPointerDown={track}
        onPointerLeave={(event) => {
          // Un toque deja la lectura donde quedó; el mouse que sale la suelta.
          if (event.pointerType === "mouse") setActiveOn(null);
        }}
        onClick={(event) => {
          const row = rowAt(event.clientX, event.currentTarget);
          if (row === undefined) return;
          setActiveOn(row.on);
          if (comparing) pin(row.on);
        }}
        className="touch-pan-y rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span id={instructionsId} className="sr-only">
          Flechas izquierda y derecha para recorrer los puntos, Mayúscula más
          flecha para saltar diez, Inicio y Fin para los extremos.
          {comparing ? " Enter fija un punto para comparar; Escape borra." : ""}
        </span>
        <div className="relative">
          {chart}
          {hover}
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      <ul
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        aria-hidden="true"
      >
        {legend.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <Swatch item={item} />
            {item.label}
          </li>
        ))}
      </ul>

      {comparing ? (
        <div
          className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs"
          aria-live="polite"
        >
          {pinned.length < 2 ? (
            <p className="text-muted-foreground">
              {pinned.length === 0
                ? "Tocá o hacé click en un punto para fijar el primero (A)."
                : `A: ${periodLabel(pinned[0]!.on, compareResolution)}. Ahora el segundo punto (B).`}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-foreground">
                  De {periodLabel(pinned[0]!.on, compareResolution)} (A) a{" "}
                  {periodLabel(pinned[1]!.on, compareResolution)} (B):{" "}
                  {elapsed(pinned[0]!.on, pinned[1]!.on)}
                </p>
                <button
                  type="button"
                  onClick={() => setPins([])}
                  className="inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <X aria-hidden="true" className="size-3.5" />
                  Borrar
                </button>
              </div>
              <ul className="flex flex-col gap-1">
                {series.map((item) => {
                  const a = pinned[0]!.values[item.key] ?? null;
                  const b = pinned[1]!.values[item.key] ?? null;
                  return (
                    <li
                      key={item.key}
                      className="flex flex-wrap items-baseline gap-x-2"
                    >
                      <span className="text-muted-foreground">
                        {item.label}:
                      </span>
                      <span className="numeric">
                        {formatValue(a, item.format)} →{" "}
                        {formatValue(b, item.format)}
                      </span>
                      <span className="numeric font-medium text-foreground">
                        {changeText(a, b, item)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-muted-foreground">{compareNote(series)}</p>
            </>
          )}
        </div>
      ) : null}

      {showTable ? (
        <details
          className="group border-t pt-3"
          onToggle={(event) => setTableOpen(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none"
            >
              ›
            </span>
            Ver los datos del período ({visible.length} filas)
          </summary>
          {tableOpen ? (
            <div
              role="region"
              aria-label={`${caption}, ${resolutionText.toLowerCase()}`}
              tabIndex={0}
              className="mt-3 max-h-96 overflow-auto rounded-md border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <Table>
                <TableCaption className="sr-only">
                  {caption}, {resolutionText.toLowerCase()}
                </TableCaption>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead scope="col">
                      {resolution === "daily"
                        ? "Día"
                        : resolution === "annual"
                          ? "Año"
                          : "Mes"}
                    </TableHead>
                    {series.map((item) => (
                      <TableHead
                        key={item.key}
                        scope="col"
                        className="text-right"
                      >
                        {item.label}
                      </TableHead>
                    ))}
                    {band ? (
                      <TableHead scope="col" className="text-right">
                        {band.label}
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...visible].reverse().map((row) => (
                    <TableRow key={row.on}>
                      <TableHead scope="row" className="font-normal">
                        {periodLabel(row.on, resolution)}
                      </TableHead>
                      {series.map((item) => (
                        <TableCell
                          key={item.key}
                          className="numeric text-right"
                        >
                          {formatValue(
                            row.values[item.key] ?? null,
                            item.format,
                          )}
                        </TableCell>
                      ))}
                      {band ? (
                        <TableCell className="numeric text-right">
                          {row.values[band.lowKey] != null &&
                          row.values[band.highKey] != null
                            ? `${formatValue(row.values[band.lowKey]!, band.format)} a ${formatValue(row.values[band.highKey]!, band.format)}`
                            : "—"}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </details>
      ) : null}

      {termsInRange.length + marksInRange === 0 ? null : (
        <Fold
          summary={`${context?.toggleLabel ?? "Gobiernos y regímenes"} en el período (${termsInRange.length + marksInRange})`}
        >
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <ul className="flex flex-col gap-1">
              {termsInRange.map((term) => (
                <li key={term.id}>
                  <span className="text-foreground">{term.president}</span>:{" "}
                  {calendarDate(term.from)} a{" "}
                  {term.to ? calendarDate(term.to) : "hoy"}
                </li>
              ))}
            </ul>
            <ul className="flex flex-col gap-1">
              {regimesInRange.map((regime) => (
                <li key={regime.id}>
                  <span className="text-foreground">{regime.label}</span> (
                  {calendarDate(regime.from)} a{" "}
                  {regime.to ? calendarDate(regime.to) : "hoy"}):{" "}
                  {regime.description} Fuente: {regime.source}.
                </li>
              ))}
            </ul>
            {context ? (
              <>
                {contextSpansInRange.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <p className="font-medium text-foreground">
                      {context.spansTitle}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {contextSpansInRange.map((span) => (
                        <li key={span.id}>
                          <span className="text-foreground">{span.label}</span>{" "}
                          ({calendarDate(span.from)} a{" "}
                          {calendarDate(lastDayOf(span.to))}):{" "}
                          {span.description} Fuente: {span.source}.
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {contextEventsInRange.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <p className="font-medium text-foreground">
                      {context.eventsTitle}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {contextEventsInRange.map((event) => (
                        <li key={event.id}>
                          <span className="text-foreground">{event.label}</span>{" "}
                          ({calendarDate(event.on)}): {event.description}{" "}
                          Fuente: {event.source}.
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p>{context.seasonNote}</p>
              </>
            ) : null}
            <p className="text-xs">
              {context ? `${context.note} ` : ""}
              Presidencias: {PRESIDENTIAL_TERMS_SOURCE}. Las marcas ubican
              fechas; no atribuyen a un gobierno o a un régimen lo que hizo la
              serie (<code className="text-xs">argentina-timeline-1.0.0</code>
              ).
            </p>
          </div>
        </Fold>
      )}
    </div>
  );
}
