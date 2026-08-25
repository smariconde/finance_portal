import { formatDecimal, parseDecimal } from "./decimal-policy";
import { BRIDGE_ITEM_KEYS, type BridgeItemKey } from "./valuation-input";
import type { ValuationRun } from "./valuation-run";

/**
 * Lectura auditable de una corrida de valuación: qué hechos la sostienen, con
 * qué antigüedad, qué quedó declarado ausente, qué transformaciones se
 * aplicaron y cómo se lee su grilla de sensibilidad.
 *
 * Es dominio puro. No decide etiquetas, colores ni orden visual: devuelve los
 * hechos derivados y la superficie decide cómo mostrarlos. Nada acá recalcula
 * la valuación: opera sobre una corrida ya persistida, así que leerla no puede
 * producir un número distinto del que quedó registrado (`TM-16`).
 */
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * La clasificación de freshness es una **convención de lectura versionada**, no
 * un juicio de calidad de la fuente. Los umbrales están acá para que un cambio
 * de criterio sea explícito y no reescriba en silencio cómo se leyó una corrida
 * anterior.
 */
export const FRESHNESS_POLICY_VERSION = "valuation-freshness-1.0.0";

export const FRESHNESS_THRESHOLD_DAYS = Object.freeze({
  /** Hasta dos trimestres entre el período medido y la fecha de valuación. */
  current: 180,
  /** Hasta un ejercicio completo. Más allá, el hecho es viejo y lo dice. */
  aging: 365,
});

export type FreshnessLevel =
  | "current"
  | "aging"
  | "stale"
  /** El hecho está fechado después de la valuación: nunca debió entrar. */
  | "posterior";

export type FactFreshness = {
  policyVersion: string;
  /** Días entre el cierre del hecho y la fecha de valuación. */
  coverageGapDays: number;
  /** Días que el hecho llevaba siendo conocible en el corte de conocimiento. */
  knowledgeAgeDays: number;
  level: FreshnessLevel;
};

function wholeDaysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / MILLISECONDS_PER_DAY);
}

export function classifyFreshness(input: {
  factAsOf: string;
  factAvailableAt: string;
  valuationAsOf: string;
  knowledgeCutoff: string;
}): FactFreshness {
  const coverageGapDays = wholeDaysBetween(input.factAsOf, input.valuationAsOf);
  const knowledgeAgeDays = wholeDaysBetween(
    input.factAvailableAt,
    input.knowledgeCutoff,
  );

  let level: FreshnessLevel = "stale";

  if (coverageGapDays < 0) {
    level = "posterior";
  } else if (coverageGapDays <= FRESHNESS_THRESHOLD_DAYS.current) {
    level = "current";
  } else if (coverageGapDays <= FRESHNESS_THRESHOLD_DAYS.aging) {
    level = "aging";
  }

  return {
    policyVersion: FRESHNESS_POLICY_VERSION,
    coverageGapDays,
    knowledgeAgeDays,
    level,
  };
}

/** Identificador estable de cada hecho, igual a su ruta en el snapshot. */
export type ReportedFactId =
  "baseRevenue" | "dilutedShares" | `bridge.${BridgeItemKey}`;

export type ReportedFact = {
  id: ReportedFactId;
  unit: "monetary" | "shares";
  value: string;
  /** `null` para un conteo de acciones: no tiene moneda, y no se le inventa. */
  currency: string | null;
  asOf: string;
  availableAt: string;
  sourceId: string;
  sourceDocumentId: string | null;
  observationId: string | null;
  qualityFlags: readonly string[];
  freshness: FactFreshness;
};

export type DeclaredAbsence = {
  id: `bridge.${BridgeItemKey}`;
  rationale: string;
};

/**
 * El corte con el que se leyeron los hechos. Bajo `latest_restated` no hay
 * corte histórico, así que la antigüedad de conocimiento se mide contra el
 * momento en que la corrida quedó registrada.
 */
export function resolveKnowledgeCutoff(run: ValuationRun): string {
  return run.provenance.knowledge.knownAt ?? run.recordedAt;
}

/**
 * Hechos con provenance que sostienen la corrida. Un `declared_absent` no
 * aparece acá: no es un hecho reportado con valor cero, y mezclarlos borraría
 * justamente la distinción que `TM-05` exige.
 */
export function collectReportedFacts(
  run: ValuationRun,
): readonly ReportedFact[] {
  const valuationAsOf = run.asOf;
  const knowledgeCutoff = resolveKnowledgeCutoff(run);

  const freshnessOf = (fact: { asOf: string; availableAt: string }) =>
    classifyFreshness({
      factAsOf: fact.asOf,
      factAvailableAt: fact.availableAt,
      valuationAsOf,
      knowledgeCutoff,
    });

  const facts: ReportedFact[] = [
    {
      id: "baseRevenue",
      unit: "monetary",
      value: run.input.baseRevenue.value,
      currency: run.input.baseRevenue.currency,
      asOf: run.input.baseRevenue.asOf,
      availableAt: run.input.baseRevenue.availableAt,
      sourceId: run.input.baseRevenue.sourceId,
      sourceDocumentId: run.input.baseRevenue.sourceDocumentId,
      observationId: run.input.baseRevenue.observationId,
      qualityFlags: run.input.baseRevenue.qualityFlags,
      freshness: freshnessOf(run.input.baseRevenue),
    },
  ];

  for (const key of BRIDGE_ITEM_KEYS) {
    const amount = run.input.bridge[key].amount;

    if (amount === null) {
      continue;
    }

    facts.push({
      id: `bridge.${key}`,
      unit: "monetary",
      value: amount.value,
      currency: amount.currency,
      asOf: amount.asOf,
      availableAt: amount.availableAt,
      sourceId: amount.sourceId,
      sourceDocumentId: amount.sourceDocumentId,
      observationId: amount.observationId,
      qualityFlags: amount.qualityFlags,
      freshness: freshnessOf(amount),
    });
  }

  facts.push({
    id: "dilutedShares",
    unit: "shares",
    value: run.input.dilutedShares.value,
    currency: null,
    asOf: run.input.dilutedShares.asOf,
    availableAt: run.input.dilutedShares.availableAt,
    sourceId: run.input.dilutedShares.sourceId,
    sourceDocumentId: run.input.dilutedShares.sourceDocumentId,
    observationId: run.input.dilutedShares.observationId,
    qualityFlags: run.input.dilutedShares.qualityFlags,
    freshness: freshnessOf(run.input.dilutedShares),
  });

  return facts;
}

/** Claims que el owner declaró ausentes, con el motivo que las hace cero. */
export function collectDeclaredAbsences(
  run: ValuationRun,
): readonly DeclaredAbsence[] {
  return BRIDGE_ITEM_KEYS.filter(
    (key) => run.input.bridge[key].status === "declared_absent",
  ).map((key) => ({
    id: `bridge.${key}` as const,
    // El schema garantiza el motivo cuando el estado es `declared_absent`.
    rationale: run.input.bridge[key].rationale ?? "",
  }));
}

/**
 * Transformaciones efectivamente aplicadas por esta corrida, en orden de
 * cálculo. La convención de reinversión no se lista completa: se lista la que
 * el snapshot usó, porque la otra no explica este resultado.
 */
export const TRANSFORMATION_IDS = [
  "revenue_projection",
  "ebit",
  "nopat",
  "reinvestment_sales_to_capital",
  "reinvestment_return_on_capital",
  "fcff",
  "discount_factor",
  "present_value",
  "terminal_value",
  "enterprise_value",
  "equity_bridge",
  "value_per_share",
] as const;

export type TransformationId = (typeof TRANSFORMATION_IDS)[number];

export type Transformation = {
  id: TransformationId;
  /** Notación neutral; la superficie aporta la lectura en español. */
  formula: string;
};

const FORMULAS: Record<TransformationId, string> = {
  revenue_projection: "revenue_t = revenue_(t-1) × (1 + growth_t)",
  ebit: "ebit_t = revenue_t × ebit_margin_t",
  nopat: "nopat_t = ebit_t × (1 − tax_rate_t)",
  reinvestment_sales_to_capital:
    "reinvestment_t = (revenue_t − revenue_(t-1)) / sales_to_capital_t",
  reinvestment_return_on_capital:
    "reinvestment_t = nopat_t × (growth_t / return_on_capital_t)",
  fcff: "fcff_t = nopat_t − reinvestment_t",
  discount_factor: "discount_factor_t = Π (1 + wacc_i), i = 1..t",
  present_value: "present_value_t = fcff_t / discount_factor_t",
  terminal_value:
    "terminal_value = fcff_terminal / (wacc_terminal − growth_terminal)",
  enterprise_value:
    "enterprise_value = Σ present_value_t + terminal_value / discount_factor_n",
  equity_bridge:
    "equity_value = enterprise_value + excess_cash + non_operating_assets − debt − minority_interest − other_claims",
  value_per_share: "value_per_share = equity_value / diluted_shares",
};

export function listTransformations(
  run: ValuationRun,
): readonly Transformation[] {
  const conventions = new Set(
    run.input.periods.map((period) => period.reinvestment.convention),
  );

  return TRANSFORMATION_IDS.filter((id) => {
    if (id === "reinvestment_sales_to_capital") {
      return conventions.has("sales_to_capital");
    }

    if (id === "reinvestment_return_on_capital") {
      return conventions.has("return_on_capital");
    }

    return true;
  }).map((id) => ({ id, formula: FORMULAS[id] }));
}

type AnnotatedCellBase = {
  wacc: string;
  terminalGrowth: string;
  /** `true` sólo en la celda que reproduce exactamente el caso base. */
  isBase: boolean;
};

export type AnnotatedSensitivityCell =
  | (AnnotatedCellBase & {
      status: "computed";
      valuePerShare: string;
      /** Diferencia contra el caso base; `null` sin base comparable. */
      deltaVsBase: string | null;
    })
  | (AnnotatedCellBase & { status: "rejected"; reason: string });

export type AnnotatedSensitivity = {
  unit: "value_per_share";
  currency: string;
  waccValues: readonly string[];
  terminalGrowthValues: readonly string[];
  rows: readonly {
    wacc: string;
    cells: readonly AnnotatedSensitivityCell[];
  }[];
  /**
   * El eje de WACC reemplaza el costo de capital de **todos** los períodos. Con
   * un WACC no plano el caso base no es ninguna celda de la grilla, y decirlo
   * es preferible a marcar una celda que no lo reproduce.
   */
  baseIsComparable: boolean;
  baseValuePerShare: string | null;
};

function sameRate(left: string, right: string): boolean {
  return parseDecimal(left, "sensitivity").eq(
    parseDecimal(right, "sensitivity"),
  );
}

/**
 * Anota la grilla contra el caso base: marca su celda y expresa cada escenario
 * como diferencia. Una celda rechazada conserva su motivo y **no** recibe
 * delta: no hay valor del que restar.
 */
export function annotateSensitivity(
  run: ValuationRun,
): AnnotatedSensitivity | null {
  const grid = run.result?.sensitivity;

  if (grid === undefined || grid === null) {
    return null;
  }

  const baseWacc = run.input.terminal.wacc;
  const baseIsComparable = run.input.periods.every((period) =>
    sameRate(period.wacc, baseWacc),
  );
  const baseValuePerShare =
    baseIsComparable && run.result !== null ? run.result.valuePerShare : null;

  const rows = grid.rows.map((row) => ({
    wacc: row.wacc,
    cells: row.cells.map((cell, index): AnnotatedSensitivityCell => {
      const terminalGrowth = grid.terminalGrowth.values[index];
      const isBase =
        baseIsComparable &&
        sameRate(row.wacc, baseWacc) &&
        sameRate(terminalGrowth, run.input.terminal.growth);

      if (cell.status === "rejected") {
        return {
          status: "rejected",
          reason: cell.reason,
          wacc: row.wacc,
          terminalGrowth,
          isBase,
        };
      }

      return {
        status: "computed",
        valuePerShare: cell.valuePerShare,
        wacc: row.wacc,
        terminalGrowth,
        isBase,
        deltaVsBase:
          baseValuePerShare === null
            ? null
            : formatDecimal(
                parseDecimal(cell.valuePerShare, "sensitivity").minus(
                  parseDecimal(baseValuePerShare, "valuePerShare"),
                ),
                "sensitivity.deltaVsBase",
              ),
      };
    }),
  }));

  return {
    unit: grid.unit,
    currency: grid.currency,
    waccValues: grid.wacc.values,
    terminalGrowthValues: grid.terminalGrowth.values,
    rows,
    baseIsComparable,
    baseValuePerShare,
  };
}
