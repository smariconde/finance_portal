import type { CompletenessStatus } from "@/modules/valuation/domain/completeness-profile";

/**
 * Lectura en español de los códigos propios de una corrida sobre una empresa
 * real. Igual que en `run/labels.ts`, el código es el contrato y la etiqueta es
 * copia: un código sin etiqueta se muestra tal cual, nunca con una descripción
 * inventada.
 */
function labelOr(labels: Record<string, string>, code: string): string {
  return labels[code] ?? code;
}

const COMPLETENESS_CHECK_LABELS: Record<string, string> = {
  structural_inputs: "Inputs estructurales del último ejercicio",
  history_years: "Ejercicios consecutivos con ventas y EBIT",
  cash_and_debt: "Caja y deuda separadas",
  leases: "Pasivo por arrendamientos",
  research_development: "Historia de I+D",
  reinvestment_inputs: "Capex y depreciación",
  tax_rate_inputs: "Resultado antes de impuestos e impuesto",
  industry_mapping: "Industria de Damodaran",
  geographic_revenue_mix: "Mix geográfico de ingresos",
  employee_options_not_subtracted: "Opciones de empleados sin restar",
};

export function completenessCheckLabel(code: string): string {
  return labelOr(COMPLETENESS_CHECK_LABELS, code);
}

export const COMPLETENESS_STATUS_LABELS: Record<CompletenessStatus, string> = {
  met: "Cumplida",
  partial: "Parcial",
  missing: "Faltante",
  not_evaluated: "No evaluada",
};

/** Lo que degradó el rigor: una comprobación o un motivo del selector. */
export function degradationLabel(code: string): string {
  return code.startsWith("selection.")
    ? `Selector: ${code.slice("selection.".length)}`
    : completenessCheckLabel(code);
}

const RIGOR_DECLARATION_LABELS: Record<string, string> = {
  country_risk_by_domicile:
    "Sin mix geográfico, el riesgo país sale del domicilio legal.",
  invested_capital_not_reconstructed:
    "Sin capital invertido reconstruido: el rango es amplio y el ROIC no es confiable.",
  employee_options_not_subtracted:
    "Sin transcripción ni XBRL de las opciones de empleados, el puente no las resta: el valor por acción es una cota superior.",
};

export function rigorDeclarationLabel(code: string): string {
  return labelOr(RIGOR_DECLARATION_LABELS, code);
}

export const CONFIDENCE_LABELS: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const PARAMETER_LABELS: Record<string, string> = {
  treasury_bond_rate: "Bono del Tesoro",
  sovereign_default_spread: "Spread de default soberano",
  implied_erp: "Prima de riesgo implícita",
  country_risk_premium: "Prima de riesgo país",
  country_default_spread: "Spread de default del país",
  marginal_tax_rate: "Tasa impositiva marginal",
  unlevered_beta: "Beta desapalancada de la industria",
  target_debt_to_equity: "Deuda sobre equity de la industria",
  company_default_spread: "Spread del rating sintético",
};

export function parameterLabel(code: string): string {
  return labelOr(PARAMETER_LABELS, code);
}

const DATASET_LABELS: Record<string, string> = {
  "damodaran.implied-erp": "Damodaran · ERP implícita histórica",
  "damodaran.country-risk": "Damodaran · riesgo país",
  "damodaran.country-risk-regions": "Damodaran · riesgo país por región",
  "damodaran.betas-us": "Damodaran · betas por industria (EE. UU.)",
  "damodaran.eva-us":
    "Damodaran · retorno sobre el capital por industria (EE. UU.)",
  "damodaran.synthetic-ratings": "Damodaran · rating sintético",
  "damodaran.failure-rates": "Damodaran · tasas de default por rating",
};

export function datasetLabel(code: string): string {
  return labelOr(DATASET_LABELS, code);
}

const COST_DECLARATION_LABELS: Record<string, string> = {
  riskfree_net_of_sovereign_default_spread:
    "Libre de riesgo: el Tesoro menos el spread de default soberano.",
  erp_implied_at_start_of_year: "Prima de riesgo implícita al inicio del año.",
  industry_beta_us: "Beta de la industria en EE. UU.",
  target_structure_industry_average:
    "Estructura de capital objetivo: el promedio de la industria.",
  country_risk_by_primary_listing: "Riesgo país del país del listing primario.",
  synthetic_rating_large_nonfinancial:
    "Rating sintético de la tabla de grandes no financieras.",
  coverage_from_earlier_fiscal_year:
    "La cobertura de intereses sale de un ejercicio anterior al último.",
  coverage_interest_debt_plus_finance_leases:
    "El gasto de intereses es el de la deuda más el de los arrendamientos financieros: la empresa no publica el total.",
  coverage_interest_net_nonoperating:
    "El gasto de intereses es el neto de los ganados: la empresa no publica el bruto, y la cobertura queda algo alta.",
  coverage_interest_paid:
    "El gasto de intereses es lo pagado en el ejercicio: la empresa no publica el devengado.",
  coverage_no_interest_expense:
    "Sin gasto de intereses en cinco ejercicios y sin deuda: la cobertura es el piso de la banda más alta de la tabla.",
  terminal_beta_converges_to_one: "La beta terminal converge a 1.",
  country_risk_by_operations:
    "Riesgo país ponderado por las operaciones de la empresa.",
  regions_combined_by_gdp: "Las regiones se combinan por PBI.",
  rest_of_world_as_global:
    "El resto del mundo pesa como las nueve regiones juntas.",
};

export function costDeclarationLabel(code: string): string {
  return labelOr(COST_DECLARATION_LABELS, code);
}

const ADJUSTMENT_LABELS: Record<string, string> = {
  operating_lease_capitalization: "Arrendamientos operativos como deuda",
  rd_capitalization: "I+D capitalizada",
  restructuring_non_recurring: "Reestructuración no recurrente",
  impairment_non_recurring: "Deterioro no recurrente",
  share_based_compensation: "Compensación en acciones",
};

export function adjustmentLabel(code: string): string {
  return labelOr(ADJUSTMENT_LABELS, code);
}

export const ADJUSTMENT_TARGET_LABELS: Record<string, string> = {
  ebit: "EBIT",
  invested_capital: "Capital invertido",
  debt: "Deuda",
};

const NOT_APPLIED_REASON_LABELS: Record<string, string> = {
  not_reported: "no reportado",
  zero_charge: "cargo en cero",
  insufficient_history: "historia insuficiente",
  recurring: "recurrente en ejercicios anteriores",
  expensed: "es un gasto: no se revierte",
  immaterial: "inmaterial",
  lease_liability_missing: "sin pasivo por arrendamientos",
  lease_liability_partial: "pasivo por arrendamientos incompleto",
  lease_liability_negative: "pasivo por arrendamientos negativo",
  cost_of_debt_missing: "sin costo de deuda",
  rd_negative: "i+D negativa",
  industry_unassigned: "sin industria asignada",
  life_not_declared: "sin vida útil declarada",
  revenue_unavailable: "sin ventas",
};

export function notAppliedReasonLabel(code: string): string {
  return labelOr(NOT_APPLIED_REASON_LABELS, code);
}

export const INTEREST_BASIS_LABELS: Record<string, string> = {
  gross: "el gasto bruto",
  debt_plus_finance_leases:
    "el de la deuda más el de los arrendamientos financieros",
  net_nonoperating: "el neto de los ganados",
  interest_paid: "lo pagado en el ejercicio",
};
