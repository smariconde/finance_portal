import type { AssetProfile } from "@/modules/valuation/domain/asset-profile";
import type { MethodSelectionReason } from "@/modules/valuation/domain/method-selection";
import type { RigorLevel } from "@/modules/valuation/domain/rigor-level";
import type {
  ValuationJobGap,
  ValuationSnapshotGap,
} from "@/modules/valuation/domain/valuation-job";

/**
 * Lectura en español de los códigos del job por ticker. La comparten el
 * formulario, el historial y la página del resultado, para que un mismo hueco
 * no se diga de dos maneras.
 */
export const GAP_COPY: Record<ValuationJobGap, string> = {
  unresolved_ticker: "Ese ticker no está en el universo constituido.",
  ambiguous_ticker: "El ticker corresponde a más de una security.",
  identity_conflict: "El grafo de identidad se contradice para ese ticker.",
  cik_missing:
    "La empresa resuelve, pero no tiene un CIK vigente a este corte.",
  annual_fundamentals:
    "No hay fundamentals guardados. Esta corrida no los descarga.",
  unsupported_method: "El método que le corresponde no está admitido.",
  snapshot_not_assembled:
    "La evaluación está hecha, pero el snapshot de supuestos no se pudo armar. No hay corrida.",
  assessment_failed: "La evaluación no terminó. Se puede volver a encolar.",
  run_recorded:
    "Se registró una corrida con supuestos derivados de lo guardado.",
};

export const SNAPSHOT_GAP_COPY: Record<ValuationSnapshotGap, string> = {
  method_not_derived: "este método todavía no tiene una regla de supuestos",
  security_missing: "la empresa no resuelve a una security",
  cost_of_capital_unavailable: "falta el costo de capital fechado",
  normalization_unavailable: "falta el ejercicio base normalizado",
  revenue_history_insufficient:
    "hay menos de tres ejercicios consecutivos de ventas",
  revenue_history_non_positive: "las ventas de la historia no son positivas",
  base_margin_unavailable: "falta el margen operativo del ejercicio base",
  sales_to_capital_unavailable:
    "falta un sales-to-capital positivo del ejercicio base",
  tax_rate_unavailable: "falta la tasa de impuesto del ejercicio base",
  employee_equity_not_proposed:
    "falta la transcripción aceptada de opciones de empleados",
  shares_outstanding_unavailable:
    "faltan las acciones en circulación de la carátula",
  market_unavailable:
    "faltan el precio o la volatilidad para valuar las opciones",
};

export const PROFILE_COPY: Record<AssetProfile, string> = {
  non_financial_mature: "No financiera madura",
  high_growth: "Alto crecimiento",
  loss_making: "Pérdidas persistentes",
  bank: "Banco",
  insurer: "Aseguradora",
  reit: "REIT",
  cyclical: "Cíclica",
  commodity: "Commodity",
  holding: "Holding",
  distressed: "Distress",
};

export const RIGOR_COPY: Record<RigorLevel, string> = {
  full: "Pleno",
  standard: "Estándar",
  screening: "Screening",
  unsupported: "No admitido",
};

export const REASON_COPY: Record<MethodSelectionReason, string> = {
  missing_classification_evidence: "falta evidencia de clasificación",
  conflicting_evidence: "la evidencia se contradice",
  method_not_implemented: "el método no está implementado",
  missing_required_input: "falta un input requerido",
};
