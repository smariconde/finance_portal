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
 *
 * `valuation-data-1.1.0` (`F6-44`) suma `filings`: con la ventana guardada, el
 * job sondea `submissions` y vuelve a bajar companyfacts si el filer presentó
 * algo después (el refresh de la ADR 0022).
 */
export const VALUATION_DATA_RULE_VERSION = "valuation-data-1.1.0";
/**
 * `valuation-data-1.2.0` (`F6-55`, ADR 0087) suma `currencyMarket` para un
 * emisor que reporta en otra moneda que el USD: la curva soberana de esa moneda
 * (`risk-free-freshness-1.0.0`) y el tipo de cambio al dólar. Nunca bloquea:
 * sin curva, el costo de capital lo nombra; sin cambio, la comparación con el
 * precio. Sólo un paso con esa parte lleva `1.2.0`.
 */
export const VALUATION_DATA_CURRENCY_RULE_VERSION = "valuation-data-1.2.0";

/** Las versiones que un `data_step` guardado puede traer. */
export const VALUATION_DATA_RULE_VERSIONS = [
  "valuation-data-1.0.0",
  VALUATION_DATA_RULE_VERSION,
  VALUATION_DATA_CURRENCY_RULE_VERSION,
] as const;

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

/** El 10-K o 10-Q más nuevo que el sondeo vio en `submissions`. */
export const periodicFilingSchema = z.object({
  form: z.enum(["10-K", "10-Q", "10-KT", "10-QT"]),
  acceptedAt: utcTimestampSchema,
  accessionNumber: z.string().regex(/^\d{10}-\d{2}-\d{6}$/u),
});

export type PeriodicFiling = z.infer<typeof periodicFilingSchema>;

/**
 * Lo presentado después de la última descarga (`F6-44`). Nunca bloquea: con la
 * ventana guardada, una SEC que no responde se nombra y se valúa con lo que hay.
 */
export const filingsStepSchema = z.discriminatedUnion("status", [
  /** Sondeado y sin nada nuevo, o la descarga no publicó ningún hecho. */
  z.object({
    status: z.literal("current"),
    latest: periodicFilingSchema.nullable(),
  }),
  /** Había algo nuevo y la descarga publicó: el siguiente valúa con un corte que lo ve. */
  z.object({
    status: z.literal("refreshed"),
    reason: z.enum(["new_filing", "never_probed", "form_selection_superseded"]),
    latest: periodicFilingSchema.nullable(),
  }),
  /**
   * La SEC aceptó un 10-K o 10-Q que companyfacts todavía no trae: la marca no
   * se movió y la próxima valuación vuelve a mirar.
   */
  z.object({
    status: z.literal("not_in_companyfacts"),
    latest: periodicFilingSchema,
  }),
  pendingSchema,
  z.object({ status: z.literal("failed"), code: failureCodeSchema }),
]);

export type FilingsStep = z.infer<typeof filingsStepSchema>;

/**
 * El consenso de analistas (`F6-39`, ADR 0085), con la regla de la página
 * (`consensus-freshness-1.0.0`). Nunca bloquea: sin él la derivación usa la
 * historia y lo nombra.
 */
export const consensusStepSchema = z.discriminatedUnion("status", [
  /** Ya había una captura de hoy (o un chequeo fallido de hoy). */
  z.object({ status: z.literal("current") }),
  /** Este job lo capturó: el siguiente valúa con un corte que lo ve. */
  z.object({ status: z.literal("captured") }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.enum([
      "source_disabled",
      "daily_budget_exhausted",
      "budget_undeclared",
      "credential_missing",
      "job_paused",
      "source_busy",
      "failed",
    ]),
  }),
]);

export type ConsensusStep = z.infer<typeof consensusStepSchema>;

const currencyMarketUnavailableSchema = z.object({
  status: z.literal("unavailable"),
  reason: z.enum([
    /** No hay curva o par declarado para la moneda. */
    "not_declared",
    "source_disabled",
    "daily_budget_exhausted",
    "source_busy",
    "source_backoff",
    "job_paused",
    "run_budget",
    "failed",
  ]),
});

/** La curva y el tipo de cambio de una corrida en otra moneda (`1.2.0`). */
export const currencyMarketStepSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/u),
  riskFree: z.discriminatedUnion("status", [
    z.object({ status: z.literal("current") }),
    /** Este job registró una release nueva: el siguiente la ve. */
    z.object({ status: z.literal("recorded") }),
    currencyMarketUnavailableSchema,
  ]),
  fx: z.discriminatedUnion("status", [
    z.object({ status: z.literal("current") }),
    z.object({ status: z.literal("ingested") }),
    currencyMarketUnavailableSchema,
  ]),
});

export type CurrencyMarketStep = z.infer<typeof currencyMarketStepSchema>;

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
  ruleVersion: z.enum(VALUATION_DATA_RULE_VERSIONS),
  fundamentals: fundamentalsStepSchema,
  /**
   * Opcional: los jobs de `1.0.0` no lo tienen, y un job que continúa a otro
   * o que acaba de bajar la ventana no sondea.
   */
  filings: filingsStepSchema.optional(),
  sic: sicStepSchema,
  prices: pricesStepSchema,
  /**
   * Opcional: los jobs anteriores a `F6-39` no lo tienen, y un job que
   * continúa a otro no lo pide.
   */
  consensus: consensusStepSchema.optional(),
  /** Sólo en `1.2.0`: la curva y el cambio de una corrida en otra moneda. */
  currencyMarket: currencyMarketStepSchema.optional(),
  /** `null` cuando el job no llegó a auditar porque una descarga quedó pendiente o falló. */
  audit: auditStepSchema.nullable(),
});

export type ValuationDataStep = z.infer<typeof valuationDataStepSchema>;

/** Si el job bajó algo, el siguiente valúa con un corte que lo ve. */
export function dataStepIngested(step: ValuationDataStep): boolean {
  return (
    step.fundamentals.status === "ingested" ||
    step.filings?.status === "refreshed" ||
    step.sic.status === "observed" ||
    step.prices.status === "ingested" ||
    step.consensus?.status === "captured" ||
    // La curva entra al costo de capital; el cambio sólo a la lectura.
    step.currencyMarket?.riskFree.status === "recorded"
  );
}

/**
 * La parte que impide valuar ahora. Los precios nunca bloquean: sin el cierre
 * del día la comparación con el mercado lo nombra. Lo presentado después de la
 * última descarga tampoco: la ventana guardada sigue sirviendo.
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
