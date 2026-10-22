import { z } from "zod";

import {
  pointInTimeClaimSchema,
  type PointInTimeClaim,
} from "@/modules/observations/domain/point-in-time-audit";
import { utcTimestampSchema } from "@/modules/temporal/domain/temporal-version";

/**
 * Lo que la corrida bajó antes de valuar y lo que auditó (`F6-05`,
 * [ADR 0051](../../../../docs/architecture/adr/0051-on-demand-valuation-data.md)).
 *
 * `valuation-data-1.0.0` nombra tres partes —fundamentals, SIC y precio— y
 * registra la auditoría point-in-time del sujeto. Es un registro, no un plan:
 * cada parte dice qué encontró el job y qué hizo. Nada de este archivo lee un
 * reloj ni sale a la red.
 */
export const VALUATION_DATA_RULE_VERSION = "valuation-data-1.0.0";

/** La regla de la referencia de la ADR 0030 aplicada a una security. */
export const TICKER_PRICE_FRESHNESS_VERSION = "ticker-price-freshness-1.0.0";

/**
 * Por qué una descarga no terminó ahora. El job de ingesta queda abierto y el
 * próximo pedido lo retoma.
 */
export const dataPendingReasonSchema = z.enum([
  /** Otro proceso tiene el lease de la fuente. */
  "source_busy",
  /** El owner frenó la fuente, o no tiene presupuesto declarado. */
  "source_disabled",
  /** La cuota del día está gastada. */
  "daily_budget_exhausted",
  /** La fuente pidió esperar más de lo que se espera en línea. */
  "source_backoff",
  /** El owner pausó el job de ingesta. */
  "job_paused",
  /** El presupuesto de la corrida no cubre el peor caso de un item. */
  "run_budget",
]);

export type DataPendingReason = z.infer<typeof dataPendingReasonSchema>;

const failureCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);

const pendingSchema = z.object({
  status: z.literal("pending"),
  reason: dataPendingReasonSchema,
  /** Cuándo se puede volver a intentar, si la fuente lo dijo. */
  resumesAt: utcTimestampSchema.nullable(),
});

export const fundamentalsStepSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("present") }),
  /** Un job que continúa a otro no baja: la ventana sigue faltando. */
  z.object({ status: z.literal("missing") }),
  z.object({
    status: z.literal("ingested"),
    /** El CIK pedido y sus antecesores de reporte. */
    filers: z.number().int().min(1),
    /**
     * La ventana estaba, pero bajada con una selección de conceptos anterior a
     * la vigente (`F6-14`, ADR 0053). Ausente: faltaba la ventana entera.
     */
    selectionOutdated: z.literal(true).optional(),
  }),
  pendingSchema,
  z.object({ status: z.literal("failed"), code: failureCodeSchema }),
]);

export type FundamentalsStep = z.infer<typeof fundamentalsStepSchema>;

export const sicStepSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("present") }),
  z.object({ status: z.literal("missing") }),
  z.object({
    status: z.literal("observed"),
    code: z.string().regex(/^\d{4}$/u),
  }),
  /** `submissions` no publica SIC para el filer: la evaluación se abstiene. */
  z.object({ status: z.literal("not_published") }),
  pendingSchema,
]);

export type SicStep = z.infer<typeof sicStepSchema>;

const marketDateSchema = z.iso.date();

export const pricesStepSchema = z.discriminatedUnion("status", [
  /** Sin security no hay serie que pedir. */
  z.object({ status: z.literal("not_applicable") }),
  z.object({
    status: z.literal("current"),
    latestClose: marketDateSchema.nullable(),
  }),
  z.object({
    status: z.literal("missing"),
    latestClose: marketDateSchema.nullable(),
  }),
  z.object({ status: z.literal("ingested") }),
  pendingSchema,
  z.object({ status: z.literal("failed"), code: failureCodeSchema }),
]);

export type PricesStep = z.infer<typeof pricesStepSchema>;

export const auditStepSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("passed"),
    chains: z.number().int().min(0),
    /** Afirmaciones sin ninguna evaluación: no bloquean, pero no pasaron. */
    notExercised: z.array(pointInTimeClaimSchema),
  }),
  z.object({
    status: z.literal("failed"),
    chains: z.number().int().min(0),
    failures: z.number().int().min(1),
    /** El primer hallazgo: qué afirmación y sobre qué hecho. */
    claim: pointInTimeClaimSchema,
    metricId: z.string().min(1).max(256),
    asOf: marketDateSchema,
  }),
]);

export type AuditStep = z.infer<typeof auditStepSchema>;

export const valuationDataStepSchema = z.object({
  ruleVersion: z.literal(VALUATION_DATA_RULE_VERSION),
  fundamentals: fundamentalsStepSchema,
  sic: sicStepSchema,
  prices: pricesStepSchema,
  /** `null` cuando el job no llegó a auditar porque una descarga quedó pendiente o falló. */
  audit: auditStepSchema.nullable(),
});

export type ValuationDataStep = z.infer<typeof valuationDataStepSchema>;

/** Si el job bajó algo, el siguiente valúa con un corte que lo ve. */
export function dataStepIngested(step: ValuationDataStep): boolean {
  return (
    step.fundamentals.status === "ingested" ||
    step.sic.status === "observed" ||
    step.prices.status === "ingested"
  );
}

/**
 * La parte que impide valuar ahora. Los precios nunca bloquean: sin el cierre
 * del día la comparación con el mercado lo nombra.
 */
export function dataStepBlock(
  step: Pick<ValuationDataStep, "fundamentals" | "sic">,
): "ingestion_pending" | "ingestion_failed" | null {
  if (step.fundamentals.status === "failed") {
    return "ingestion_failed";
  }

  if (step.fundamentals.status === "pending" || step.sic.status === "pending") {
    return "ingestion_pending";
  }

  return null;
}

/**
 * La auditoría del sujeto como registro del job. Una afirmación que falló
 * bloquea con su primer hallazgo; una sin ejercer no bloquea.
 */
export function auditStepFromReport(report: {
  readonly chains: number;
  readonly verdicts: readonly {
    readonly claim: PointInTimeClaim;
    readonly status: "pass" | "fail" | "not_exercised";
    readonly failed: number;
  }[];
  readonly findings: readonly {
    readonly claim: PointInTimeClaim;
    readonly metricId: string;
    readonly asOf: string;
  }[];
}): AuditStep {
  const failures = report.verdicts.reduce(
    (total, verdict) => total + verdict.failed,
    0,
  );
  const [first] = report.findings;

  if (failures === 0) {
    return {
      status: "passed",
      chains: report.chains,
      notExercised: report.verdicts
        .filter((verdict) => verdict.status === "not_exercised")
        .map((verdict) => verdict.claim),
    };
  }

  if (first === undefined) {
    throw new Error("A failed audit keeps at least one finding.");
  }

  return auditStepSchema.parse({
    status: "failed",
    chains: report.chains,
    failures,
    claim: first.claim,
    metricId: first.metricId,
    asOf: first.asOf.slice(0, 10),
  });
}
