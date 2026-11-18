import {
  CAPTIVE_FINANCE_SPLIT_VERSION,
  captiveFinanceSplitSchema,
  type CaptiveFinanceSplit,
} from "../domain/captive-finance";
import { CAPTIVE_FINANCE_DECLARATIONS_VERSION } from "../domain/declared-captive-finance";
import type { ConceptFact } from "../domain/valuation-facts";

const EMPTY_DEBT = {
  longTermTotal: null,
  longTermNoncurrent: null,
  longTermCurrent: null,
  currentTotal: null,
  shortTermBorrowings: null,
  commercialPaper: null,
  financeLeases: null,
} as const;

/**
 * Una apertura sintética (`F6-23`): la deuda industrial como `LongTermDebt`
 * del miembro industrial y el interés industrial bruto del mismo ejercicio.
 */
export function captiveFinanceSplitFixture(
  fiscalYearEnd: string,
  availableAt: string,
  options: { debt?: string; interest?: string; financeDebt?: string } = {},
): CaptiveFinanceSplit {
  const fact = (
    value: string,
    concept: string,
    member: string,
  ): ConceptFact => ({
    value,
    currency: "USD",
    unit: "monetary",
    asOf: fiscalYearEnd,
    availableAt,
    sourceId: "sec-edgar",
    sourceDocumentId: "0000000042-26-000001",
    observationId: null,
    qualityFlags: [`xbrl_member:${member}`],
    concept: `us-gaap:${concept}`,
  });

  return captiveFinanceSplitSchema.parse({
    version: CAPTIVE_FINANCE_SPLIT_VERSION,
    declarationVersion: CAPTIVE_FINANCE_DECLARATIONS_VERSION,
    cik: "0000000042",
    financeArm: "FixtureCo Credit",
    accessionNumber: "0000000042-26-000001",
    fiscalYearEnd,
    segments: {
      industrialDebt: { axis: "SegmentsAxis", member: "IndustrialMember" },
      industrialInterest: { axis: "SegmentsAxis", member: "IndustrialMember" },
      financeDebt: { axis: "SegmentsAxis", member: "CreditMember" },
    },
    industrialDebt: {
      ...EMPTY_DEBT,
      longTermTotal: fact(
        options.debt ?? "30000000",
        "LongTermDebt",
        "IndustrialMember",
      ),
    },
    financeDebt: {
      ...EMPTY_DEBT,
      longTermTotal: fact(
        options.financeDebt ?? "90000000",
        "LongTermDebt",
        "CreditMember",
      ),
    },
    industrialInterest: {
      basis: "gross",
      facts: [
        fact(
          options.interest ?? "1728000",
          "InterestExpense",
          "IndustrialMember",
        ),
      ],
    },
  });
}
