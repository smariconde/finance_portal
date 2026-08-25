import type { BridgeItemKey } from "@/modules/valuation/domain/valuation-input";
import type {
  ReportedFactId,
  TransformationId,
} from "@/modules/valuation/domain/valuation-report";

/**
 * Lectura en español de los identificadores del motor.
 *
 * Vive en la superficie y no en el dominio a propósito: el identificador es el
 * contrato estable y auditable; la etiqueta es copia de interfaz y puede
 * cambiar sin reescribir una corrida. Cuando un código no está mapeado se
 * muestra el código, nunca una descripción inventada.
 */
export const BRIDGE_LABELS: Record<BridgeItemKey, string> = {
  excessCash: "Caja excedente",
  nonOperatingAssets: "Activos no operativos",
  debt: "Deuda financiera",
  minorityInterest: "Participaciones no controlantes",
  otherClaims: "Otras claims sobre el equity",
};

export const FACT_LABELS: Record<ReportedFactId, string> = {
  baseRevenue: "Ingresos del año base",
  dilutedShares: "Acciones diluidas",
  "bridge.excessCash": BRIDGE_LABELS.excessCash,
  "bridge.nonOperatingAssets": BRIDGE_LABELS.nonOperatingAssets,
  "bridge.debt": BRIDGE_LABELS.debt,
  "bridge.minorityInterest": BRIDGE_LABELS.minorityInterest,
  "bridge.otherClaims": BRIDGE_LABELS.otherClaims,
};

export const TRANSFORMATION_LABELS: Record<TransformationId, string> = {
  revenue_projection: "Proyección de ingresos",
  ebit: "Resultado operativo",
  nopat: "NOPAT después de impuestos",
  reinvestment_sales_to_capital: "Reinversión por sales-to-capital",
  reinvestment_return_on_capital: "Reinversión por crecimiento sobre ROIC",
  fcff: "Flujo libre a la firma",
  discount_factor: "Factor de descuento acumulado",
  present_value: "Valor presente del período",
  terminal_value: "Valor terminal",
  enterprise_value: "Enterprise value",
  equity_bridge: "Puente enterprise value a equity",
  value_per_share: "Valor por acción",
};

const CHECK_LABELS: Record<string, string> = {
  currency_and_unit_consistency: "Moneda y unidad consistentes",
  required_inputs_present: "Inputs requeridos presentes",
  diluted_shares_positive: "Acciones diluidas positivas",
  discount_factor_defined: "Factor de descuento definido",
  sales_to_capital_positive: "Sales-to-capital positivo",
  reinvestment_convention_bridge: "Puente entre convenciones de reinversión",
  terminal_growth_versus_wacc: "Crecimiento terminal por debajo del WACC",
  terminal_reinvestment_coherence: "Reinversión terminal coherente",
  tax_rate_range: "Tasa impositiva dentro de rango",
  terminal_margin_range: "Margen terminal dentro de rango",
  terminal_value_share: "Peso del valor terminal",
  equity_value_positive: "Equity value positivo",
};

export function checkLabel(id: string): string {
  return CHECK_LABELS[id] ?? id;
}

const QUALITY_FLAG_LABELS: Record<string, string> = {
  restated_by_source: "Reexpresado por la fuente",
  not_provided: "No provisto",
  license_restricted: "Restringido por licencia",
  estimated: "Estimado",
};

export function qualityFlagLabel(flag: string): string {
  return QUALITY_FLAG_LABELS[flag] ?? flag;
}

const SENSITIVITY_REJECTION_LABELS: Record<string, string> = {
  terminal_growth_versus_wacc:
    "El crecimiento terminal alcanza al WACC: la perpetuidad no está definida.",
  division_by_zero: "División por cero en este escenario.",
  non_finite_value: "El escenario no produce un valor finito.",
  policy_check_failed: "Un policy check rechaza este escenario.",
  invalid_decimal: "Un valor del escenario no es un decimal canónico.",
  unsupported_method: "El método no cubre este escenario.",
};

export function sensitivityRejectionLabel(reason: string): string {
  return SENSITIVITY_REJECTION_LABELS[reason] ?? reason;
}

export const REVISION_POLICY_LABELS: Record<string, string> = {
  as_known: "Como se conocía en el corte",
  latest_restated: "Última versión reexpresada",
};

export const KNOWLEDGE_BASIS_LABELS: Record<string, string> = {
  public_availability: "Disponibilidad pública de la fuente",
  system_recorded: "Registro de esta instalación",
};

export const ADJUSTMENT_POLICY_LABELS: Record<string, string> = {
  as_known: "Sin reajustar por acciones societarias posteriores",
  latest_adjusted: "Ajustado por acciones societarias posteriores",
};

export const ASSET_PROFILE_LABELS: Record<string, string> = {
  non_financial_mature: "No financiera madura",
  high_growth: "Alto crecimiento",
  bank: "Banco",
  insurer: "Aseguradora",
  reit: "REIT",
  cyclical: "Cíclica",
  commodity: "Commodity",
  holding: "Holding",
  distressed: "Distress",
};
