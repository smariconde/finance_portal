import { z } from "zod";

import { SORTINO_FORMULA_VERSION, SORTINO_PARAMETERS } from "./sortino";

/**
 * Catálogo de métricas, acotado a lo que usan las matrices sectoriales
 * ([ADR 0016](../../../../docs/architecture/adr/0016-analysis-scope-sector-matrices.md)):
 * no hay screener, así que no hay una métrica que exista "por si acaso".
 *
 * Una entrada dice qué pregunta responde la métrica, con qué fórmula versionada
 * y qué hace con los casos que no dan número. Las de divergencias están
 * `planned`: su definición la fija la ADR 0016 §5 y su fórmula se escribe en
 * `F8-01`, así que el catálogo las nombra para que la matriz de riesgo y la de
 * divergencias no inventen dos vocabularios, pero no finge que se calculan.
 *
 * La valuación versiona sus fórmulas en su propio módulo (`fcff-*`) y entra acá
 * cuando la Fase 3 la exponga a comparaciones.
 */
export const METRIC_CATALOG_VERSION = "metric-catalog-1.0.0";

export const metricCatalogEntrySchema = z
  .object({
    metricId: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    label: z.string().min(1),
    matrix: z.enum(["risk", "divergence"]),
    status: z.enum(["implemented", "planned"]),
    /** Versión de la fórmula que la calcula; `null` sólo si está `planned`. */
    formulaVersion: z.string().nullable(),
    /** Slice que la entrega o la entregó. */
    slice: z.string().regex(/^F\d+-\d{2}$/u),
    unit: z.enum(["ratio", "percent", "percentage_points"]),
    periodicity: z.string().min(1),
    definition: z.string().min(1),
    /** Qué significa un valor negativo: nunca se recorta ni se descarta. */
    negatives: z.string().min(1),
    /** Casos que producen `null` con motivo en lugar de un número. */
    nullReasons: z.array(z.string().min(1)),
  })
  .superRefine((entry, context) => {
    if ((entry.status === "implemented") !== (entry.formulaVersion !== null)) {
      context.addIssue({
        code: "custom",
        path: ["formulaVersion"],
        message: "An implemented metric names its formula; a planned one not.",
      });
    }
  });

export type MetricCatalogEntry = z.infer<typeof metricCatalogEntrySchema>;

const SORTINO_NULL_REASONS = [
  "insufficient_history",
  "no_close_at_as_of",
  "missing_period",
  "no_downside_observations",
  "currency_mismatch",
  "non_positive_close",
];

const sortinoEntry = (years: 2 | 5): MetricCatalogEntry => ({
  metricId: `sortino_${years}y`,
  label: `Sortino ${years} años`,
  matrix: "risk",
  status: "implemented",
  formulaVersion: SORTINO_FORMULA_VERSION,
  slice: "F7-04",
  unit: "ratio",
  periodicity: `retornos ${SORTINO_PARAMETERS.frequency === "daily" ? "diarios" : SORTINO_PARAMETERS.frequency}, anualizado con k = ${SORTINO_PARAMETERS.periodsPerYear}, ventana de ${years} años de calendario al as_of`,
  definition:
    "Media de los retornos total return en exceso de mar = 0 sobre la desviación a la baja calculada sobre todos los períodos, por raíz de k.",
  negatives:
    "Un Sortino negativo es un retorno medio negativo en la ventana: se muestra, no se recorta.",
  nullReasons: SORTINO_NULL_REASONS,
});

const plannedDivergence = (
  metricId: string,
  label: string,
  unit: MetricCatalogEntry["unit"],
  definition: string,
  negatives: string,
): MetricCatalogEntry => ({
  metricId,
  label,
  matrix: "divergence",
  status: "planned",
  formulaVersion: null,
  slice: "F8-01",
  unit,
  periodicity: "anualizado entre dos cierres fiscales, a 2 y a 5 años",
  definition,
  negatives,
  nullReasons: [],
});

const NEGATIVE_BASE =
  "Una base negativa o cero no tiene tasa de crecimiento: null con motivo, nunca un porcentaje fabricado.";

export const METRIC_CATALOG: readonly MetricCatalogEntry[] = Object.freeze(
  [
    sortinoEntry(2),
    sortinoEntry(5),
    plannedDivergence(
      "market_cap_cagr_pct",
      "Crecimiento anualizado del market cap",
      "percent",
      "CAGR de close × acciones en la misma fecha y base de splits.",
      NEGATIVE_BASE,
    ),
    plannedDivergence(
      "diluted_eps_cagr_pct",
      "Crecimiento anualizado del EPS diluido",
      "percent",
      "CAGR del EPS diluido reexpresado a la base de splits del último cierre.",
      NEGATIVE_BASE,
    ),
    plannedDivergence(
      "net_income_cagr_pct",
      "Crecimiento anualizado del net income",
      "percent",
      "CAGR del resultado neto entre los dos cierres fiscales.",
      NEGATIVE_BASE,
    ),
    plannedDivergence(
      "price_cagr_pct",
      "Crecimiento anualizado del precio",
      "percent",
      "CAGR del precio ajustado por splits entre las dos fechas.",
      NEGATIVE_BASE,
    ),
    plannedDivergence(
      "fundamental_gap_pp",
      "Brecha fundamental",
      "percentage_points",
      "diluted_eps_cagr_pct − market_cap_cagr_pct: distancia a la diagonal de la vista principal.",
      "Negativo es un valor que creció más que las ganancias; se muestra con su signo.",
    ),
    plannedDivergence(
      "share_count_bias_pp",
      "Sesgo por cambio de acciones",
      "percentage_points",
      "price_cagr_pct − market_cap_cagr_pct: la parte exacta de la brecha que viene de recompras o dilución.",
      "Positivo es recompra y negativo dilución; ninguno se descarta.",
    ),
  ].map((entry) => metricCatalogEntrySchema.parse(entry)),
);

export function findMetric(metricId: string): MetricCatalogEntry | null {
  return METRIC_CATALOG.find((entry) => entry.metricId === metricId) ?? null;
}
