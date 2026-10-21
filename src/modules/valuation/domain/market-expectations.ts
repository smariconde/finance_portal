import { z } from "zod";

import {
  calendarDateSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import { parseDecimal } from "./decimal-policy";
import {
  driverReadingSchema,
  OUTLOOK_SCALES,
  readingRiskSchema,
  type DriverReading,
  type ReadingDriver,
} from "./market-expectations-task";
import type {
  MarketImpliedContext,
  MarketImpliedReading,
} from "./market-implied";

/**
 * Lecturas guardadas de la tarea de expectativas (`F6-11`, ADR 0050) y la
 * regla que las pone al lado de lo que exige el precio.
 *
 * Toda pregunta a la escalera se guarda, también la abstención y el freno:
 * `readingId` es el `task_run_id` de sus intentos en `ai_spend_ledger`. La
 * lectura aceptada se guarda tal cual la validó la policy, con las secciones
 * del 10-K que vio el modelo. No se borra: preguntar de nuevo es otra fila.
 */
export const marketExpectationsReadingSchema = z
  .object({
    drivers: z.array(driverReadingSchema).length(3),
    risks: z.array(readingRiskSchema).max(5),
    confidence: z.enum(["high", "medium"]),
    rationale: z.string().min(1).max(1200),
  })
  .strict();

export type MarketExpectationsReadingBody = z.infer<
  typeof marketExpectationsReadingSchema
>;

export const marketExpectationsRecordSchema = z
  .object({
    readingId: z.uuid(),
    legalEntityId: z.uuid(),
    cik: z.string().regex(/^[0-9]{10}$/u),
    accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
    /** El ejercicio del 10-K: la corrida con ese año base la puede leer. */
    fiscalYearEnd: calendarDateSchema,
    taskVersion: z.string().max(64),
    promptVersion: z.string().max(64),
    policyVersion: z.string().max(64),
    ladderVersion: z.string().max(64),
    extractVersion: z.string().max(64),
    outcome: z.enum(["accepted", "abstained", "stopped"]),
    reading: marketExpectationsReadingSchema.nullable(),
    reason: z.string().max(64).nullable(),
    acceptedRung: z.number().int().min(1).nullable(),
    respondedModel: z.string().max(128).nullable(),
    proposedAt: utcTimestampSchema,
    recordedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const accepted = record.outcome === "accepted";

    if (
      accepted !== (record.reading !== null) ||
      accepted === (record.reason !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reading"],
        message:
          "A reading exists exactly when it was accepted; otherwise a reason.",
      });
    }
  });

export type MarketExpectationsRecord = z.infer<
  typeof marketExpectationsRecordSchema
>;

export const marketExpectationsEvidenceSchema = z
  .object({
    evidenceId: z.string().regex(/^E[0-9]{1,2}$/u),
    sourceId: z.string().max(64),
    section: z.string().max(48),
    documentUrl: z.url(),
    accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
    documentAcceptedAt: utcTimestampSchema,
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    byteLength: z.number().int().min(1),
    truncated: z.boolean(),
    excerpt: z.string().min(1),
  })
  .strict();

export type MarketExpectationsEvidenceRecord = z.infer<
  typeof marketExpectationsEvidenceSchema
>;

export type StoredMarketExpectations = {
  readonly record: MarketExpectationsRecord;
  readonly evidence: readonly MarketExpectationsEvidenceRecord[];
};

/**
 * `expectations-plausibility-1.0.0`: dónde cae lo que exige el precio en la
 * escala de la lectura, y a cuántos escalones de lo que la evidencia sostiene.
 *
 * - crecimiento: lo exigido en la misma escala que el prompt (bajo 0 %, 0–5 %,
 *   5–10 %, 10–20 %, más de 20 %);
 * - margen: el cambio exigido contra el margen ajustado del año base —hasta
 *   dos puntos es «estable»; más de quince, un escalón más allá de «se
 *   expande»—;
 * - ventaja: el ROIC terminal exigido menos el WACC terminal —hasta dos puntos
 *   es «ninguna», hasta quince «acotada»—.
 *
 * `within`: lo exigido no pasa lo que la evidencia sostiene. `above`: un
 * escalón más. `far_above`: dos o más. La tasa de descuento no tiene lectura:
 * el 10-K no habla del costo de capital del inversor.
 */
export const EXPECTATIONS_PLAUSIBILITY_VERSION =
  "expectations-plausibility-1.0.0";

export type PlausibilityVerdict =
  | "within"
  | "above"
  | "far_above"
  /** El precio no se alcanza moviendo sólo este driver. */
  | "unreachable"
  /** La lectura no habla del driver. */
  | "not_addressed"
  /** No hay lo exigido: el DCF inverso no lo resolvió. */
  | "no_requirement";

export type DriverPlausibility = {
  readonly driver: ReadingDriver;
  readonly reading: DriverReading;
  /** El escalón que exige el precio, en la escala del driver. */
  readonly required: string | null;
  readonly verdict: PlausibilityVerdict;
};

const IMPLIED_DRIVER: Record<ReadingDriver, MarketImpliedReading["driver"]> = {
  revenue_growth: "revenue_growth",
  operating_margin: "ebit_margin",
  competitive_advantage: "terminal_return_on_capital",
};

function step(value: string, thresholds: readonly string[]): number {
  const index = thresholds.findIndex((threshold) =>
    parseDecimal(value, "required").lessThanOrEqualTo(threshold),
  );

  return index < 0 ? thresholds.length : index;
}

function requiredStep(
  driver: ReadingDriver,
  implied: string,
  context: MarketImpliedContext,
): number | null {
  switch (driver) {
    case "revenue_growth":
      // ≤ 0 → decline… > 0,20 → very_high. El 0 exacto es «bajo».
      return parseDecimal(implied, "growth").isNegative()
        ? 0
        : 1 + step(implied, ["0.05", "0.1", "0.2"]);
    case "operating_margin": {
      if (context.baseEbitMargin === null) return null;

      const change = parseDecimal(implied, "margin")
        .minus(parseDecimal(context.baseEbitMargin, "base"))
        .toString();

      return step(change, ["-0.02", "0.02", "0.15"]);
    }
    case "competitive_advantage": {
      const spread = parseDecimal(implied, "roic")
        .minus(parseDecimal(context.terminalWacc, "wacc"))
        .toString();

      return step(spread, ["0.02", "0.15"]);
    }
  }
}

export function judgePlausibility(input: {
  readonly readings: readonly DriverReading[];
  readonly implied: readonly MarketImpliedReading[];
  readonly context: MarketImpliedContext;
}): readonly DriverPlausibility[] {
  return input.readings.map((reading) => {
    const scale: readonly string[] = OUTLOOK_SCALES[reading.driver];
    const implied = input.implied.find(
      (entry) => entry.driver === IMPLIED_DRIVER[reading.driver],
    );
    const result = (
      verdict: PlausibilityVerdict,
      required: string | null = null,
    ): DriverPlausibility => ({
      driver: reading.driver,
      reading,
      required,
      verdict,
    });

    if (implied?.status === "price_above_range") {
      return result("unreachable");
    }

    if (implied?.status !== "solved") {
      return result("no_requirement");
    }

    const required = requiredStep(
      reading.driver,
      implied.implied,
      input.context,
    );

    if (required === null) {
      return result("no_requirement");
    }

    // La escala del margen tiene un escalón más allá de «se expande».
    const label = scale[Math.min(required, scale.length - 1)] ?? null;

    if (reading.outlook === "not_addressed") {
      return result("not_addressed", label);
    }

    const gap = required - scale.indexOf(reading.outlook);

    return result(
      gap <= 0 ? "within" : gap === 1 ? "above" : "far_above",
      label,
    );
  });
}
