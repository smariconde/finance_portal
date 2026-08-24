import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import {
  calendarDateSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import {
  decimalPolicySchema,
  engineDecimalSchema,
  rateSchema,
} from "./decimal-policy";
import { ValuationPolicyError } from "./valuation-error";

/**
 * Snapshot de entrada de una corrida de valuación
 * (`docs/valuation/methodology.md`, sección "Snapshot de entrada").
 *
 * Fija identidad, moneda, fecha, hechos con provenance, supuestos, política
 * numérica y versión del motor. Es el único input del cálculo: el motor no lee
 * repositorios, no consulta proveedores y no invoca IA, así que dos corridas con
 * el mismo snapshot canónico producen el mismo resultado y el mismo hash.
 */
export const VALUATION_METHOD = "fcff_base";
export const ENGINE_VERSION = "fcff-1.0.0";
/** Debe seguir a `docs/valuation/methodology.md`. */
export const METHODOLOGY_VERSION = "0.1.0";

const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/u);

const rationaleSchema = z.string().trim().min(1).max(512);

/**
 * Identidad no colapsada: la corrida nombra entidad, security y listing por
 * separado. Un ticker no aparece jamás en el snapshot porque no es una foreign
 * key (`docs/data/identity-model.md`).
 */
export const valuationSubjectSchema = z.object({
  legalEntityId: z.uuid(),
  securityId: z.uuid(),
  listingId: z.uuid().nullable(),
  depositaryProgramId: z.uuid().nullable(),
});

export type ValuationSubject = z.infer<typeof valuationSubjectSchema>;

/** Provenance mínima de cada hecho: sin ella el valor no es explicable. */
const factProvenanceShape = {
  asOf: calendarDateSchema,
  availableAt: utcTimestampSchema,
  sourceId: sourceIdSchema,
  sourceDocumentId: z.string().trim().min(1).max(256).nullable(),
  observationId: z.uuid().nullable(),
  qualityFlags: z.array(z.string().trim().min(1).max(64)).max(16),
} as const;

export const monetaryFactSchema = z.object({
  ...factProvenanceShape,
  value: engineDecimalSchema,
  currency: currencySchema,
  unit: z.literal("monetary"),
});

export type MonetaryFact = z.infer<typeof monetaryFactSchema>;

export const shareCountFactSchema = z.object({
  ...factProvenanceShape,
  value: engineDecimalSchema,
  unit: z.literal("shares"),
});

export type ShareCountFact = z.infer<typeof shareCountFactSchema>;

/**
 * Estado de una claim del puente EV-equity. `declared_absent` es una decisión
 * del owner con motivo registrado —vale cero y lo dice—; `missing` es un dato
 * que falta y bloquea la corrida. Un faltante nunca se presume cero (`TM-05`).
 */
export const claimStatusSchema = z.enum([
  "reported",
  "declared_absent",
  "missing",
]);

export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const bridgeItemSchema = z
  .object({
    status: claimStatusSchema,
    amount: monetaryFactSchema.nullable(),
    rationale: rationaleSchema.nullable(),
  })
  .superRefine((item, context) => {
    if ((item.amount !== null) !== (item.status === "reported")) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "An amount exists only when the claim status is reported.",
      });
    }

    if (item.status === "declared_absent" && item.rationale === null) {
      context.addIssue({
        code: "custom",
        path: ["rationale"],
        message: "Declaring a claim absent requires a recorded rationale.",
      });
    }
  });

export type BridgeItem = z.infer<typeof bridgeItemSchema>;

export const equityBridgeSchema = z.object({
  excessCash: bridgeItemSchema,
  nonOperatingAssets: bridgeItemSchema,
  debt: bridgeItemSchema,
  minorityInterest: bridgeItemSchema,
  otherClaims: bridgeItemSchema,
});

export type EquityBridge = z.infer<typeof equityBridgeSchema>;

export const BRIDGE_ITEM_KEYS = [
  "excessCash",
  "nonOperatingAssets",
  "debt",
  "minorityInterest",
  "otherClaims",
] as const;

export type BridgeItemKey = (typeof BRIDGE_ITEM_KEYS)[number];

/**
 * Convención de reinversión por período. La metodología prohíbe mezclar
 * sales-to-capital y `growth / ROIC` sin un puente explícito, así que la
 * convención es un dato del período y no un default del motor.
 */
export const reinvestmentAssumptionSchema = z.discriminatedUnion("convention", [
  z.object({
    convention: z.literal("sales_to_capital"),
    salesToCapital: engineDecimalSchema,
  }),
  z.object({
    convention: z.literal("return_on_capital"),
    returnOnCapital: rateSchema,
  }),
]);

export type ReinvestmentAssumption = z.infer<
  typeof reinvestmentAssumptionSchema
>;

export const periodAssumptionSchema = z.object({
  periodIndex: z.number().int().min(1).max(20),
  periodEnd: calendarDateSchema,
  revenueGrowth: rateSchema,
  ebitMargin: rateSchema,
  taxRate: rateSchema,
  wacc: rateSchema,
  reinvestment: reinvestmentAssumptionSchema,
});

export type PeriodAssumption = z.infer<typeof periodAssumptionSchema>;

export const terminalAssumptionSchema = z.object({
  growth: rateSchema,
  ebitMargin: rateSchema,
  taxRate: rateSchema,
  wacc: rateSchema,
  /** Sostiene el crecimiento: `reinvestment_rate = growth / returnOnCapital`. */
  returnOnCapital: rateSchema,
});

export type TerminalAssumption = z.infer<typeof terminalAssumptionSchema>;

export const sensitivityAxisSchema = z.object({
  from: rateSchema,
  to: rateSchema,
  step: rateSchema,
});

export type SensitivityAxis = z.infer<typeof sensitivityAxisSchema>;

export const sensitivitySpecSchema = z.object({
  wacc: sensitivityAxisSchema,
  terminalGrowth: sensitivityAxisSchema,
});

export type SensitivitySpec = z.infer<typeof sensitivitySpecSchema>;

/**
 * Perfil del activo. El motor de Fase 1 sólo cubre no financieras maduras; el
 * resto devuelve `unsupported_method` con sus inputs requeridos y nunca cae a
 * FCFF en silencio (`docs/valuation/methodology.md`, "Selección de método").
 */
export const assetProfileSchema = z.enum([
  "non_financial_mature",
  "high_growth",
  "bank",
  "insurer",
  "reit",
  "cyclical",
  "commodity",
  "holding",
  "distressed",
]);

export type AssetProfile = z.infer<typeof assetProfileSchema>;

export const SUPPORTED_ASSET_PROFILES: readonly AssetProfile[] = Object.freeze([
  "non_financial_mature",
]);

export const valuationInputSchema = z
  .object({
    subject: valuationSubjectSchema,
    /** Fecha de valuación: el borde temporal de todo el snapshot. */
    asOf: calendarDateSchema,
    currency: currencySchema,
    /** Contrato point-in-time con el que se leyeron los hechos (`TM-06`). */
    knowledge: pointInTimeQuerySchema,
    assetProfile: assetProfileSchema,
    method: z.literal(VALUATION_METHOD),
    engineVersion: z.literal(ENGINE_VERSION),
    methodologyVersion: z.literal(METHODOLOGY_VERSION),
    decimalPolicy: decimalPolicySchema,
    baseRevenue: monetaryFactSchema,
    periods: z.array(periodAssumptionSchema).min(1).max(20),
    /**
     * Puente declarado cuando los períodos usan convenciones de reinversión
     * distintas. Sin él, mezclarlas es un rechazo, no una advertencia.
     */
    reinvestmentConventionBridge: rationaleSchema.nullable(),
    terminal: terminalAssumptionSchema,
    bridge: equityBridgeSchema,
    dilutedShares: shareCountFactSchema,
    sensitivity: sensitivitySpecSchema.nullable(),
  })
  .superRefine((input, context) => {
    input.periods.forEach((period, index) => {
      if (period.periodIndex !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["periods", index, "periodIndex"],
          message: "Explicit periods are numbered consecutively from one.",
        });
      }

      const previous = input.periods[index - 1];

      if (previous !== undefined && previous.periodEnd >= period.periodEnd) {
        context.addIssue({
          code: "custom",
          path: ["periods", index, "periodEnd"],
          message: "Each explicit period ends after the previous one.",
        });
      }
    });

    if (
      input.periods[0] !== undefined &&
      input.baseRevenue.asOf >= input.periods[0].periodEnd
    ) {
      context.addIssue({
        code: "custom",
        path: ["baseRevenue", "asOf"],
        message: "The base year must close before the first explicit period.",
      });
    }
  });

export type ValuationInput = z.infer<typeof valuationInputSchema>;

/**
 * Hash canónico del snapshot. Cubre supuestos, provenance, política numérica y
 * versión del motor: cambiar cualquiera de ellos es otra corrida, nunca un
 * recálculo silencioso de la misma (`TM-16`).
 */
export function computeValuationInputHash(input: ValuationInput): string {
  return computeContentHash(valuationInputSchema.parse(input));
}

/** Devuelve los hechos monetarios del snapshot con su ruta, para los checks. */
export function listMonetaryFacts(
  input: ValuationInput,
): readonly { path: string; fact: MonetaryFact }[] {
  const facts: { path: string; fact: MonetaryFact }[] = [
    { path: "baseRevenue", fact: input.baseRevenue },
  ];

  for (const key of BRIDGE_ITEM_KEYS) {
    const item = input.bridge[key];

    if (item.amount !== null) {
      facts.push({ path: `bridge.${key}.amount`, fact: item.amount });
    }
  }

  return facts;
}

/**
 * Guarda de método. Un perfil fuera de la cobertura implementada se rechaza con
 * su motivo y los inputs que faltarían; no se valúa con el método equivocado.
 */
export function assertMethodSupported(input: ValuationInput): void {
  if (!SUPPORTED_ASSET_PROFILES.includes(input.assetProfile)) {
    throw new ValuationPolicyError(
      "unsupported_method",
      `Asset profile ${input.assetProfile} has no implemented method; FCFF/WACC is not a fallback.`,
      ["assetProfile"],
    );
  }
}
