import type { StoredFinancialDeclaration } from "../domain/financial-declaration";

export interface FinancialDeclarationRepository {
  record(declaration: StoredFinancialDeclaration): Promise<void>;
  latestAsKnown(
    legalEntityId: string,
    fiscalYearEnd: string,
    knownAt: string,
  ): Promise<StoredFinancialDeclaration | null>;
}
