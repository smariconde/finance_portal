import { z } from "zod";

import { engineDecimalSchema, parseDecimal, ONE, ZERO } from "./decimal-policy";

export const FINANCIAL_DECLARATION_VERSION = "financial-declaration-1.0.0";

/** Private owner judgment, tied to a fiscal base and citation. */
export const financialDeclarationFileSchema = z
  .strictObject({
    fiscalYearEnd: z.iso.date(),
    payout: engineDecimalSchema,
    rationale: z.string().trim().min(10).max(1024),
    sourceDocumentId: z.string().trim().min(1).max(256),
    regulatoryCapital: z.string().trim().min(10).max(1024),
    assetQuality: z.string().trim().min(10).max(1024),
    cleanSurplus: z.string().trim().min(10).max(1024),
    /** Only when companyfacts does not publish common equity. */
    commonBook: z
      .strictObject({
        currentValue: engineDecimalSchema,
        priorValue: engineDecimalSchema,
        priorFiscalYearEnd: z.iso.date(),
        currency: z.string().regex(/^[A-Z]{3}$/u),
      })
      .nullable()
      .default(null),
  })
  .refine(
    (value) => {
      const payout = parseDecimal(value.payout, "payout");
      return payout.gte(ZERO) && payout.lte(ONE);
    },
    { path: ["payout"], message: "Payout must be between zero and one." },
  )
  .refine(
    (value) =>
      value.commonBook === null ||
      (value.commonBook.priorFiscalYearEnd < value.fiscalYearEnd &&
        parseDecimal(value.commonBook.currentValue, "commonBook.current").gt(
          ZERO,
        ) &&
        parseDecimal(value.commonBook.priorValue, "commonBook.prior").gt(ZERO)),
    {
      path: ["commonBook"],
      message:
        "Prior common book must precede the current fiscal year and both must be positive.",
    },
  );

export const storedFinancialDeclarationSchema =
  financialDeclarationFileSchema.safeExtend({
    version: z.literal(FINANCIAL_DECLARATION_VERSION),
    declarationId: z.uuid(),
    legalEntityId: z.uuid(),
    availableAt: z.iso.datetime({ offset: true }),
    recordedAt: z.iso.datetime({ offset: true }),
  });

export type FinancialDeclarationFile = z.infer<
  typeof financialDeclarationFileSchema
>;
export type StoredFinancialDeclaration = z.infer<
  typeof storedFinancialDeclarationSchema
>;
