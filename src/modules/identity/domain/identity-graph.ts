import { z } from "zod";

import {
  refineTemporalVersion,
  temporalVersionShape,
} from "@/modules/temporal/domain/temporal-version";

/**
 * Modelo de identidad de `docs/data/identity-model.md` como contrato ejecutable.
 *
 * Los cuatro niveles —entidad legal, security, listing y símbolo— y el programa
 * depositario se mantienen separados: un ticker es un valor de búsqueda acotado
 * en el tiempo, nunca una foreign key, y un CEDEAR nunca se colapsa con su
 * subyacente (`TM-06`).
 */
const internalIdSchema = z.uuid();
const shortTextSchema = z.string().trim().min(1).max(256);

/** Decimal exacto positivo: el ratio nunca se degrada a un `number` binario. */
const positiveDecimalSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u,
    "value must be a canonical non-negative decimal string.",
  )
  .refine((value) => /[1-9]/u.test(value), "value must be strictly positive.");

export const legalEntitySchema = z
  .object({
    ...temporalVersionShape,
    legalEntityId: internalIdSchema,
    legalName: shortTextSchema,
    entityType: z.enum([
      "operating_company",
      "holding_company",
      "bank",
      "insurer",
      "fund",
      "trust",
      "depositary",
      "other",
    ]),
    jurisdiction: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/u)
      .nullable(),
    status: z.enum(["active", "inactive", "merged", "dissolved", "unknown"]),
  })
  .superRefine(refineTemporalVersion);

export type LegalEntity = z.infer<typeof legalEntitySchema>;

export const securitySchema = z
  .object({
    ...temporalVersionShape,
    securityId: internalIdSchema,
    issuerLegalEntityId: internalIdSchema,
    securityType: z.enum([
      "common_equity",
      "preferred_equity",
      "depositary_receipt",
      "fund_unit",
      "etf_share",
      "debt",
      "other",
    ]),
    shareClass: shortTextSchema.nullable(),
    economicCurrency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/u)
      .nullable(),
    status: z.enum(["active", "inactive", "converted", "cancelled", "unknown"]),
  })
  .superRefine(refineTemporalVersion);

export type Security = z.infer<typeof securitySchema>;

export const listingSchema = z
  .object({
    ...temporalVersionShape,
    listingId: internalIdSchema,
    securityId: internalIdSchema,
    /** ISO 10383. El nombre comercial del mercado es metadata versionada. */
    mic: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{4}$/u),
    quoteCurrency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/u),
    country: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/u),
    status: z.enum(["active", "suspended", "delisted", "unknown"]),
    primaryListing: z.boolean(),
  })
  .superRefine(refineTemporalVersion);

export type Listing = z.infer<typeof listingSchema>;

export const listingSymbolSchema = z
  .object({
    ...temporalVersionShape,
    listingSymbolId: internalIdSchema,
    listingId: internalIdSchema,
    symbol: z.string().trim().min(1).max(32),
    symbolType: z.enum(["ticker", "local_code", "vendor_symbol"]),
  })
  .superRefine(refineTemporalVersion);

export type ListingSymbol = z.infer<typeof listingSymbolSchema>;

export const depositaryProgramSchema = z
  .object({
    ...temporalVersionShape,
    depositaryProgramId: internalIdSchema,
    programType: z.enum(["cedear", "adr", "gdr", "other"]),
    depositarySecurityId: internalIdSchema,
    underlyingSecurityId: internalIdSchema,
    depositaryLegalEntityId: internalIdSchema.nullable(),
    sponsorLegalEntityId: internalIdSchema.nullable(),
    investorScope: shortTextSchema.nullable(),
    status: z.enum(["active", "suspended", "terminated", "unknown"]),
  })
  .superRefine((program, context) => {
    refineTemporalVersion(program, context);

    if (program.depositarySecurityId === program.underlyingSecurityId) {
      context.addIssue({
        code: "custom",
        path: ["underlyingSecurityId"],
        message:
          "A depositary program never merges the depositary and underlying securities.",
      });
    }
  });

export type DepositaryProgram = z.infer<typeof depositaryProgramSchema>;

export const depositaryRatioSchema = z
  .object({
    ...temporalVersionShape,
    depositaryRatioId: internalIdSchema,
    depositaryProgramId: internalIdSchema,
    depositaryUnits: positiveDecimalSchema,
    underlyingUnits: positiveDecimalSchema,
    announcedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine(refineTemporalVersion);

export type DepositaryRatio = z.infer<typeof depositaryRatioSchema>;

export const identifierSubjectTypeSchema = z.enum([
  "legal_entity",
  "security",
  "listing",
]);

export type IdentifierSubjectType = z.infer<typeof identifierSubjectTypeSchema>;

export const identifierAssignmentSchema = z
  .object({
    ...temporalVersionShape,
    identifierAssignmentId: internalIdSchema,
    subjectType: identifierSubjectTypeSchema,
    subjectId: internalIdSchema,
    identifierType: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/u),
    /** Valor original de la fuente: la normalización no lo reemplaza. */
    identifierValue: z.string().trim().min(1).max(128),
    normalizedValue: z.string().trim().min(1).max(128),
    /** El scope evita que dos esquemas distintos colisionen por valor. */
    scope: shortTextSchema,
    issuingAuthority: shortTextSchema.nullable(),
    confidence: z.enum(["authoritative", "confirmed", "candidate", "rejected"]),
  })
  .superRefine(refineTemporalVersion);

export type IdentifierAssignment = z.infer<typeof identifierAssignmentSchema>;

export const identityGraphSchema = z.object({
  legalEntities: z.array(legalEntitySchema),
  securities: z.array(securitySchema),
  listings: z.array(listingSchema),
  listingSymbols: z.array(listingSymbolSchema),
  depositaryPrograms: z.array(depositaryProgramSchema),
  depositaryRatios: z.array(depositaryRatioSchema),
  identifierAssignments: z.array(identifierAssignmentSchema),
});

export type IdentityGraph = z.infer<typeof identityGraphSchema>;

/**
 * Normalización de símbolos: sólo mayúsculas y espacios. No elimina puntos ni
 * guiones, porque `BRK.B` y `BRKB` pueden ser símbolos distintos según el venue.
 */
export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\s+/gu, "");
}

/**
 * Normalización de identificadores por tipo declarado. Sin una convención
 * versionada por tipo no se borran separadores: hacerlo fusionaría sujetos
 * distintos.
 */
export function normalizeIdentifierValue(
  identifierType: string,
  value: string,
): string {
  const trimmed = value.trim().replace(/\s+/gu, "");

  switch (identifierType) {
    case "isin":
    case "lei":
    case "cusip":
    case "sedol":
    case "figi":
    case "share_class_figi":
    case "composite_figi":
      return trimmed.toUpperCase();
    case "cik":
      // El CIK es numérico y se compara con relleno a diez dígitos.
      return /^[0-9]{1,10}$/u.test(trimmed)
        ? trimmed.padStart(10, "0")
        : trimmed;
    default:
      return trimmed.toLowerCase();
  }
}
