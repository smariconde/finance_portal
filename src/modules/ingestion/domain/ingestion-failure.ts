import { z } from "zod";

/**
 * Códigos cerrados de fallo de ingesta. Una causa desconocida cae en
 * `unknown_error` con `retryable=false`: nunca se infiere que algo es seguro de
 * reintentar por descarte (`TM-11`).
 */
export const ingestionFailureCodeSchema = z.enum([
  "source_not_registered",
  "dataset_not_registered",
  "rights_not_approved",
  "provider_error",
  "provider_contract_invalid",
  "unknown_error",
]);

export type IngestionFailureCode = z.infer<typeof ingestionFailureCodeSchema>;

export const MAX_FAILURE_MESSAGE_LENGTH = 240;

export const ingestionFailureSchema = z.object({
  code: ingestionFailureCodeSchema,
  message: z.string().trim().min(1).max(MAX_FAILURE_MESSAGE_LENGTH),
  retryable: z.boolean(),
});

export type IngestionFailure = z.infer<typeof ingestionFailureSchema>;

const RETRYABLE_CODES: ReadonlySet<IngestionFailureCode> = new Set([
  "provider_error",
]);

const REDACTION = "[redacted]";

/**
 * Patrones de redacción aplicados antes de persistir o loguear un mensaje.
 * El objetivo de `TM-02` es que ninguna key, credencial de conexión ni token
 * llegue a `ingestion_runs`, a un log o a un DTO de UI.
 */
const REDACTION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Credenciales embebidas en una connection string o URL.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, `$1${REDACTION}@`],
  // Pares clave/valor sensibles en texto libre o query strings.
  [
    /\b(api[_-]?key|apikey|access[_-]?key|secret|token|password|passwd|pwd|authorization|auth|bearer|signature|sig)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/giu,
    `$1=${REDACTION}`,
  ],
  // Cualquier literal largo sin espacios: la forma típica de una key filtrada.
  [/\b[A-Za-z0-9_\-]{24,}\b/gu, REDACTION],
];

export function redactFailureMessage(message: string): string {
  const collapsed = message.replace(/\s+/gu, " ").trim();
  const redacted = REDACTION_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    collapsed,
  );

  if (redacted.length === 0) {
    return "Error sin mensaje utilizable.";
  }

  return redacted.length > MAX_FAILURE_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_FAILURE_MESSAGE_LENGTH - 1)}…`
    : redacted;
}

/**
 * Convierte cualquier causa en un fallo persistible. Sólo se conserva el
 * mensaje redactado: nunca el stack, la causa anidada ni el objeto original.
 */
export function toSafeIngestionFailure(
  code: IngestionFailureCode,
  cause: unknown,
): IngestionFailure {
  const rawMessage =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "";

  return ingestionFailureSchema.parse({
    code,
    message: redactFailureMessage(rawMessage),
    retryable: RETRYABLE_CODES.has(code),
  });
}
