/**
 * Errores obligatorios del contrato point-in-time
 * (`docs/data/point-in-time-contract.md`). Son códigos estables y auditables:
 * la superficie que los reciba decide cómo mostrarlos, pero nunca los convierte
 * en un valor por defecto silencioso.
 */
export const TEMPORAL_ERROR_CODES = [
  "invalid_temporal_interval",
  "future_knowledge",
  "overlapping_effective_versions",
  "ambiguous_revision",
  "missing_availability",
  "currency_or_unit_mismatch",
  "ambiguous_identity",
  "unsupported_revision_policy",
] as const;

export type TemporalErrorCode = (typeof TEMPORAL_ERROR_CODES)[number];

export class TemporalContractError extends Error {
  readonly code: TemporalErrorCode;
  /** Sólo identificadores internos y rutas de campo: nunca valores (`TM-02`). */
  readonly subjects: readonly string[];

  constructor(
    code: TemporalErrorCode,
    message: string,
    subjects: readonly string[] = [],
  ) {
    super(message);
    this.name = "TemporalContractError";
    this.code = code;
    this.subjects = [...subjects];
  }
}

export function isTemporalContractError(
  error: unknown,
  code?: TemporalErrorCode,
): error is TemporalContractError {
  return (
    error instanceof TemporalContractError &&
    (code === undefined || error.code === code)
  );
}
