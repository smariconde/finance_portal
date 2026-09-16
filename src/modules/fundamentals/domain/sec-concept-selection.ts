/**
 * Selección versionada de conceptos XBRL que se ingieren de companyfacts.
 *
 * companyfacts trae todo lo que un filer etiquetó sin dimensiones: para Apple son
 * 505 conceptos y 12.901 vintages distintas. La selección las lleva a lo que el
 * motor y la metodología usan —3.254 en el mismo filer— porque el universo son
 * quinientas empresas y la base personal no es un data lake.
 *
 * Qué decide y qué no:
 *
 * - **Decide qué se guarda**, no qué significa. Cada hecho se publica con su
 *   concepto original: `Revenues` y `RevenueFromContractWithCustomer…` siguen
 *   siendo dos conceptos. Elegir cuál es «el revenue» de una empresa es
 *   normalización con precedencia, y eso es de Fase 3/4.
 * - **Se registra en la corrida** (`selection_version`). Sin eso, un concepto
 *   ausente sería ambiguo entre «la empresa no lo reporta» y «no se fue a
 *   buscar», y el perfil de completitud de `F3-02` no podría distinguirlos.
 * - **Crecer es un diff revisable**: agregar un concepto sube la versión, y volver
 *   a correr el CIK publica sólo lo nuevo. No sube la versión del parser, porque
 *   filtrar no cambia el contenido de un hecho ya publicado.
 */
export const SEC_CONCEPT_SELECTION_VERSION = "sec-core-concepts-1.0.0";

const US_GAAP = [
  // Resultado: ingresos. La taxonomía cambió de nombre con ASC 606, así que
  // conviven las dos generaciones y ninguna se descarta.
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "SalesRevenueNet",
  "CostOfRevenue",
  "CostOfGoodsAndServicesSold",
  "GrossProfit",
  // Resultado: gastos operativos y EBIT. I+D se guarda separado porque la
  // metodología lo capitaliza (Fase 4).
  "ResearchAndDevelopmentExpense",
  "SellingGeneralAndAdministrativeExpense",
  "OperatingExpenses",
  "OperatingIncomeLoss",
  // Resultado: debajo del EBIT.
  "InterestExpense",
  "InterestExpenseNonoperating",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  "IncomeTaxExpenseBenefit",
  "NetIncomeLoss",
  "ProfitLoss",
  "NetIncomeLossAttributableToNoncontrollingInterest",
  "EarningsPerShareBasic",
  "EarningsPerShareDiluted",
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  // Flujo de fondos: reinversión y retorno al accionista.
  "NetCashProvidedByUsedInOperatingActivities",
  "PaymentsToAcquirePropertyPlantAndEquipment",
  "DepreciationDepletionAndAmortization",
  "DepreciationAndAmortization",
  "ShareBasedCompensation",
  "PaymentsOfDividends",
  "PaymentsForRepurchaseOfCommonStock",
  // Balance: caja e inversiones, que alimentan el exceso de caja del puente.
  "CashAndCashEquivalentsAtCarryingValue",
  "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  "MarketableSecuritiesCurrent",
  "MarketableSecuritiesNoncurrent",
  "ShortTermInvestments",
  // Balance: estructura.
  "AssetsCurrent",
  "Assets",
  "LiabilitiesCurrent",
  "Liabilities",
  "PropertyPlantAndEquipmentNet",
  "Goodwill",
  "IntangibleAssetsNetExcludingGoodwill",
  "StockholdersEquity",
  "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  "MinorityInterest",
  "CommonStockSharesOutstanding",
  // Balance: deuda y leases, las claims del puente EV-equity.
  "LongTermDebt",
  "LongTermDebtCurrent",
  "LongTermDebtNoncurrent",
  "DebtCurrent",
  "CommercialPaper",
  "ShortTermBorrowings",
  "OperatingLeaseLiability",
  "OperatingLeaseLiabilityCurrent",
  "OperatingLeaseLiabilityNoncurrent",
  "FinanceLeaseLiability",
] as const;

const DEI = [
  // Acciones en circulación a la fecha de la carátula: la cifra más reciente que
  // publica un filing, distinta del promedio ponderado del período.
  "EntityCommonStockSharesOutstanding",
  "EntityPublicFloat",
] as const;

const SELECTED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["us-gaap", new Set<string>(US_GAAP)],
  ["dei", new Set<string>(DEI)],
]);

export function isSelectedSecConcept(
  taxonomy: string,
  concept: string,
): boolean {
  return SELECTED.get(taxonomy)?.has(concept) ?? false;
}

export function listSelectedSecConcepts(): readonly string[] {
  return [...SELECTED].flatMap(([taxonomy, concepts]) =>
    [...concepts].map((concept) => `${taxonomy}:${concept}`),
  );
}
