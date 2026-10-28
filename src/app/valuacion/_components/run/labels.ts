import { termName } from "@/app/_components/financial-terms";
import type { ScenarioDriverKey } from "@/modules/valuation/domain/scenarios";
import type { BridgeItemKey } from "@/modules/valuation/domain/valuation-input";
import type {
  ReportedFactId,
  TransformationId,
} from "@/modules/valuation/domain/valuation-report";

/**
 * Lectura de los identificadores del motor. Las métricas usan su nombre
 * estándar en inglés del glosario (`financial-terms.ts`); el resto, castellano.
 *
 * Vive en la superficie y no en el dominio a propósito: el identificador es el
 * contrato estable y auditable; la etiqueta es copia de interfaz y puede
 * cambiar sin reescribir una corrida. Cuando un código no está mapeado se
 * muestra el código, nunca una descripción inventada.
 */
export const BRIDGE_LABELS: Record<BridgeItemKey, string> = {
  excessCash: termName("excessCash"),
  nonOperatingAssets: termName("nonOperatingAssets"),
  debt: termName("debt"),
  leaseDebt: termName("leaseDebt"),
  minorityInterest: termName("minorityInterest"),
  otherClaims: termName("otherClaims"),
  employeeOptions: termName("employeeOptions"),
};

export const FACT_LABELS: Record<ReportedFactId, string> = {
  baseRevenue: "Base-year revenue",
  sharesOutstanding: termName("sharesOutstanding"),
  "bridge.excessCash": BRIDGE_LABELS.excessCash,
  "bridge.nonOperatingAssets": BRIDGE_LABELS.nonOperatingAssets,
  "bridge.debt": BRIDGE_LABELS.debt,
  "bridge.leaseDebt": BRIDGE_LABELS.leaseDebt,
  "bridge.minorityInterest": BRIDGE_LABELS.minorityInterest,
  "bridge.otherClaims": BRIDGE_LABELS.otherClaims,
  "bridge.employeeOptions": BRIDGE_LABELS.employeeOptions,
};

export const TRANSFORMATION_LABELS: Record<TransformationId, string> = {
  revenue_projection: "Revenue projection",
  ebit: termName("ebit"),
  nopat: termName("nopat"),
  reinvestment_sales_to_capital: "Reinvestment (sales-to-capital)",
  reinvestment_return_on_capital: "Reinvestment (growth ÷ ROIC)",
  fcff: termName("fcff"),
  discount_factor: termName("discountFactor"),
  present_value: termName("presentValue"),
  terminal_value: termName("terminalValue"),
  enterprise_value: termName("enterpriseValue"),
  equity_bridge: "EV-to-equity bridge",
  value_per_share: termName("valuePerShare"),
};

const CHECK_LABELS: Record<string, string> = {
  method_selection_admits_run: "Método elegido por el selector",
  rigor_derived_from_completeness: "Rigor derivado de la completitud",
  rigor_admits_valuation: "Rigor que admite valuar",
  wacc_built_from_components: "WACC construido con componentes fechados",
  currency_and_unit_consistency: "Moneda y unidad consistentes",
  required_inputs_present: "Inputs requeridos presentes",
  diluted_shares_positive: "Acciones diluidas positivas",
  discount_factor_defined: "Factor de descuento definido",
  sales_to_capital_positive: "Sales-to-capital positivo",
  reinvestment_convention_bridge: "Puente entre convenciones de reinversión",
  capitalization_recomputed: "Capitalización recalculada desde sus hechos",
  normalization_recomputed: "Normalización recalculada desde sus hechos",
  terminal_growth_versus_risk_free:
    "Crecimiento terminal hasta la libre de riesgo",
  terminal_growth_versus_wacc: "Crecimiento terminal por debajo del WACC",
  terminal_reinvestment_coherence: "Reinversión terminal coherente",
  tax_rate_range: "Tasa impositiva dentro de rango",
  terminal_margin_range: "Margen terminal dentro de rango",
  terminal_value_share: "Peso del valor terminal",
  equity_value_positive: "Equity value positivo",
  scenario_drivers_declared: "Drivers de escenario declarados sobre la base",
  scenario_value_order: "Bear, base y bull ordenados",
  qualitative_decisions_drive_cost_of_capital:
    "Decisiones cualitativas que mueven el costo de capital",
  employee_equity_recomputed: "Opciones de empleados recalculadas",
  failure_risk_recomputed: "Probabilidad de quiebra recalculada",
  assumptions_derived_recomputed: "Supuestos derivados recalculados",
  zero_debt_evidence_consistent: "Evidencia de deuda cero consistente",
  share_count_positive: "Cantidad de acciones positiva",
  method_versions_match: "Versiones del método coherentes",
  cycle_model_experimental: "Modelo de ciclo experimental",
  cycle_normalization_recomputed: "Normalización de ciclo recalculada",
  cycle_scenario_margin_target: "Escenarios de ciclo por margen objetivo",
  cycle_snapshot_known_at_cutoff: "Snapshot de ciclo visible al corte",
};

/** Qué exige cada control, en castellano; el motor lo guarda en inglés. */
const CHECK_RULES: Record<string, string> = {
  method_selection_admits_run:
    "La corrida valúa el perfil y el método que eligió el selector.",
  rigor_derived_from_completeness:
    "El nivel de rigor se deriva de la completitud de los datos; nunca se elige.",
  rigor_admits_valuation: "Un rigor no admitido no valúa: nombra lo que falta.",
  wacc_built_from_components:
    "El costo de capital de cada período y el terminal son los que derivan sus componentes fechados.",
  qualitative_decisions_drive_cost_of_capital:
    "La industria y el peso por país son los que derivan las decisiones cualitativas registradas.",
  capitalization_recomputed:
    "Arrendamientos e I+D capitalizados son los que derivan sus hechos fechados.",
  normalization_recomputed:
    "La base ajustada, la deuda y la caja son las que derivan sus hechos fechados.",
  scenario_drivers_declared:
    "Cada supuesto de escenario cubre todos los años y cambia algo respecto de la base.",
  employee_equity_recomputed:
    "Opciones y acciones son las que derivan la transcripción, el conteo y el mercado congelados.",
  failure_risk_recomputed:
    "La probabilidad de quiebra sigue la calificación fechada o una decisión explícita del owner.",
  assumptions_derived_recomputed:
    "Los supuestos derivados son los que reconstruyen la historia de ventas, la normalización y el costo de capital congelados.",
  zero_debt_evidence_consistent:
    "La evidencia de deuda cero se mide contra la mejor banda de calificación de la propia corrida.",
  method_versions_match:
    "El método usa sus propias versiones de motor y metodología.",
  currency_and_unit_consistency:
    "Todos los montos están en la moneda de la valuación; no hay conversiones.",
  required_inputs_present:
    "Un dato faltante no es cero: se registra el monto o se declara su ausencia con motivo.",
  share_count_positive:
    "La cantidad de acciones es estrictamente positiva y está fechada.",
  diluted_shares_positive:
    "La cantidad de acciones es estrictamente positiva y está fechada.",
  discount_factor_defined:
    "Cada período tiene una tasa que define un factor de descuento.",
  sales_to_capital_positive: "Las ventas sobre capital son positivas.",
  reinvestment_convention_bridge:
    "Mezclar convenciones de reinversión exige un puente registrado.",
  terminal_growth_versus_risk_free:
    "El crecimiento a perpetuidad no supera la tasa libre de riesgo de la moneda.",
  terminal_growth_versus_wacc:
    "La tasa terminal supera al crecimiento a perpetuidad por al menos medio punto.",
  terminal_reinvestment_coherence:
    "La reinversión terminal está entre cero y uno y sostiene el crecimiento terminal.",
  tax_rate_range: "Una tasa impositiva fuera de 0–50 % necesita un motivo.",
  terminal_margin_range:
    "Un margen terminal fuera de 0–60 % necesita evidencia del sector.",
  terminal_value_share:
    "Si el valor terminal pasa del 85 % del total, carga casi toda la respuesta.",
  equity_value_positive:
    "Un patrimonio no positivo es un resultado posible, pero no se lee como precio.",
  scenario_value_order:
    "Pesimista, base y optimista quedan ordenados; lo contrario contradice sus nombres.",
  cycle_model_experimental:
    "El modelo de ciclo es experimental: si la ventana cubre un ciclo, si la contabilidad es comparable y cuánto habrá que reinvertir lo revisa el owner.",
  cycle_normalization_recomputed:
    "La historia del ciclo, la clasificación y la trayectoria del margen explican el flujo normalizado.",
  cycle_scenario_margin_target:
    "Un escenario de ciclo mueve el margen objetivo, que reconstruye toda la trayectoria; nunca el margen de un año suelto.",
  cycle_snapshot_known_at_cutoff:
    "Los hechos y las tasas del snapshot eran visibles al corte de conocimiento declarado.",
};

export function checkRule(id: string, message: string): string {
  return CHECK_RULES[id] ?? message;
}

/** Drivers que un escenario puede mover (`scenario-set-1.0.0`). */
export const SCENARIO_DRIVER_LABELS: Record<ScenarioDriverKey, string> = {
  revenueGrowth: termName("revenueGrowth"),
  ebitMargin: termName("ebitMargin"),
  salesToCapital: termName("salesToCapital"),
  returnOnCapital: termName("returnOnCapital"),
  terminalGrowth: termName("terminalGrowth"),
  terminalEbitMargin: termName("terminalEbitMargin"),
  terminalReturnOnCapital: termName("terminalReturnOnCapital"),
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
  terminal_growth_versus_risk_free:
    "El crecimiento terminal supera la libre de riesgo: ninguna empresa crece a perpetuidad más rápido que su economía.",
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
  loss_making: "Pérdidas persistentes",
  bank: "Banco",
  insurer: "Aseguradora",
  reit: "REIT",
  cyclical: "Cíclica",
  commodity: "Commodity",
  holding: "Holding",
  distressed: "Distress",
};
