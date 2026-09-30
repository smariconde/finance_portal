import type { DecimalErrorCode } from "@/modules/numeric/domain/decimal-policy";

/**
 * Una entrada que viola el contrato de una fórmula de métricas. No es un `null`
 * con motivo —eso es un dato que falta y se declara en el resultado—, sino una
 * serie que no debería haber llegado así: dos cierres para la misma rueda o un
 * número que no es un decimal canónico.
 */
export type MetricInputErrorCode =
  DecimalErrorCode | "duplicate_market_date" | "invalid_split_ratio";

export class MetricInputError extends Error {
  readonly code: MetricInputErrorCode;
  readonly subjects: readonly string[];

  constructor(
    code: MetricInputErrorCode,
    message: string,
    subjects: readonly string[] = [],
  ) {
    super(message);
    this.name = "MetricInputError";
    this.code = code;
    this.subjects = subjects;
  }
}
