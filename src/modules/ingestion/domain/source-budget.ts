import { z } from "zod";

import { utcTimestampSchema } from "@/modules/temporal/domain/temporal-version";

import { sourceIdSchema } from "./source-registry-entry";

/**
 * Presupuesto diario y kill switch por fuente (ADR 0020).
 *
 * El presupuesto por corrida de `egress-fetch.ts` acota **un proceso**: cada
 * comando arranca con su techo entero, así que dos seguidos son dos techos y
 * nada acota un día. Lo que se protege acá es la cuota de la fuente, que es de
 * la fuente y no del proceso (`TM-10`), y por eso el contador vive en
 * PostgreSQL y lo comparten el backfill y los comandos manuales.
 *
 * Son dos controles distintos a propósito:
 *
 * - el **presupuesto** responde «¿cuántas llamadas más tolera hoy?» y se repone
 *   solo al cambiar el día;
 * - el **kill switch** responde «¿se puede hablar con esta fuente?» y sólo lo
 *   cambia el owner.
 *
 * Ninguno reemplaza al otro: agotar el día es una condición que pasa, y frenar
 * una fuente es una decisión que se toma.
 */
export const SOURCE_BUDGET_POLICY_VERSION = "source-budget-1.0.0";

/**
 * Topes diarios declarados, de la matriz de cuotas
 * (`docs/data/provider-use-matrix.md`). Son hard caps internos, no metas: el de
 * la SEC cubre un barrido del universo medido en 1.194 requests más el trabajo
 * manual del mismo día, y subirlo es un diff revisable.
 *
 * Una fuente que no figura acá no tiene presupuesto y se niega. La allowlist de
 * egress concede alcanzabilidad; el presupuesto concede cuota, y ninguno de los
 * dos se deduce del otro.
 */
export const SOURCE_DAILY_REQUEST_BUDGETS: Readonly<Record<string, number>> =
  Object.freeze({
    "sec-edgar": 2000,
    "datahub-sp500-pddl": 10,
    // Una request por security para cinco años. El tope cubre el universo
    // entero (503) más margen de reintentos en el mismo día, y Yahoo no publica
    // cuota, así que el número es una decisión de prudencia nuestra y no el eco
    // de un límite publicado (ADR 0026).
    "yahoo-finance": 700,
    // Una request por emisor trae su registro entero (ADR 0027). Diez por día
    // cubren varias corridas de prueba y dejan fuera cualquier bucle.
    "comafi-cedear": 10,
    "caja-valores-cedear": 10,
  });

/** Tabla de topes declarados. Los tests inyectan la suya; el runtime usa la de arriba. */
export type DeclaredDailyBudgets = Readonly<Record<string, number>>;

export function declaredDailyBudget(
  sourceId: string,
  budgets: DeclaredDailyBudgets = SOURCE_DAILY_REQUEST_BUDGETS,
): number | null {
  return budgets[sourceId] ?? null;
}

export const sourceControlStatusSchema = z.enum(["enabled", "disabled"]);

export type SourceControlStatus = z.infer<typeof sourceControlStatusSchema>;

const actorSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._:@/-]{1,128}$/u);

const reasonSchema = z.string().trim().min(3).max(240);

/**
 * Estado operativo vigente de una fuente. Append-only con `superseded_at`: el
 * estado actual es la fila abierta y las anteriores son la historia de quién
 * cambió qué y por qué (`TM-16`).
 *
 * No vive en `source_registry` porque esa tabla es un documento **declarado** que
 * `syncDeclaredSourceRegistry` reescribe desde la constante del código: una
 * decisión operativa ahí duraría hasta el próximo comando.
 */
export const sourceControlSchema = z
  .object({
    controlId: z.uuid(),
    sourceId: sourceIdSchema,
    status: sourceControlStatusSchema,
    /**
     * Tope operativo del día. Sólo puede **bajar** el declarado en código: subir
     * la cuota es un cambio revisable, no una palanca de runtime.
     */
    dailyRequestLimit: z.number().int().min(0).max(1_000_000).nullable(),
    reason: reasonSchema,
    actor: actorSchema,
    recordedAt: utcTimestampSchema,
    supersededAt: utcTimestampSchema.nullable(),
  })
  .superRefine((control, context) => {
    if (
      control.supersededAt !== null &&
      Date.parse(control.supersededAt) < Date.parse(control.recordedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["supersededAt"],
        message: "supersededAt must not precede recordedAt.",
      });
    }
  });

export type SourceControl = z.infer<typeof sourceControlSchema>;

/** Día del presupuesto: fecha UTC. El reloj llega inyectado, nunca `Date.now()`. */
export function budgetDayOf(instant: string): string {
  const at = Date.parse(instant);

  if (Number.isNaN(at)) {
    throw new TypeError("A budget day needs a valid instant.");
  }

  return new Date(at).toISOString().slice(0, 10);
}

/** Instante en que el presupuesto se repone: las 00:00Z del día siguiente. */
export function nextBudgetDayStart(instant: string): string {
  const at = Date.parse(instant);

  if (Number.isNaN(at)) {
    throw new TypeError("A budget day needs a valid instant.");
  }

  const midnight = Date.UTC(
    new Date(at).getUTCFullYear(),
    new Date(at).getUTCMonth(),
    new Date(at).getUTCDate() + 1,
  );

  return new Date(midnight).toISOString();
}

/**
 * Tope que rige hoy. Una fuente deshabilitada tiene tope cero, y una sin
 * presupuesto declarado no tiene tope alguno: las dos se niegan, por motivos
 * distintos que el veredicto distingue.
 */
export function resolveEffectiveDailyLimit(
  sourceId: string,
  control: SourceControl | null,
  budgets: DeclaredDailyBudgets = SOURCE_DAILY_REQUEST_BUDGETS,
): number | null {
  const declared = declaredDailyBudget(sourceId, budgets);

  if (declared === null) {
    return null;
  }

  if (control?.status === "disabled") {
    return 0;
  }

  const requested = control?.dailyRequestLimit;

  return requested === undefined || requested === null
    ? declared
    : Math.min(declared, requested);
}

export const sourceBudgetStateSchema = z.object({
  sourceId: sourceIdSchema,
  /** Fecha UTC del contador. */
  day: z.iso.date(),
  used: z.number().int().min(0),
  declaredLimit: z.number().int().min(0).nullable(),
  effectiveLimit: z.number().int().min(0).nullable(),
  control: sourceControlSchema.nullable(),
});

export type SourceBudgetState = z.infer<typeof sourceBudgetStateSchema>;

export type SourceRequestVerdict =
  | {
      readonly status: "allowed";
      readonly used: number;
      readonly remaining: number;
    }
  /** El owner frenó la fuente. */
  | { readonly status: "source_disabled"; readonly reason: string }
  /** La fuente no tiene presupuesto declarado: fail closed. */
  | { readonly status: "budget_undeclared" }
  | {
      readonly status: "daily_budget_exhausted";
      readonly limit: number;
      readonly used: number;
      /** Cuándo se repone el contador. */
      readonly resumesAt: string;
    };

/**
 * Si el presupuesto cubre `requests` llamadas más. Con 1 responde por la próxima
 * llamada; con el peor caso de una empresa, por la reserva que el backfill hace
 * antes de empezarla.
 *
 * Es una decisión pura sobre un estado ya leído. El consumo real lo hace el
 * almacén en una sola sentencia atómica: entre esta lectura y esa escritura
 * puede pasar otro proceso, y el que decide es el almacén.
 */
export function admitSourceRequests(
  state: SourceBudgetState,
  requests: number,
  now: string,
): SourceRequestVerdict {
  if (state.control?.status === "disabled") {
    return { status: "source_disabled", reason: state.control.reason };
  }

  if (state.declaredLimit === null || state.effectiveLimit === null) {
    return { status: "budget_undeclared" };
  }

  const remaining = state.effectiveLimit - state.used;

  return remaining >= requests
    ? { status: "allowed", used: state.used, remaining }
    : {
        status: "daily_budget_exhausted",
        limit: state.effectiveLimit,
        used: state.used,
        resumesAt: nextBudgetDayStart(now),
      };
}

/** Mensaje estable de una negativa, el mismo en el error y en un comando. */
export function describeSourceRefusal(
  sourceId: string,
  verdict: Exclude<SourceRequestVerdict, { status: "allowed" }>,
): string {
  switch (verdict.status) {
    case "source_disabled":
      return `Source ${sourceId} is disabled: ${verdict.reason}.`;
    case "budget_undeclared":
      return `Source ${sourceId} has no declared daily request budget.`;
    case "daily_budget_exhausted":
      return `The daily budget of ${verdict.limit} requests for ${sourceId} is spent (${verdict.used} used); it resets at ${verdict.resumesAt}.`;
  }
}

/** Una salida que el presupuesto o el kill switch negaron, con su código. */
export class SourceRequestRefusedError extends Error {
  readonly sourceId: string;
  readonly code: Exclude<SourceRequestVerdict["status"], "allowed">;
  /** Cuándo se repone el contador; `null` si no es cuestión de esperar. */
  readonly resumesAt: string | null;

  constructor(
    sourceId: string,
    verdict: Exclude<SourceRequestVerdict, { status: "allowed" }>,
  ) {
    super(describeSourceRefusal(sourceId, verdict));
    this.name = "SourceRequestRefusedError";
    this.sourceId = sourceId;
    this.code = verdict.status;
    this.resumesAt =
      verdict.status === "daily_budget_exhausted" ? verdict.resumesAt : null;
  }
}
