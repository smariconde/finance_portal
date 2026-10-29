import type { PointInTimeClaim } from "@/modules/observations/domain/point-in-time-audit";
import type { AssetProfile } from "@/modules/valuation/domain/asset-profile";
import type { MethodSelectionReason } from "@/modules/valuation/domain/method-selection";
import type { RigorLevel } from "@/modules/valuation/domain/rigor-level";
import type {
  DataPendingReason,
  ValuationDataStep,
} from "@/modules/valuation/domain/valuation-data-step";
import type {
  ValuationJobGap,
  ValuationSnapshotGap,
} from "@/modules/valuation/domain/valuation-job";
import {
  QUALITATIVE_TASK_ORDER,
  type QualitativeTask,
  type QualitativeTaskStep,
  type ValuationQualitativeStep,
} from "@/modules/valuation/domain/valuation-qualitative-step";

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
    "No hay una serie anual de fundamentals guardada para valuar.",
  unsupported_method: "El método que le corresponde no está admitido.",
  snapshot_not_assembled:
    "La evaluación está hecha, pero el snapshot de supuestos no se pudo armar. No hay corrida.",
  assessment_failed: "La evaluación no terminó. Se puede volver a encolar.",
  run_recorded:
    "Se registró una corrida con supuestos derivados de lo guardado.",
  data_ingested:
    "Bajó lo que faltaba y auditó la empresa; otro pedido valúa con un corte que lo ve.",
  ingestion_pending:
    "La descarga de lo que falta quedó a medias. El próximo pedido la retoma donde quedó.",
  ingestion_failed:
    "La fuente rechazó la descarga de esta empresa. No se reintenta sola.",
  point_in_time_audit_failed:
    "La auditoría point-in-time de la empresa encontró una falla. No se valúa hasta repararla.",
  qualitative_resolved:
    "La IA resolvió lo cualitativo que faltaba, con citas del 10-K que una policy verificó; otro pedido valúa con un corte que lo ve.",
};

/** El selector conserva el perfil y el motivo; el gap solo no explica el caso. */
export function describeJobGap(
  gap: ValuationJobGap | null,
  assetProfile: AssetProfile | null,
  unsupportedReason: MethodSelectionReason | null,
): string {
  if (
    gap === "unsupported_method" &&
    assetProfile === "reit" &&
    unsupportedReason === "missing_required_input"
  ) {
    return "La empresa se clasificó como REIT. Para calcular un valor faltan AFFO común conciliado con el 10-K y NAV con NOI de los próximos doce meses, tasa de capitalización comparable y claims fechados. El método sólo admite REIT de propiedades; no hay valor calculado.";
  }

  if (
    gap === "unsupported_method" &&
    (assetProfile === "cyclical" || assetProfile === "commodity") &&
    unsupportedReason === "missing_required_input"
  ) {
    return `La empresa fue clasificada como ${assetProfile === "cyclical" ? "cíclica" : "commodity"}. Para valuarla hacen falta entre cinco y diez ejercicios comparables que representen el ciclo y supuestos de convergencia de márgenes. Esta página todavía no permite cargarlos.`;
  }

  return gap === null ? "sin resultado." : GAP_COPY[gap];
}

const TASK_COPY: Record<QualitativeTask, string> = {
  industry: "la industria",
  employeeEquity: "las opciones de empleados",
  operationsMix: "el mix geográfico de ingresos",
};

/** Por qué una tarea no dejó una decisión, sin el código como mensaje. */
function taskOutcomeCopy(step: QualitativeTaskStep): string | null {
  switch (step.status) {
    case "present":
    case "accepted":
      return null;
    case "skipped":
      return step.reason === "already_asked"
        ? "ya se preguntó por este 10-K y no hubo respuesta aceptada"
        : step.reason === "declared_by_owner"
          ? "la declaró el owner"
          : "el 10-K no trae la sección que hace falta";
    case "abstained":
      return step.reason === "ai_budget_exhausted"
        ? "el tope de gasto en IA del día está gastado"
        : "ninguna respuesta pasó la policy";
    case "stopped":
      return "la capa IA está frenada (breaker, clave, kill switch o cuota)";
    case "not_run":
      return "no se intentó porque la capa IA frenó antes";
    case "failed":
      return "la tarea no terminó";
  }
}

/**
 * Lo que la IA no resolvió, en una oración (`F6-13`). `null` cuando no hay
 * nada que agregar: no se le preguntó nada, o todo quedó aceptado.
 */
export function describeQualitativeStep(
  step: ValuationQualitativeStep | null,
): string | null {
  if (step === null) {
    return null;
  }

  const misses = QUALITATIVE_TASK_ORDER.flatMap((task) => {
    const copy = taskOutcomeCopy(step[task]);

    return copy === null ? [] : [`${TASK_COPY[task]}: ${copy}`];
  });

  return misses.length === 0 ? null : `La IA no resolvió ${misses.join("; ")}.`;
}

const PENDING_COPY: Record<DataPendingReason, string> = {
  source_busy: "otro proceso está usando la fuente",
  source_disabled: "la fuente está frenada o no tiene presupuesto declarado",
  daily_budget_exhausted: "la cuota del día de la fuente está gastada",
  source_backoff: "la fuente pidió esperar",
  job_paused: "el owner pausó la descarga",
  run_budget: "la corrida no tiene presupuesto para otra empresa",
};

export const CLAIM_COPY: Record<PointInTimeClaim, string> = {
  provenance_resolves: "una fila no llega a su documento con la misma fecha",
  availability_precedes_fetch:
    "una disponibilidad no es la aceptación del filing",
  revision_chain_ordered: "una cadena de revisiones está desordenada",
  as_known_excludes_later_revision:
    "una revisión posterior se filtra en una consulta anterior",
  restatement_changes_content: "una revisión nueva no cambia nada",
};

function formatResume(instant: string | null): string {
  if (instant === null) {
    return "";
  }

  return ` Se puede retomar desde el ${new Date(instant).toLocaleString(
    "es-AR",
    { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" },
  )} UTC.`;
}

/**
 * Lo que el paso de datos tiene para decir, en una frase: por qué una
 * descarga quedó pendiente o falló, o qué afirmación falló y sobre qué hecho.
 * `null` cuando no hay nada que agregar al gap.
 */
export function describeDataStep(
  step: ValuationDataStep | null,
): string | null {
  if (step === null) {
    return null;
  }

  if (step.audit?.status === "failed") {
    const { audit } = step;

    return `Falló: ${CLAIM_COPY[audit.claim]} (${audit.metricId} al ${audit.asOf}; ${audit.failures} ${audit.failures === 1 ? "falla" : "fallas"} en total). Se ve con pnpm gate:point-in-time.`;
  }

  const sec =
    step.fundamentals.status === "pending"
      ? step.fundamentals
      : step.sic.status === "pending"
        ? step.sic
        : null;

  if (sec !== null) {
    return `La SEC no respondió ahora: ${PENDING_COPY[sec.reason]}.${formatResume(sec.resumesAt)}`;
  }

  if (step.fundamentals.status === "failed") {
    return `Código de la fuente: ${step.fundamentals.code}.`;
  }

  return null;
}

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
  financial_base_unavailable:
    "faltan patrimonio y utilidad comunes comparables, o el ROE no es admisible",
  financial_base_stale: "el patrimonio común reportado tiene más de 540 días",
  financial_declaration_missing:
    "esta corrida anterior no tiene distribución; volvé a valuar para obtenerla automáticamente del 10-K",
  financial_filing_evidence_missing:
    "el 10-K no ofrece tablas conciliables de distribución y diagnóstico financiero",
  growth_revenue_history_unavailable:
    "faltan cuatro cierres anuales positivos y consecutivos, o el crecimiento medido queda por debajo del terminal",
  growth_margin_unavailable:
    "falta un margen operativo ajustado válido de la industria al corte",
  growth_tax_note_missing:
    "falta una nota fiscal del 10-K conciliable al cierre base",
  growth_tax_jurisdictions_not_reconciled:
    "la nota fiscal separa pérdidas entre jurisdicciones y no permite un único saldo utilizable",
  growth_tax_pool_not_reconciled:
    "la nota fiscal no concilia monto, vencimiento y límite anual de compensación",
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
