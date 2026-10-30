import type {
  DivergenceHorizon,
  SectorDivergenceRow,
} from "@/modules/divergences/application/sector-divergence-matrix";
import type {
  DivergenceView,
  GrowthReason,
  ViewCategory,
} from "@/modules/divergences/domain/divergence-views";
import { formatSignedAmount } from "@/modules/valuation/domain/display-format";

import {
  niceAxis,
  robustDomain,
  type MatrixLayout,
  type PlotPoint,
} from "../../_components/matrix-layout";

/**
 * Geometría de la matriz de divergencias. Igual que la de riesgo, es
 * presentación pura: el número que se lee sale del decimal, nunca de la
 * coordenada. Los dos ejes comparten dominio, porque la diagonal `y = x` sólo
 * se lee a 45° si un punto porcentual mide lo mismo en los dos.
 */

export type HorizonKey = "twoYears" | "fiveYears";
export type ViewKey = "fundamental" | "aggregate" | "perShare";

export const VIEWS: Record<
  ViewKey,
  { readonly label: string; readonly x: string; readonly y: string }
> = {
  fundamental: {
    label: "Market cap vs EPS",
    x: "Market cap CAGR",
    y: "Diluted EPS CAGR",
  },
  aggregate: {
    label: "Market cap vs net income",
    x: "Market cap CAGR",
    y: "Net income CAGR",
  },
  perShare: {
    label: "Precio vs EPS",
    x: "Price CAGR",
    y: "Diluted EPS CAGR",
  },
};

export const CATEGORY_LABELS: Record<
  Exclude<ViewCategory, "comparable" | "unavailable">,
  string
> = {
  earnings_turned_positive: "Pasó a ganancia",
  earnings_turned_non_positive: "Pasó a pérdida",
  earnings_non_positive: "Pérdida en ambas",
};

export const MISSING_LABELS: Record<string, string> = {
  no_fiscal_year: "Sin ejercicio fiscal guardado",
  no_comparable_year: "Sin ejercicio comparable",
  price_near_fiscal_close: "Sin precio cerca del cierre fiscal",
  net_income: "Sin net income",
  diluted_eps: "Sin EPS diluido",
  diluted_shares: "Sin acciones diluidas",
  shares_outstanding_at_close: "Sin acciones al cierre",
  split_evidence_missing_or_ambiguous: "Split sin confirmación SEC",
  split_subject_unreconciled: "Split de otro emisor de reporte",
  multiple_share_classes_unreconciled: "Varias clases sin reconciliar",
  market_cap_split_basis_unreconciled: "Market cap sin base de splits",
  market_cap_unit_or_currency_mismatch: "Unidad o moneda distinta",
  market_cap_non_positive_input: "Precio o acciones no positivos",
};

export const GROWTH_REASON_LABELS: Record<GrowthReason, string> = {
  no_comparable_year: "sin ejercicio comparable",
  missing_input: "falta un dato",
  split_basis_unreconciled: "split sin reconciliar",
  non_positive_endpoint: "punta no positiva",
};

export function rowLabel(row: SectorDivergenceRow): string {
  return row.ticker ?? "Sin ticker";
}

/** Puntos porcentuales con signo y un decimal: `+10,2`, `−3,3`. */
export function formatPp(value: string | null): string {
  return value === null ? "—" : formatSignedAmount(value, { scale: 1 });
}

export function formatPct(value: string | null): string {
  return value === null ? "—" : `${formatPp(value)} %`;
}

/**
 * Lo que la vista no puede dibujar, en un solo motivo legible. Los beneficios
 * no positivos no van acá: tienen su propio panel.
 */
export function unavailableReason(
  horizon: DivergenceHorizon,
  view: DivergenceView,
): string {
  if (horizon.pairReason !== null)
    return MISSING_LABELS[horizon.pairReason] ?? horizon.pairReason;
  const named = horizon.missing
    .map((code) => MISSING_LABELS[code])
    .filter((label): label is string => label !== undefined);
  if (named.length > 0) return [...new Set(named)].join(" · ");
  const reason = view.x.reason ?? view.y.reason;
  return reason === null ? "Sin tasa comparable" : GROWTH_REASON_LABELS[reason];
}

function clip(value: number, [low, high]: readonly [number, number]) {
  if (value < low) return { value: low, clip: -1 as const };
  return value > high
    ? { value: high, clip: 1 as const }
    : { value, clip: 0 as const };
}

export type DivergenceLayout = MatrixLayout & {
  /** Tramo de `y = x` dentro del cuadrado del gráfico. */
  readonly diagonal: readonly [
    { readonly x: number; readonly y: number },
    { readonly x: number; readonly y: number },
  ];
};

export function layoutDivergence(
  rows: readonly SectorDivergenceRow[],
  horizon: HorizonKey,
  view: ViewKey,
): DivergenceLayout {
  const drawable = rows.filter(
    (row) => row[horizon].views[view].category === "comparable",
  );
  const xs = drawable.map((row) => Number(row[horizon].views[view].x.value));
  const ys = drawable.map((row) => Number(row[horizon].views[view].y.value));
  // Un solo dominio: el robusto de cada eje, unido, y siempre con el cero.
  const domainX = robustDomain(xs, [0]);
  const domainY = robustDomain(ys, [0]);
  const axis = niceAxis([
    Math.min(domainX[0], domainY[0]),
    Math.max(domainX[1], domainY[1]),
  ]);
  const domain = axis.domain;

  const points = drawable.map((row): PlotPoint => {
    const values = row[horizon].views[view];
    const rawX = values.x.value!;
    const rawY = values.y.value!;
    const x = clip(Number(rawX), domain);
    const y = clip(Number(rawY), domain);
    return {
      id: row.securityId,
      kind: "security",
      label: rowLabel(row),
      x: x.value,
      y: y.value,
      rawX,
      rawY,
      clipX: x.clip,
      clipY: y.clip,
      cedear: row.cedear,
      quadrant: null,
    };
  });

  return {
    points,
    reference: null,
    domainX: domain,
    domainY: domain,
    ticksX: axis.ticks,
    ticksY: axis.ticks,
    fitSegment: null,
    notDrawn: [],
    diagonal: [
      { x: domain[0], y: domain[0] },
      { x: domain[1], y: domain[1] },
    ],
  };
}

/** Nombre accesible de un punto: lo que el panel diría, en una frase. */
export function describeDivergencePoint(
  row: SectorDivergenceRow,
  horizon: HorizonKey,
  view: ViewKey,
): string {
  const values = row[horizon].views[view];
  const names = VIEWS[view];
  const parts = [
    `${rowLabel(row)}${row.issuerName === null ? "" : `, ${row.issuerName}`}`,
    `${names.y} ${formatPct(values.y.value)} por año`,
    `${names.x} ${formatPct(values.x.value)} por año`,
    `brecha ${formatPp(values.gapPp)} puntos`,
  ];
  if (view === "fundamental") {
    const fundamental = row[horizon].views.fundamental;
    parts.push(
      `sesgo por acciones ${formatPp(fundamental.shareCountBiasPp)} puntos${fundamental.biasMarked ? ", supera la tolerancia" : ""}`,
    );
  }
  parts.push(row.cedear ? "con CEDEAR" : "sin CEDEAR");
  return parts.join("; ");
}
