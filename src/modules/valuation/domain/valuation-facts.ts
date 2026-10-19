import { z } from "zod";

import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";
import {
  calendarDateSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import { engineDecimalSchema } from "./decimal-policy";

/**
 * Hechos con provenance del snapshot de valuación. Viven aparte del snapshot
 * para que una sección suya —la capitalización de `F4-01`— pueda declarar sus
 * hechos sin importar el schema que la contiene.
 */
export const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/u);

/** Provenance mínima de cada hecho: sin ella el valor no es explicable. */
export const factProvenanceShape = {
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
