import type {
  CedearMark,
  ReferenceQuadrant,
  SectorRiskMatrix,
  SectorRiskPoint,
} from "@/modules/metrics/domain/sector-risk-matrix";
import type { SortinoResult } from "@/modules/metrics/domain/sortino";
import { formatAmount } from "@/modules/valuation/domain/display-format";

/**
 * Geometría de la matriz de riesgo: qué se dibuja, dónde y con qué etiqueta.
 *
 * Es presentación pura. Los valores exactos viajan como decimales canónicos en
 * la matriz; acá se convierten a número sólo para ubicar un punto en pantalla, y
 * el valor que se **lee** —tabla, panel, nombre accesible— sale siempre del
 * decimal, nunca de la coordenada.
 */

/** Cuántos rangos intercuartiles alrededor de la mediana cubre el dominio. */
export const ROBUST_DOMAIN_IQR = 4;
const DOMAIN_PADDING = 0.08;

export type Clip = -1 | 0 | 1;

export type PlotPoint = {
  readonly id: string;
  readonly kind: "security" | "reference";
  readonly label: string;
  /** Coordenadas de dibujo, ya recortadas al dominio. */
  readonly x: number;
  readonly y: number;
  /** Valores exactos, para leer. */
  readonly rawX: string;
  readonly rawY: string;
  /** -1 o 1 si el valor real cae fuera del dominio de ese lado. */
  readonly clipX: Clip;
  readonly clipY: Clip;
  readonly cedear: boolean;
  readonly quadrant: ReferenceQuadrant | null;
};

export type NotDrawn = {
  readonly id: string;
  readonly label: string;
  readonly window2y: SortinoResult;
  readonly window5y: SortinoResult;
};

export type MatrixLayout = {
  readonly points: readonly PlotPoint[];
  readonly reference: PlotPoint | null;
  readonly domainX: readonly [number, number];
  readonly domainY: readonly [number, number];
  readonly ticksX: readonly number[];
  readonly ticksY: readonly number[];
  /** Tramo de la recta dentro del área del gráfico; `null` si no hay recta. */
  readonly fitSegment:
    | readonly [
        { readonly x: number; readonly y: number },
        { readonly x: number; readonly y: number },
      ]
    | null;
  readonly notDrawn: readonly NotDrawn[];
};

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;

  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/**
 * Dominio que cubre el grueso del sector: mediana ± 4 rangos intercuartiles,
 * nunca más allá de los valores observados. La referencia siempre entra, porque
 * es el cruce que divide los cuadrantes. Un punto fuera se dibuja en el borde.
 */
export function robustDomain(
  values: readonly number[],
  mustInclude: readonly number[] = [],
): readonly [number, number] {
  const all = [...values, ...mustInclude];

  if (all.length === 0) {
    return [-1, 1];
  }

  const sorted = [...values].sort((left, right) => left - right);
  let low = Math.min(...all);
  let high = Math.max(...all);

  if (sorted.length >= 4) {
    const median = quantile(sorted, 0.5);
    const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);

    if (iqr > 0) {
      low = Math.max(low, median - ROBUST_DOMAIN_IQR * iqr);
      high = Math.min(high, median + ROBUST_DOMAIN_IQR * iqr);
    }
  }

  for (const value of mustInclude) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }

  const span = high - low;

  if (span === 0) {
    return [low - 1, high + 1];
  }

  return [low - span * DOMAIN_PADDING, high + span * DOMAIN_PADDING];
}

function clip(value: number, [low, high]: readonly [number, number]) {
  if (value < low) {
    return { value: low, clip: -1 as Clip };
  }

  return value > high
    ? { value: high, clip: 1 as Clip }
    : { value, clip: 0 as Clip };
}

function computed(result: SortinoResult): string | null {
  return result.status === "computed" ? result.value : null;
}

export function hasCedear(mark: CedearMark): boolean {
  return mark.status === "program";
}

export function pointLabel(point: SectorRiskPoint): string {
  return point.ticker ?? "Sin ticker";
}

/** Tramo visible de `y = a + b·x` dentro del rectángulo del gráfico. */
export function clipLine(
  slope: number,
  intercept: number,
  domainX: readonly [number, number],
  domainY: readonly [number, number],
) {
  const candidates: { x: number; y: number }[] = [];
  const [x0, x1] = domainX;
  const [y0, y1] = domainY;
  const inY = (y: number) => y >= y0 - 1e-12 && y <= y1 + 1e-12;
  const inX = (x: number) => x >= x0 - 1e-12 && x <= x1 + 1e-12;

  for (const x of [x0, x1]) {
    const y = intercept + slope * x;

    if (inY(y)) {
      candidates.push({ x, y });
    }
  }

  if (slope !== 0) {
    for (const y of [y0, y1]) {
      const x = (y - intercept) / slope;

      if (inX(x)) {
        candidates.push({ x, y });
      }
    }
  }

  const unique = candidates
    .sort((left, right) => left.x - right.x)
    .filter(
      (candidate, index, list) =>
        index === 0 ||
        Math.abs(candidate.x - list[index - 1]!.x) > 1e-12 ||
        Math.abs(candidate.y - list[index - 1]!.y) > 1e-12,
    );

  return unique.length < 2 ? null : ([unique[0]!, unique.at(-1)!] as const);
}

export function layoutMatrix(matrix: SectorRiskMatrix): MatrixLayout {
  const drawable = matrix.points.filter(
    (point) =>
      point.sortino2y.status === "computed" &&
      point.sortino5y.status === "computed",
  );
  const referenceX = computed(matrix.reference.sortino2y);
  const referenceY = computed(matrix.reference.sortino5y);
  const hasReference = referenceX !== null && referenceY !== null;

  const axisX = niceAxis(
    robustDomain(
      drawable.map((point) => Number(computed(point.sortino2y))),
      hasReference ? [Number(referenceX)] : [],
    ),
  );
  const axisY = niceAxis(
    robustDomain(
      drawable.map((point) => Number(computed(point.sortino5y))),
      hasReference ? [Number(referenceY)] : [],
    ),
  );
  const domainX = axisX.domain;
  const domainY = axisY.domain;

  const points = drawable.map((point): PlotPoint => {
    const rawX = computed(point.sortino2y)!;
    const rawY = computed(point.sortino5y)!;
    const x = clip(Number(rawX), domainX);
    const y = clip(Number(rawY), domainY);

    return {
      id: point.securityId,
      kind: "security",
      label: pointLabel(point),
      x: x.value,
      y: y.value,
      rawX,
      rawY,
      clipX: x.clip,
      clipY: y.clip,
      cedear: hasCedear(point.cedear),
      quadrant: point.quadrant,
    };
  });

  const fit =
    matrix.fit.status === "computed"
      ? clipLine(
          Number(matrix.fit.slope),
          Number(matrix.fit.intercept),
          domainX,
          domainY,
        )
      : null;

  return {
    points,
    reference: hasReference
      ? {
          id: matrix.reference.benchmarkId,
          kind: "reference",
          label: "S&P 500 TR",
          x: Number(referenceX),
          y: Number(referenceY),
          rawX: referenceX,
          rawY: referenceY,
          clipX: 0,
          clipY: 0,
          cedear: false,
          quadrant: null,
        }
      : null,
    domainX,
    domainY,
    ticksX: axisX.ticks,
    ticksY: axisY.ticks,
    fitSegment: fit,
    notDrawn: matrix.points
      .filter((point) => !drawable.includes(point))
      .map((point) => ({
        id: point.securityId,
        label: pointLabel(point),
        window2y: point.sortino2y,
        window5y: point.sortino5y,
      })),
  };
}

/** Radio de la marca con logo: 24 px de diámetro, el área de toque de `UI-02`. */
export const LOGO_MARK_RADIUS = 12;
/** Radio de la marca sin logo, el punto de siempre, con su borde. */
export const DOT_MARK_RADIUS = 5;
/** Cuánto puede tapar un logo a otro, como fracción del área del círculo. */
export const LOGO_MAX_OVERLAP = 0.3;

type PlotArea = {
  readonly width: number;
  readonly height: number;
  readonly domainX: readonly [number, number];
  readonly domainY: readonly [number, number];
};

function toPixel(
  point: { readonly x: number; readonly y: number },
  plot: PlotArea,
) {
  return {
    px:
      ((point.x - plot.domainX[0]) / (plot.domainX[1] - plot.domainX[0])) *
      plot.width,
    py:
      ((plot.domainY[1] - point.y) / (plot.domainY[1] - plot.domainY[0])) *
      plot.height,
  };
}

/** Fracción del área de un círculo de radio `radius` que tapa otro igual. */
export function circleOverlap(radius: number, distance: number): number {
  if (distance >= 2 * radius) {
    return 0;
  }

  const lens =
    2 * radius * radius * Math.acos(distance / (2 * radius)) -
    (distance / 2) * Math.sqrt(4 * radius * radius - distance * distance);

  return lens / (Math.PI * radius * radius);
}

/**
 * Qué marcas llevan logo (`F6-27`). Un logo de 24 px tapa a sus vecinos en
 * los sectores densos, y agrandar el gráfico casi no ayuda: medido sobre
 * Information Technology, 21 de 71 marcas se pisaban aun con 704 px de alto,
 * porque los grupos densos están casi encima.
 *
 * Se reparten de a una: primero las que tienen CEDEAR, después el resto por
 * ticker, y una marca lleva logo sólo si no tapa más de `LOGO_MAX_OVERLAP` de
 * un logo ya puesto ni del rombo de la referencia, y si no toca el rótulo
 * «S&P 500 TR». Las demás quedan como punto y muestran su logo al
 * seleccionarlas.
 */
const REFERENCE_CAPTION = "S&P 500 TR";

/**
 * El rótulo de la referencia es texto sin placa (`F6-28`): la placa sólida de
 * `F6-27` tapaba puntos del sector. Cambia de lado si el cruce está cerca del
 * borde.
 */
export function referenceCaptionBox(
  reference: PlotPoint,
  plot: PlotArea,
  measure: (text: string) => number | undefined,
): Box {
  const { px, py } = toPixel(reference, plot);
  const width = measure(REFERENCE_CAPTION) ?? REFERENCE_CAPTION.length * 8;

  const x0 = px + 15 + width <= plot.width ? px + 15 : px - 15 - width;
  const y0 = py >= 22 ? py - 22 : py + 8;

  return { x0, y0, x1: x0 + width, y1: y0 + 14 };
}

function circleTouchesBox(
  center: { readonly px: number; readonly py: number },
  radius: number,
  box: Box,
): boolean {
  const nearestX = Math.min(Math.max(center.px, box.x0), box.x1);
  const nearestY = Math.min(Math.max(center.py, box.y0), box.y1);

  return Math.hypot(center.px - nearestX, center.py - nearestY) < radius;
}

export function placeLogoMarks(
  points: readonly PlotPoint[],
  plot: PlotArea,
  reference: PlotPoint | null = null,
  /** Ancho real del texto, medido en el navegador; sin él, se estima. */
  measure: (text: string) => number | undefined = () => undefined,
): ReadonlySet<string> {
  const ordered = [...points].sort(
    (left, right) =>
      Number(right.cedear) - Number(left.cedear) ||
      left.label.localeCompare(right.label) ||
      left.id.localeCompare(right.id),
  );
  const taken = reference === null ? [] : [toPixel(reference, plot)];
  const caption =
    reference === null ? null : referenceCaptionBox(reference, plot, measure);
  const withLogo = new Set<string>();

  for (const point of ordered) {
    const at = toPixel(point, plot);
    const free =
      (caption === null || !circleTouchesBox(at, LOGO_MARK_RADIUS, caption)) &&
      (reference === null ||
        Math.hypot(at.px - taken[0]!.px, at.py - taken[0]!.py) >=
          LOGO_MARK_RADIUS + 12) &&
      taken.every(
        (other) =>
          circleOverlap(
            LOGO_MARK_RADIUS,
            Math.hypot(other.px - at.px, other.py - at.py),
          ) <= LOGO_MAX_OVERLAP,
      );

    if (free) {
      taken.push(at);
      withLogo.add(point.id);
    }
  }

  return withLogo;
}

export type LabelSide =
  | "right"
  | "left"
  | "above"
  | "below"
  | "above-right"
  | "below-right"
  | "above-left"
  | "below-left";

const SIDES: readonly LabelSide[] = [
  "right",
  "left",
  "above",
  "below",
  "above-right",
  "below-right",
  "above-left",
  "below-left",
];

export type LabelGroup = {
  /** Punto donde se ancla la etiqueta. */
  readonly anchorId: string;
  readonly memberIds: readonly string[];
  readonly text: string;
  /** Lado del punto donde va la etiqueta, elegido para no chocar. */
  readonly side: LabelSide;
  /** Caja verificada sin choques: el texto se escribe adentro. */
  readonly box: Box;
};

export type Box = {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
};

const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Ubica una etiqueta por punto sin superponerlas, en dos pasos:
 *
 * 1. Los puntos que se tapan entre sí —GOOG y GOOGL, FOX y FOXA— forman un
 *    solo grupo con una sola etiqueta, que el panel abre al enfocar.
 * 2. Cada grupo prueba ocho lados y toma el primero libre dentro del área.
 *    Si ninguno sirve, se suma al rótulo cercano sólo cuando el texto nuevo
 *    también entra sin choque. Si no, queda identificable en tabla y foco.
 *
 * Cada marca ocupa su radio (`markRadius`): una con logo empuja su rótulo
 * más lejos y ningún rótulo se escribe encima de un logo.
 */
export function groupLabels(
  points: readonly PlotPoint[],
  plot: {
    readonly width: number;
    readonly height: number;
    readonly domainX: readonly [number, number];
    readonly domainY: readonly [number, number];
  },
  metrics: {
    readonly charWidth: number;
    readonly lineHeight: number;
    readonly gap: number;
    readonly overlap: number;
    /** Ancho real del texto, medido en el navegador; sin él, se estima. */
    readonly measure?: (text: string) => number | undefined;
  } = { charWidth: 8, lineHeight: 16, gap: 8, overlap: 10 },
  /** La referencia y su rótulo: ocupan lugar aunque no lleven etiqueta propia. */
  reference: PlotPoint | null = null,
  /** Radio de la marca de cada punto; sin él, todas son el punto de siempre. */
  markRadius: (id: string) => number = () => DOT_MARK_RADIUS,
): readonly LabelGroup[] {
  const pixel = new Map(
    points.map((point) => [point.id, toPixel(point, plot)]),
  );
  const textWidth = (text: string) =>
    metrics.measure?.(text) ?? text.length * metrics.charWidth;
  const ordered = [...points].sort((left, right) =>
    left.label.localeCompare(right.label),
  );

  // 1. Puntos que se superponen.
  const clusters: PlotPoint[][] = [];

  for (const point of ordered) {
    const at = pixel.get(point.id)!;
    const cluster = clusters.find((members) => {
      const anchor = pixel.get(members[0]!.id)!;

      return Math.hypot(anchor.px - at.px, anchor.py - at.py) < metrics.overlap;
    });

    if (cluster === undefined) {
      clusters.push([point]);
    } else {
      cluster.push(point);
    }
  }

  // El grupo de cada ancla, para que su rótulo esquive la marca de todos.
  const groupOf = new Map<string, readonly string[]>(
    clusters.map((members) => [
      members[0]!.id,
      members.map((member) => member.id),
    ]),
  );

  const textOf = (labels: readonly string[]) =>
    labels.length === 1
      ? labels[0]!
      : labels.length === 2
        ? `${labels[0]} · ${labels[1]}`
        : `${labels[0]} +${labels.length - 1}`;

  const boxFor = (id: string, text: string, side: LabelSide): Box => {
    const { px, py } = pixel.get(id)!;
    const width = textWidth(text);
    const half = metrics.lineHeight / 2;
    // Lo que la marca crece sobre el punto de siempre corre el rótulo igual.
    // En un grupo cuenta la marca más grande, a su distancia del ancla: GOOG
    // ancla el rótulo como punto y GOOGL, a 2 px, lleva el logo.
    const reach = Math.max(
      ...(groupOf.get(id) ?? [id]).map((member) => {
        const at = pixel.get(member)!;

        return markRadius(member) + Math.hypot(at.px - px, at.py - py);
      }),
    );
    const grow = Math.max(0, reach - DOT_MARK_RADIUS);
    // La insignia CEDEAR sobresale del círculo: 3 px más de aire.
    const gap = metrics.gap + grow + (grow > 0 ? 3 : 0);
    const diagonal = 4 + Math.round(grow * 0.75);

    switch (side) {
      case "right":
        return {
          x0: px + gap,
          y0: py - half,
          x1: px + gap + width,
          y1: py + half,
        };
      case "left":
        return {
          x0: px - gap - width,
          y0: py - half,
          x1: px - gap,
          y1: py + half,
        };
      case "above":
        return {
          x0: px - width / 2,
          y0: py - gap - metrics.lineHeight,
          x1: px + width / 2,
          y1: py - gap,
        };
      case "below":
        return {
          x0: px - width / 2,
          y0: py + gap,
          x1: px + width / 2,
          y1: py + gap + metrics.lineHeight,
        };
      case "above-right":
        return {
          x0: px + diagonal,
          y0: py - diagonal - metrics.lineHeight,
          x1: px + diagonal + width,
          y1: py - diagonal,
        };
      case "below-right":
        return {
          x0: px + diagonal,
          y0: py + diagonal,
          x1: px + diagonal + width,
          y1: py + diagonal + metrics.lineHeight,
        };
      case "above-left":
        return {
          x0: px - diagonal - width,
          y0: py - diagonal - metrics.lineHeight,
          x1: px - diagonal,
          y1: py - diagonal,
        };
      case "below-left":
        return {
          x0: px - diagonal - width,
          y0: py + diagonal,
          x1: px - diagonal,
          y1: py + diagonal + metrics.lineHeight,
        };
    }
  };
  const inside = (box: Box) =>
    box.x0 >= 0 && box.x1 <= plot.width && box.y0 >= 0 && box.y1 <= plot.height;

  // Cada punto ocupa su lugar: una etiqueta no se escribe encima de otro punto.
  const pointBoxes: Box[] = points.map((point) => {
    const { px, py } = pixel.get(point.id)!;
    const radius = markRadius(point.id);

    return {
      x0: px - radius,
      y0: py - radius,
      x1: px + radius,
      y1: py + radius,
    };
  });
  const reserved: Box[] = [];

  if (reference !== null) {
    const { px, py } = toPixel(reference, plot);

    // El rombo y su rótulo.
    reserved.push({ x0: px - 12, y0: py - 12, x1: px + 12, y1: py + 12 });
    reserved.push(referenceCaptionBox(reference, plot, textWidth));
  }

  // 2. Una etiqueta por grupo, en el primer lado libre.
  const placed: {
    ids: string[];
    labels: string[];
    side: LabelSide;
    box: Box;
  }[] = [];

  for (const cluster of clusters) {
    const anchorId = cluster[0]!.id;
    const labels = cluster.map((point) => point.label);
    const text = textOf(labels);
    const own = new Set(cluster.map((point) => point.id));
    const others = pointBoxes.filter((_, index) => !own.has(points[index]!.id));
    const side = SIDES.find((candidate) => {
      const box = boxFor(anchorId, text, candidate);

      return (
        inside(box) &&
        !placed.some((group) => overlaps(group.box, box)) &&
        !reserved.some((other) => overlaps(other, box)) &&
        !others.some((other) => overlaps(other, box))
      );
    });

    if (side !== undefined) {
      placed.push({
        ids: cluster.map((point) => point.id),
        labels,
        side,
        box: boxFor(anchorId, text, side),
      });
      continue;
    }

    // Sin lugar libre: se suma al grupo **más cercano**, nunca a uno lejano,
    // para que «+n» hable de puntos que están al lado.
    const anchor = pixel.get(anchorId)!;
    const blocking = placed.reduce<(typeof placed)[number] | undefined>(
      (nearest, group) => {
        const at = pixel.get(group.ids[0]!)!;
        const distance = Math.hypot(at.px - anchor.px, at.py - anchor.py);

        if (nearest === undefined) {
          return group;
        }

        const best = pixel.get(nearest.ids[0]!)!;

        return distance < Math.hypot(best.px - anchor.px, best.py - anchor.py)
          ? group
          : nearest;
      },
      undefined,
    );

    if (blocking !== undefined) {
      // El rótulo fusionado es más largo: su caja vieja ya no lo contiene.
      // Vuelve a buscar lado con el texto nuevo, sin contarse a sí mismo.
      const mergedIds = [...blocking.ids, ...cluster.map((point) => point.id)];
      const mergedLabels = [...blocking.labels, ...labels];
      const merged = textOf(mergedLabels);
      const members = new Set(mergedIds);
      const rest = placed.filter((group) => group !== blocking);
      const strangers = pointBoxes.filter(
        (_, index) => !members.has(points[index]!.id),
      );
      const reSide = SIDES.find((candidate) => {
        const box = boxFor(blocking.ids[0]!, merged, candidate);

        return (
          inside(box) &&
          !rest.some((group) => overlaps(group.box, box)) &&
          !reserved.some((other) => overlaps(other, box)) &&
          !strangers.some((other) => overlaps(other, box))
        );
      });

      if (reSide !== undefined) {
        blocking.ids = mergedIds;
        blocking.labels = mergedLabels;
        blocking.side = reSide;
        blocking.box = boxFor(blocking.ids[0]!, merged, reSide);
      }
    }
  }

  return placed.map((group) => ({
    anchorId: group.ids[0]!,
    memberIds: group.ids,
    text: textOf(group.labels),
    side: group.side,
    box: group.box,
  }));
}

/**
 * Dominio redondeado a un paso limpio y sus ticks: `-2 · -1 · 0 · 1 · 2 · 3`
 * y no `-2,0 · 0,0 · 2,0 · 3,2`. El paso sale del rango, para que haya entre
 * cuatro y ocho marcas.
 */
export function niceAxis(domain: readonly [number, number]): {
  readonly domain: readonly [number, number];
  readonly ticks: readonly number[];
} {
  const span = domain[1] - domain[0];
  const step =
    [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10].find(
      (candidate) => span / candidate <= 8,
    ) ?? Math.ceil(span / 8);
  const low = Math.floor(domain[0] / step) * step;
  const high = Math.ceil(domain[1] / step) * step;
  const ticks: number[] = [];

  for (let tick = low; tick <= high + step / 2; tick += step) {
    ticks.push(Math.round(tick * 1000) / 1000);
  }

  return { domain: [low, high], ticks };
}

export const QUADRANT_LABELS: Record<ReferenceQuadrant, string> = {
  beats_both: "Supera a la referencia en las dos ventanas",
  beats_2y_only: "Supera a la referencia sólo a 2 años",
  beats_5y_only: "Supera a la referencia sólo a 5 años",
  beats_neither: "No supera a la referencia en ninguna ventana",
};

export const NULL_REASON_LABELS: Record<string, string> = {
  insufficient_history: "Historia insuficiente",
  no_close_at_as_of: "Sin cierre en la fecha",
  missing_period: "Hueco en la serie",
  no_downside_observations: "Sin retornos a la baja",
  currency_mismatch: "Moneda distinta",
  non_positive_close: "Cierre en cero",
};

export function formatSortino(result: SortinoResult): string {
  return result.status === "computed"
    ? formatAmount(result.value, { scale: 2 })
    : (NULL_REASON_LABELS[result.reason] ?? result.reason);
}

/** Un ratio es exacto: se muestra con los decimales que tiene, sin redondear. */
function exactDecimal(value: string): string {
  return value.replace(".", ",");
}

export function describeCedear(mark: CedearMark): string {
  if (mark.status === "none_known") {
    return mark.reason === "not_effective_at_cutoff"
      ? "Sin programa vigente a la fecha"
      : "Sin CEDEAR";
  }

  const ratio =
    mark.ratio === null
      ? "ratio desconocido"
      : `${exactDecimal(mark.ratio.depositaryUnits)}:${exactDecimal(mark.ratio.underlyingUnits)}`;

  return mark.programStatus === "active"
    ? `CEDEAR ${ratio}`
    : `CEDEAR ${ratio} (${mark.programStatus === "suspended" ? "suspendido" : "no activo"})`;
}

/** Nombre accesible de un punto: todo lo que el tooltip diría, en una frase. */
export function describePoint(point: SectorRiskPoint): string {
  const parts = [
    `${pointLabel(point)}${point.issuerName === null ? "" : `, ${point.issuerName}`}`,
    `Sortino 2 años ${formatSortino(point.sortino2y)}`,
    `5 años ${formatSortino(point.sortino5y)}`,
    describeCedear(point.cedear),
  ];

  if (point.quadrant !== null) {
    parts.push(QUADRANT_LABELS[point.quadrant]);
  }

  return parts.join("; ");
}
