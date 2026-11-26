import { listSplitSensitiveConcepts } from "@/modules/corporate-actions/domain/share-basis";

import { SEC_HISTORY_WINDOW_VERSION } from "./sec-history-window";

/**
 * Selección versionada de los hechos XBRL que se ingieren de companyfacts: qué
 * conceptos y, desde la 2.0.0, qué períodos.
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
export const SEC_CONCEPT_SELECTION_VERSION = "sec-core-concepts-14.0.0";

/**
 * Qué decide la versión. La 1.0.0 eran los mismos conceptos con toda la historia
 * XBRL; la 2.0.0 los recorta a la ventana de cinco ejercicios (ADR 0017), cuyo
 * ancla sale de cada descarga y queda en la corrida (`selection_anchor_on`). La
 * 3.0.0 suma el **numerador de la EPS**, que faltaba. La 4.0.0 son los mismos
 * conceptos con la ventana `sec-history-5fy-2.0.0`, que conserva diez ejercicios
 * de I+D para capitalizarla, y la I+D sin la adquirida en proceso (ADR 0037).
 * La 5.0.0 suma los cargos de reestructuración y deterioro que la normalización
 * revierte cuando no se repiten, y la deuda no corriente que incluye los
 * arrendamientos financieros (ADR 0038). La 6.0.0 suma los conceptos que los
 * filers usan en lugar de los que ya leíamos (ADR 0053): los vencimientos
 * corrientes con arrendamientos financieros, los intereses de la deuda, de los
 * arrendamientos, el neto y el pagado, y la D&A con acreciones. La 7.0.0 suma
 * la guardia de deuda (ADR 0054): conceptos que no entran en ninguna receta
 * pero prueban que la deuda no es cero —el cronograma de vencimientos, los
 * pagarés, la línea de crédito usada—, para no declarar sin deuda a D.R. Horton.
 * La 8.0.0 suma las opciones vivas, su strike y las unidades no consolidadas
 * al cierre (ADR 0055): sin transcripción aceptada, la corrida resta las
 * opciones que el XBRL del mismo 10-K publica.
 * La 9.0.0 suma patrimonio común y patrimonio preferente para el preflight
 * financiero (F6-20). Patrimonio total no se toma como común sin evidencia.
 * La 10.0.0 suma la deuda convertible corriente y no corriente (F6-36): Snowflake
 * y Datadog no publican su deuda con ningún otro concepto.
 * La 11.0.0 suma los títulos de deuda disponibles para la venta corrientes
 * (F6-41): Datadog publica sus inversiones de corto plazo (4.074 M en 2025)
 * sólo como `AvailableForSaleSecuritiesDebtSecuritiesCurrent`.
 * La 12.0.0 suma el capex con que lo publican 31 de los 43 filers guardados sin
 * `PaymentsToAcquirePropertyPlantAndEquipment` (F6-49, medido el 2026-11-25):
 * `PaymentsToAcquireProductiveAssets` (27: Amazon, NVIDIA, Home Depot, PepsiCo,
 * Visa…), `PaymentsForCapitalImprovements` (Corning, Gartner) y
 * `PaymentsToAcquireOtherPropertyPlantAndEquipment` (Eli Lilly).
 * La 13.0.0 suma la utilidad antes de impuestos doméstica y extranjera y el
 * impuesto a la tasa federal legal de la conciliación (F6-52, medido el
 * 2026-11-25): 28 de las 502 entidades del índice no publican el total, 11 de
 * ellas sí las dos partes (Phillips 66, Oracle, McDonald's…), y la regla
 * `pretax-income-1.0.0` las suma sólo si la conciliación las corrobora.
 * La 14.0.0 suma la taxonomía `ifrs-full` (`F6-55`, ADR 0087) para los 20-F
 * declarados: los conceptos que Spotify, Novo Nordisk y TSMC publican en sus
 * 20-F de 2024 y 2025 (medido el 2026-11-25). Un filer de 10-K no publica
 * `ifrs-full`, así que su selección no cambia; leerlos es de la serie anual.
 * Con la versión y el ancla,
 * un período anterior al corte sigue siendo «no se fue a buscar». El test fija
 * los componentes: cambiar uno sin subir la versión lo rompe.
 */
export const SEC_CONCEPT_SELECTION = Object.freeze({
  version: SEC_CONCEPT_SELECTION_VERSION,
  components: Object.freeze({
    historyWindow: SEC_HISTORY_WINDOW_VERSION,
  }),
});

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
  // La I+D recurrente de quien separa la adquirida en proceso, que es una
  // compra (4.0.0). Johnson & Johnson publica la recurrente sólo con este
  // concepto: con `ResearchAndDevelopmentExpense` declara la adquirida.
  "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
  "SellingGeneralAndAdministrativeExpense",
  "OperatingExpenses",
  "OperatingIncomeLoss",
  // Resultado: cargos que la normalización revierte cuando no se repiten
  // (5.0.0, ADR 0038). Los de deterioro se solapan entre filers —el agregado
  // incluye el goodwill en unos y no en otros—, así que la regla toma uno solo
  // por ejercicio y nunca los suma.
  "RestructuringCharges",
  "AssetImpairmentCharges",
  "GoodwillAndIntangibleAssetImpairment",
  "ImpairmentOfLongLivedAssetsHeldForUse",
  "GoodwillImpairmentLoss",
  // Resultado: debajo del EBIT.
  "InterestExpense",
  "InterestExpenseNonoperating",
  // Lo que publica quien no etiqueta el bruto (6.0.0, ADR 0053): Walmart separa
  // el de la deuda del de los arrendamientos financieros; Waste Management y
  // Cencora publican sólo el neto. La regla elige y nombra cuál usó.
  "InterestExpenseDebt",
  "FinanceLeaseInterestExpense",
  "InterestIncomeExpenseNonoperatingNet",
  "InterestIncomeExpenseNet",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  // Las dos partes y su control (13.0.0): sólo las suma `pretax-income-1.0.0`.
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesForeign",
  "IncomeTaxReconciliationIncomeTaxExpenseBenefitAtFederalStatutoryIncomeTaxRate",
  "IncomeTaxExpenseBenefit",
  "NetIncomeLoss",
  "ProfitLoss",
  "NetIncomeLossAttributableToNoncontrollingInterest",
  "EarningsPerShareBasic",
  "EarningsPerShareDiluted",
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  // Resultado: el numerador de la EPS, que **no es** `NetIncomeLoss`. Lo agregó
  // la 3.0.0 después de que la reconciliación del gate midiera residuos que no
  // se podían explicar con lo guardado: en Duke y JPMorgan el numerador queda
  // por debajo del resultado —dividendos preferidos— y en Prologis y Carnival
  // por encima —unidades de la sociedad operativa de un REIT e intereses de
  // convertibles readicionados—. Guardar el numerador evita tener que
  // reconstruirlo ajuste por ajuste.
  "NetIncomeLossAvailableToCommonStockholdersBasic",
  "NetIncomeLossAvailableToCommonStockholdersDiluted",
  // El puente entre los dos, para que la diferencia quede explicada y no sólo
  // medida.
  "PreferredStockDividendsAndOtherAdjustments",
  "PreferredStockDividendsIncomeStatementImpact",
  // Flujo de fondos: reinversión y retorno al accionista.
  "NetCashProvidedByUsedInOperatingActivities",
  "PaymentsToAcquirePropertyPlantAndEquipment",
  // El capex con otro nombre (12.0.0): la serie los lee en este orden y nunca
  // los suma.
  "PaymentsToAcquireProductiveAssets",
  "PaymentsToAcquireOtherPropertyPlantAndEquipment",
  "PaymentsForCapitalImprovements",
  "DepreciationDepletionAndAmortization",
  "DepreciationAndAmortization",
  // La D&A de Walmart (6.0.0).
  "DepreciationAmortizationAndAccretionNet",
  // Lo pagado de intereses: la última base del gasto (6.0.0).
  "InterestPaidNet",
  "ShareBasedCompensation",
  "PaymentsOfDividends",
  "PaymentsForRepurchaseOfCommonStock",
  // Balance: caja e inversiones, que alimentan el exceso de caja del puente.
  "CashAndCashEquivalentsAtCarryingValue",
  "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  "MarketableSecuritiesCurrent",
  "MarketableSecuritiesNoncurrent",
  "ShortTermInvestments",
  // Las inversiones de corto plazo que sólo se publican como títulos de deuda
  // disponibles para la venta (11.0.0): Datadog.
  "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
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
  // F6-20: common equity cannot be inferred from total equity when preferred
  // stock is outstanding or its amount is unknown.
  "CommonStockholdersEquity",
  "PreferredStockValue",
  "PreferredStockCarryingValue",
  "MinorityInterest",
  "CommonStockSharesOutstanding",
  // Balance: deuda y leases, las claims del puente EV-equity.
  "LongTermDebt",
  "LongTermDebtCurrent",
  "LongTermDebtNoncurrent",
  // La no corriente con los arrendamientos financieros adentro: Exxon, American
  // Tower y Charles River publican su deuda así (5.0.0).
  "LongTermDebtAndCapitalLeaseObligations",
  // Sus vencimientos corrientes: Coca-Cola, Home Depot y Eaton no publican
  // `LongTermDebtCurrent` (6.0.0).
  "LongTermDebtAndCapitalLeaseObligationsCurrent",
  // La deuda que sólo se publica como convertible (10.0.0): Snowflake y Datadog.
  "ConvertibleDebtNoncurrent",
  "ConvertibleLongTermNotesPayable",
  "ConvertibleDebtCurrent",
  "ConvertibleNotesPayableCurrent",
  "DebtCurrent",
  "CommercialPaper",
  "ShortTermBorrowings",
  "OperatingLeaseLiability",
  "OperatingLeaseLiabilityCurrent",
  "OperatingLeaseLiabilityNoncurrent",
  "FinanceLeaseLiability",
  // La guardia de deuda (7.0.0, ADR 0054): ninguna receta los suma, sólo
  // prueban que hay deuda. D.R. Horton publica su deuda sólo en el cronograma
  // de vencimientos.
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive",
  "NotesPayable",
  "NotesAndLoansPayable",
  "LineOfCredit",
  "SeniorNotes",
  "ConvertibleNotesPayable",
  "DebtInstrumentCarryingAmount",
  "DebtLongtermAndShorttermCombinedAmount",
  "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
  // Opciones y unidades de empleados al cierre (8.0.0, ADR 0055): el respaldo
  // de la transcripción. El plazo remanente no está: es un período XBRL
  // («P5Y3M») y companyfacts sólo trae números.
  "ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingNumber",
  "ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingWeightedAverageExercisePrice",
  "ShareBasedCompensationArrangementByShareBasedPaymentAwardEquityInstrumentsOtherThanOptionsNonvestedNumber",
] as const;

/**
 * IFRS de los 20-F declarados (14.0.0). Se guardan con su concepto original:
 * `LeaseLiabilities` bajo IFRS 16 incluye todos los arrendamientos y
 * `FinanceCosts` su interés, así que equipararlos a los de US GAAP es una regla
 * de la serie anual, no de esta selección.
 */
const IFRS_FULL = [
  "Revenue",
  "RevenueFromContractsWithCustomers",
  "ProfitLossFromOperatingActivities",
  "ProfitLossBeforeTax",
  "IncomeTaxExpenseContinuingOperations",
  "ProfitLoss",
  "ProfitLossAttributableToOwnersOfParent",
  "DepreciationAndAmortisationExpense",
  "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss",
  "AdjustmentsForDepreciationAndAmortisationExpense",
  "AdjustmentsForDepreciationExpense",
  "AdjustmentsForAmortisationExpense",
  "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
  "PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities",
  "CashFlowsFromUsedInOperatingActivities",
  "ResearchAndDevelopmentExpense",
  "AdjustedWeightedAverageShares",
  "WeightedAverageShares",
  "BasicEarningsLossPerShare",
  "DilutedEarningsLossPerShare",
  "Equity",
  "EquityAttributableToOwnersOfParent",
  "NoncontrollingInterests",
  "Assets",
  "Liabilities",
  "CashAndCashEquivalents",
  "CurrentInvestments",
  "Borrowings",
  "LongtermBorrowings",
  "ShorttermBorrowings",
  "CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings",
  "CurrentPortionOfLongtermBorrowings",
  "NoncurrentPortionOfNoncurrentBorrowings",
  "LeaseLiabilities",
  "CurrentLeaseLiabilities",
  "NoncurrentLeaseLiabilities",
  "FinanceCosts",
  "InterestExpense",
  "InterestExpenseOnBorrowings",
  "InterestExpenseOnBonds",
  "InterestExpenseOnLeaseLiabilities",
  "InterestPaidClassifiedAsOperatingActivities",
  "InterestPaidClassifiedAsFinancingActivities",
  "AdjustmentsForSharebasedPayments",
  "ExpenseFromSharebasedPaymentTransactionsWithEmployees",
  "DividendsPaid",
  "DividendsPaidClassifiedAsFinancingActivities",
  "Goodwill",
  "IntangibleAssetsOtherThanGoodwill",
  "ImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss",
  "NumberOfSharesOutstanding",
  "NumberOfShareOptionsOutstandingInSharebasedPaymentArrangement",
  "WeightedAverageExercisePriceOfShareOptionsOutstandingInSharebasedPaymentArrangement",
] as const;

const DEI = [
  // Acciones en circulación a la fecha de la carátula: la cifra más reciente que
  // publica un filing, distinta del promedio ponderado del período.
  "EntityCommonStockSharesOutstanding",
  "EntityPublicFloat",
] as const;

const SELECTED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["us-gaap", new Set<string>(US_GAAP)],
  ["ifrs-full", new Set<string>(IFRS_FULL)],
  ["dei", new Set<string>(DEI)],
]);

/**
 * Conceptos que conservan un ejercicio más como evidencia de splits: los que la
 * regla de base accionaria sabe re-expresar (ADR 0012). Todos están seleccionados.
 */
const SPLIT_EVIDENCE: ReadonlySet<string> = new Set(
  listSplitSensitiveConcepts(),
);

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

/**
 * Conceptos que conservan la historia que pide la capitalización (ADR 0037): la
 * I+D se amortiza sobre su vida, y la vida más larga de la tabla es 10 años.
 */
const CAPITALIZATION_HISTORY: ReadonlySet<string> = new Set([
  "us-gaap:ResearchAndDevelopmentExpense",
  "us-gaap:ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
]);

export function isCapitalizationHistoryConcept(
  taxonomy: string,
  concept: string,
): boolean {
  return CAPITALIZATION_HISTORY.has(`${taxonomy}:${concept}`);
}

/** Los conceptos de historia de capitalización, calificados y ordenados. */
export function listCapitalizationHistoryConcepts(): readonly string[] {
  return [...CAPITALIZATION_HISTORY].sort();
}

export function isSplitEvidenceConcept(
  taxonomy: string,
  concept: string,
): boolean {
  return SPLIT_EVIDENCE.has(`${taxonomy}:${concept}`);
}

/**
 * Los conceptos de evidencia, calificados y en orden estable. La poda los guarda
 * en su registro, así que el orden no puede depender del recorrido de un `Set`.
 */
export function listSplitEvidenceConcepts(): readonly string[] {
  return [...SPLIT_EVIDENCE].sort();
}
