/**
 * Explicit, dated property-basis evidence for the first real REIT case.
 * The source quote is from PLD's 2025 10-K Item 1; the job only uses it when
 * submissions resolves this exact original accession at its cutoff.
 */
export const DECLARED_REIT_PROPERTY_BASIS = Object.freeze([
  {
    cik: "0001045609",
    fiscalYearEnd: "2025-12-31",
    accessionNumber: "0001193125-26-051453",
    propertyBasis: "equity_property" as const,
    sourceUrl:
      "https://www.sec.gov/Archives/edgar/data/1045609/000119312526051453/pld-20251231.htm",
    quote:
      "Our O&M portfolio includes our consolidated properties as well as properties owned by our unconsolidated co-investment ventures, which we manage.",
  },
]);

export function declaredReitPropertyBasis(cik: string, fiscalYearEnd: string) {
  return (
    DECLARED_REIT_PROPERTY_BASIS.find(
      (entry) => entry.cik === cik && entry.fiscalYearEnd === fiscalYearEnd,
    ) ?? null
  );
}
