import { z } from "zod";

import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";
import type { SourceControl } from "@/modules/ingestion/domain/source-budget";
import { utcTimestampSchema } from "@/modules/temporal/domain/temporal-version";

/**
 * Presupuesto en dólares de la capa IA
 * ([ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md),
 * decisión 4).
 *
 * Contar requests no acota el gasto de un modelo: una llamada puede costar diez
 * veces otra. Por eso, además del tope diario de requests de la ADR 0020, cada
 * llamada **reserva** su peor caso antes de salir y lo **liquida** después con
 * el costo que informa el proveedor. Las mismas reglas que el contador de
 * requests: el tope vive en código, un control guardado sólo puede bajarlo, y
 * el almacén decide atómicamente.
 *
 * Los importes son **nanodólares enteros** (USD × 10⁹). Los precios de la
 * escalera son enteros en esa unidad —USD 0,60 por millón de tokens son 600
 * nanodólares por token—, así que el peor caso se calcula sin un solo decimal
 * y el contador de PostgreSQL es un `bigint`.
 */
export const AI_SPEND_POLICY_VERSION = "ai-spend-1.0.0";

export const NANO_USD_PER_USD = 1_000_000_000;

export const nanoUsdSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

export type AiSpendLimits = {
  /** Lo que puede gastar una tarea entera, con todos sus intentos. */
  readonly perTaskNanoUsd: number;
  /** Lo que puede gastar la fuente en un día UTC. */
  readonly perDayNanoUsd: number;
};

/**
 * Topes declarados: USD 0,10 por tarea y USD 1,00 por día UTC. Subirlos es un
 * diff revisable. Una fuente que no figura acá no tiene presupuesto en dólares
 * y no reserva nada: fail closed, como la tabla de requests.
 */
export const AI_SPEND_LIMITS: Readonly<Record<string, AiSpendLimits>> =
  Object.freeze({
    openrouter: Object.freeze({
      perTaskNanoUsd: 100_000_000,
      perDayNanoUsd: 1_000_000_000,
    }),
  });

export type DeclaredSpendLimits = Readonly<Record<string, AiSpendLimits>>;

export function declaredSpendLimits(
  sourceId: string,
  limits: DeclaredSpendLimits = AI_SPEND_LIMITS,
): AiSpendLimits | null {
  return limits[sourceId] ?? null;
}

/**
 * Tope diario que rige hoy: el declarado, o el que el owner guardó si es menor.
 * Una fuente frenada no reserva nada, pero eso lo dice el veredicto con su
 * propio código, no un tope cero.
 */
export function resolveEffectiveDailySpendLimit(
  declared: AiSpendLimits,
  control: SourceControl | null,
): number {
  const requested = control?.dailySpendLimitNanoUsd;

  return requested === undefined || requested === null
    ? declared.perDayNanoUsd
    : Math.min(declared.perDayNanoUsd, requested);
}

/**
 * Convierte el costo que informa el proveedor, en USD como número JSON, a
 * nanodólares. Redondea **hacia arriba**: un error de representación nunca
 * puede hacer que el libro registre menos de lo cobrado.
 */
export function providerCostToNanoUsd(costUsd: number): number | null {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    return null;
  }

  // `0.1 * 1e9` es `100000000.00000001` en doble precisión: se corrige el
  // ruido de la representación antes de redondear hacia arriba, para no
  // cobrar un nanodólar por un error del formato.
  const scaled = Number((costUsd * NANO_USD_PER_USD).toPrecision(15));

  return Math.ceil(scaled);
}

/** Presentación de un importe: USD con nueve decimales, sin pasar por un `double`. */
export function formatNanoUsd(nanoUsd: number): string {
  const whole = Math.floor(nanoUsd / NANO_USD_PER_USD);
  const fraction = String(nanoUsd % NANO_USD_PER_USD).padStart(9, "0");

  return `${whole}.${fraction}`;
}

/** Interpreta un importe escrito por el owner (`0.50`) como nanodólares exactos. */
export function parseUsdToNanoUsd(text: string): number | null {
  const match = /^(0|[1-9][0-9]{0,5})(?:\.([0-9]{1,9}))?$/u.exec(text.trim());

  if (match === null) {
    return null;
  }

  return (
    Number(match[1]) * NANO_USD_PER_USD +
    Number((match[2] ?? "").padEnd(9, "0"))
  );
}

/**
 * Cómo terminó una reserva.
 *
 * - `reserved`: la llamada está en vuelo, o el proceso murió con ella en vuelo.
 *   Cuenta por su peor caso: nadie sabe si se cobró.
 * - `charged`: el proveedor respondió e informó el costo; cuenta eso.
 * - `uncharged`: no salió nada, o el proveedor contestó con un error que no
 *   cobra; cuenta cero.
 * - `unsettled`: se cortó el transporte con la llamada en curso. Pudo haberse
 *   cobrado, así que sigue contando el peor caso.
 */
export const aiSpendStatusSchema = z.enum([
  "reserved",
  "charged",
  "uncharged",
  "unsettled",
]);

export type AiSpendStatus = z.infer<typeof aiSpendStatusSchema>;

/** Lo que una fila cuenta contra los topes. */
export function countedNanoUsd(entry: {
  readonly status: AiSpendStatus;
  readonly reservedNanoUsd: number;
  readonly chargedNanoUsd: number | null;
}): number {
  switch (entry.status) {
    case "charged":
      return entry.chargedNanoUsd ?? entry.reservedNanoUsd;
    case "uncharged":
      return 0;
    case "reserved":
    case "unsettled":
      return entry.reservedNanoUsd;
  }
}

const versionSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-\d+\.\d+\.\d+$/u);

export const modelIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9.:_-]*$/u)
  .max(128);

/**
 * Para qué se llamó al modelo (`F5-07`,
 * [ADR 0035](../../../../docs/architecture/adr/0035-ai-layer-evals.md),
 * decisión 6). Un eval gasta contra los mismos topes que una tarea, pero sus
 * intentos —inyecciones hechas a propósito incluidas— no son la métrica de
 * producción.
 */
export const aiSpendPurposeSchema = z.enum(["task", "eval"]);

export type AiSpendPurpose = z.infer<typeof aiSpendPurposeSchema>;

export const aiSpendReservationRequestSchema = z.object({
  reservationId: z.uuid(),
  purpose: aiSpendPurposeSchema,
  sourceId: sourceIdSchema,
  taskRunId: z.uuid(),
  taskVersion: versionSchema,
  ladderVersion: versionSchema,
  rung: z.number().int().min(1).max(16),
  requestedModel: modelIdSchema,
  worstCaseNanoUsd: nanoUsdSchema.min(1),
  now: utcTimestampSchema,
});

export type AiSpendReservationRequest = z.infer<
  typeof aiSpendReservationRequestSchema
>;

/** Código cerrado del motivo con que termina un intento (`TM-16`). */
export const aiAttemptOutcomeSchema = z.enum([
  "accepted",
  "abstained",
  "schema_invalid",
  "policy_rejected",
  "transport_error",
  "provider_throttled",
  "provider_unavailable",
  "provider_rejected",
  "provider_unauthorized",
  "response_unreadable",
  "egress_refused",
]);

export type AiAttemptOutcome = z.infer<typeof aiAttemptOutcomeSchema>;

export const aiSpendSettlementSchema = z
  .object({
    reservationId: z.uuid(),
    status: aiSpendStatusSchema.exclude(["reserved"]),
    chargedNanoUsd: nanoUsdSchema.nullable(),
    respondedModel: modelIdSchema.nullable(),
    promptTokens: z.number().int().min(0).nullable(),
    completionTokens: z.number().int().min(0).nullable(),
    latencyMs: z.number().int().min(0).nullable(),
    outcome: aiAttemptOutcomeSchema,
    now: utcTimestampSchema,
  })
  .superRefine((settlement, context) => {
    if (
      (settlement.status === "charged") !==
      (settlement.chargedNanoUsd !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["chargedNanoUsd"],
        message: "A charge is recorded exactly when the status is charged.",
      });
    }
  });

export type AiSpendSettlement = z.infer<typeof aiSpendSettlementSchema>;

export type AiSpendVerdict =
  | {
      readonly status: "reserved";
      readonly reservationId: string;
      readonly taskSpentNanoUsd: number;
      readonly daySpentNanoUsd: number;
    }
  /** El owner frenó la fuente: no se reserva nada. */
  | { readonly status: "source_disabled"; readonly reason: string }
  /** La fuente no tiene tope en dólares declarado: fail closed. */
  | { readonly status: "spend_undeclared" }
  | {
      readonly status: "task_budget_exhausted";
      readonly limitNanoUsd: number;
      readonly spentNanoUsd: number;
      readonly requestedNanoUsd: number;
    }
  | {
      readonly status: "daily_budget_exhausted";
      readonly limitNanoUsd: number;
      readonly spentNanoUsd: number;
      readonly requestedNanoUsd: number;
      readonly resumesAt: string;
    };

/**
 * Decisión pura sobre lo ya gastado. El almacén la llama con los totales que
 * leyó **dentro** de su transacción: entre una lectura afuera y la escritura
 * podría haber pasado otro proceso.
 */
export function admitAiSpend(input: {
  readonly limits: AiSpendLimits | null;
  readonly control: SourceControl | null;
  readonly taskSpentNanoUsd: number;
  readonly daySpentNanoUsd: number;
  readonly worstCaseNanoUsd: number;
  readonly resumesAt: string;
}): Exclude<AiSpendVerdict, { status: "reserved" }> | null {
  if (input.control?.status === "disabled") {
    return { status: "source_disabled", reason: input.control.reason };
  }

  if (input.limits === null) {
    return { status: "spend_undeclared" };
  }

  if (
    input.taskSpentNanoUsd + input.worstCaseNanoUsd >
    input.limits.perTaskNanoUsd
  ) {
    return {
      status: "task_budget_exhausted",
      limitNanoUsd: input.limits.perTaskNanoUsd,
      spentNanoUsd: input.taskSpentNanoUsd,
      requestedNanoUsd: input.worstCaseNanoUsd,
    };
  }

  const dayLimit = resolveEffectiveDailySpendLimit(input.limits, input.control);

  if (input.daySpentNanoUsd + input.worstCaseNanoUsd > dayLimit) {
    return {
      status: "daily_budget_exhausted",
      limitNanoUsd: dayLimit,
      spentNanoUsd: input.daySpentNanoUsd,
      requestedNanoUsd: input.worstCaseNanoUsd,
      resumesAt: input.resumesAt,
    };
  }

  return null;
}

/** Una fila del libro: un intento, con lo que reservó y lo que se le cobró. */
export type AiSpendEntry = {
  readonly reservationId: string;
  readonly sourceId: string;
  readonly taskRunId: string;
  readonly purpose: AiSpendPurpose;
  readonly taskVersion: string;
  readonly ladderVersion: string;
  readonly rung: number;
  readonly requestedModel: string;
  readonly respondedModel: string | null;
  readonly day: string;
  readonly status: AiSpendStatus;
  readonly reservedNanoUsd: number;
  readonly chargedNanoUsd: number | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly latencyMs: number | null;
  readonly outcome: AiAttemptOutcome | null;
  readonly reservedAt: string;
  readonly settledAt: string | null;
};

export type AiSpendDayState = {
  readonly sourceId: string;
  readonly day: string;
  readonly declared: AiSpendLimits | null;
  readonly effectiveDailyLimitNanoUsd: number | null;
  /** Lo que cuenta contra el tope: cobrado más reservas abiertas o inciertas. */
  readonly countedNanoUsd: number;
  /** Sólo lo que el proveedor informó como cobrado. */
  readonly chargedNanoUsd: number;
  readonly attempts: number;
  readonly openReservations: number;
};
