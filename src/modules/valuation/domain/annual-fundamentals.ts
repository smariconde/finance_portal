import { z } from "zod";

/**
 * Serie anual de fundamentals de un emisor, armada sobre lo que el contrato
 * point-in-time deja ver (`F3-01` a `F3-06`).
 *
 * Cada partida declara **conceptos alternativos en orden**, igual que las anclas
 * del gate de la Fase 2: los arquetipos no reportan los mismos conceptos, y la
 * alternativa escrita y nombrada en la salida es lo contrario de una sustitución
 * silenciosa. Una partida sin ninguna de sus alternativas queda ausente con su
 * nombre; nunca vale cero (`TM-05`).
 *
 * No normaliza ni suma conceptos: componer la deuda o el EBIT a partir de varias
 * partidas es una regla de quien consume la serie, con su propia versión.
 */
export const ANNUAL_FUNDAMENTALS_VERSION = "annual-fundamentals-1.0.0";

export const lineItemIdSchema = z.enum([
  "revenue",
  "operating_income",
  "pretax_income",
  "interest_expense",
  "income_tax",
  "net_income",
  "depreciation_amortization",
  "capital_expenditure",
  "operating_cash_flow",
  "research_development",
  "diluted_shares",
  "equity",
  "assets",
  "liabilities",
  "cash",
  "liquid_investments",
  "long_term_debt",
  "debt_current",
  "short_term_borrowings",
  "operating_lease_liability",
  "minority_interest",
  "shares_outstanding",
]);

export type LineItemId = z.infer<typeof lineItemIdSchema>;

export type LineItemDefinition = {
  readonly item: LineItemId;
  /** El resultado es un ejercicio; el balance, un instante al cierre. */
  readonly periodType: "annual" | "instant";
  /** Conceptos aceptados, en orden de preferencia. La salida dice cuál se usó. */
  readonly concepts: readonly string[];
};

export const LINE_ITEMS: readonly LineItemDefinition[] = Object.freeze([
  {
    item: "revenue",
    periodType: "annual",
    concepts: [
      "us-gaap:Revenues",
      "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
      "us-gaap:SalesRevenueNet",
    ],
  },
  {
    item: "operating_income",
    periodType: "annual",
    concepts: ["us-gaap:OperatingIncomeLoss"],
  },
  {
    item: "pretax_income",
    periodType: "annual",
    concepts: [
      "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ],
  },
  {
    item: "interest_expense",
    periodType: "annual",
    concepts: [
      "us-gaap:InterestExpense",
      "us-gaap:InterestExpenseNonoperating",
    ],
  },
  {
    item: "income_tax",
    periodType: "annual",
    concepts: ["us-gaap:IncomeTaxExpenseBenefit"],
  },
  {
    item: "net_income",
    periodType: "annual",
    concepts: ["us-gaap:NetIncomeLoss", "us-gaap:ProfitLoss"],
  },
  {
    item: "depreciation_amortization",
    periodType: "annual",
    concepts: [
      "us-gaap:DepreciationDepletionAndAmortization",
      "us-gaap:DepreciationAndAmortization",
    ],
  },
  {
    item: "capital_expenditure",
    periodType: "annual",
    concepts: ["us-gaap:PaymentsToAcquirePropertyPlantAndEquipment"],
  },
  {
    item: "operating_cash_flow",
    periodType: "annual",
    concepts: ["us-gaap:NetCashProvidedByUsedInOperatingActivities"],
  },
  {
    item: "research_development",
    periodType: "annual",
    concepts: ["us-gaap:ResearchAndDevelopmentExpense"],
  },
  {
    item: "diluted_shares",
    periodType: "annual",
    concepts: ["us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding"],
  },
  {
    // El patrimonio de la controlante primero: el distress y la deuda se miden
    // contra lo que es de los accionistas comunes.
    item: "equity",
    periodType: "instant",
    concepts: [
      "us-gaap:StockholdersEquity",
      "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
  },
  { item: "assets", periodType: "instant", concepts: ["us-gaap:Assets"] },
  {
    item: "liabilities",
    periodType: "instant",
    concepts: ["us-gaap:Liabilities"],
  },
  {
    item: "cash",
    periodType: "instant",
    concepts: [
      "us-gaap:CashAndCashEquivalentsAtCarryingValue",
      "us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
  },
  {
    item: "liquid_investments",
    periodType: "instant",
    concepts: [
      "us-gaap:MarketableSecuritiesCurrent",
      "us-gaap:ShortTermInvestments",
    ],
  },
  {
    item: "long_term_debt",
    periodType: "instant",
    concepts: ["us-gaap:LongTermDebt", "us-gaap:LongTermDebtNoncurrent"],
  },
  {
    item: "debt_current",
    periodType: "instant",
    concepts: ["us-gaap:DebtCurrent", "us-gaap:LongTermDebtCurrent"],
  },
  {
    item: "short_term_borrowings",
    periodType: "instant",
    concepts: ["us-gaap:ShortTermBorrowings", "us-gaap:CommercialPaper"],
  },
  {
    item: "operating_lease_liability",
    periodType: "instant",
    concepts: [
      "us-gaap:OperatingLeaseLiability",
      "us-gaap:OperatingLeaseLiabilityNoncurrent",
    ],
  },
  {
    item: "minority_interest",
    periodType: "instant",
    concepts: ["us-gaap:MinorityInterest"],
  },
  {
    item: "shares_outstanding",
    periodType: "instant",
    concepts: ["us-gaap:CommonStockSharesOutstanding"],
  },
]);

/** Todos los conceptos que la serie lee: la lista de métricas de la lectura. */
export function annualFundamentalsConcepts(): readonly string[] {
  return [...new Set(LINE_ITEMS.flatMap((definition) => definition.concepts))];
}

/** La parte de una observación que la serie necesita, sin acoplarse al tipo entero. */
export type FundamentalRow = {
  readonly observationId: string;
  /** Entidad legal que publicó la fila: el sujeto o un antecesor del linaje. */
  readonly subjectId: string;
  readonly concept: string;
  readonly periodType: string;
  readonly asOf: string;
  readonly periodStart: string | null;
  readonly unit: string;
  readonly currency: string | null;
  readonly value: string | null;
  readonly availableAt: string;
  readonly recordedAt: string;
  readonly sourceDocumentId: string | null;
};

export type LineItemValue = {
  readonly item: LineItemId;
  readonly concept: string;
  readonly value: string;
  readonly unit: string;
  readonly currency: string | null;
  readonly asOf: string;
  readonly observationId: string;
  readonly availableAt: string;
  readonly recordedAt: string;
  readonly sourceDocumentId: string | null;
};

export type FiscalYear = {
  readonly fiscalYearEnd: string;
  readonly items: Readonly<Partial<Record<LineItemId, LineItemValue>>>;
};

export type AnnualFundamentals = {
  readonly version: typeof ANNUAL_FUNDAMENTALS_VERSION;
  /** Más reciente primero. */
  readonly fiscalYears: readonly FiscalYear[];
};

/**
 * Tolerancia del cierre de ejercicio. Un año de 52/53 semanas termina el mismo día
 * de la semana y no el mismo día del mes —Apple cerró el 2020-09-26 y el
 * 2023-09-30—, así que se acepta el cierre a una semana del ancla.
 */
export const FISCAL_YEAR_END_TOLERANCE_DAYS = 7;

/** Un ejercicio dura entre 52 semanas y un año bisiesto más una semana. */
const MIN_FISCAL_YEAR_DAYS = 357;
const MAX_FISCAL_YEAR_DAYS = 373;

const DAY_MS = 86_400_000;

function dayOfYearDistance(left: string, anchor: string): number {
  const date = Date.parse(`${left}T00:00:00.000Z`);
  const year = Number.parseInt(left.slice(0, 4), 10);
  const monthDay = anchor.slice(4);

  return Math.min(
    ...[year - 1, year, year + 1].map((candidateYear) => {
      const candidate = Date.parse(`${candidateYear}${monthDay}T00:00:00.000Z`);

      return Number.isNaN(candidate)
        ? Number.POSITIVE_INFINITY
        : Math.abs(date - candidate) / DAY_MS;
    }),
  );
}

function durationDays(row: FundamentalRow): number | null {
  if (row.periodStart === null) {
    return null;
  }

  return (
    (Date.parse(`${row.asOf}T00:00:00.000Z`) -
      Date.parse(`${row.periodStart}T00:00:00.000Z`)) /
      DAY_MS +
    1
  );
}

/**
 * Un período anual es un **ejercicio** sólo si cierra cerca del ancla. Amazon
 * publica doce meses móviles que terminan en cada trimestre; tomarlos por
 * ejercicios contaría cuatro años por año.
 */
function isFiscalYearRow(row: FundamentalRow, anchor: string): boolean {
  const days = durationDays(row);

  return (
    row.periodType === "annual" &&
    days !== null &&
    days >= MIN_FISCAL_YEAR_DAYS &&
    days <= MAX_FISCAL_YEAR_DAYS &&
    dayOfYearDistance(row.asOf, anchor) <= FISCAL_YEAR_END_TOLERANCE_DAYS
  );
}

/**
 * El ancla con la que se reconocen los ejercicios, entre las del linaje.
 *
 * Un sucesor recién constituido todavía no cerró un ejercicio propio —el de
 * ExxonMobil registró como ancla el cierre de un 10-Q, 2026-06-30— y la historia
 * del grupo está del lado del antecesor (ADR 0011). Gana el ancla más reciente
 * cuyo día y mes coinciden con algún período anual visible: exigir la fecha
 * exacta fallaría en un corte histórico, donde el último ejercicio todavía no se
 * conocía. Sin ninguna, `null`: no se inventa una fecha.
 */
export function chooseFiscalYearAnchor(
  lineageAnchors: readonly string[],
  rows: readonly FundamentalRow[],
): string | null {
  const annualEnds = rows
    .filter((row) => row.periodType === "annual" && row.value !== null)
    .map((row) => row.asOf);

  return (
    [...new Set(lineageAnchors)]
      .sort()
      .reverse()
      .find((anchor) =>
        annualEnds.some(
          (end) =>
            dayOfYearDistance(end, anchor) <= FISCAL_YEAR_END_TOLERANCE_DAYS,
        ),
      ) ?? null
  );
}

/**
 * Arma la serie. `anchor` es el cierre anual con `fp = FY` que registró la
 * ingesta (ADR 0017), elegido a lo largo del linaje; `cutoffDate` es la fecha
 * efectiva de la consulta, y ningún ejercicio que cierre después entra.
 *
 * Las filas ya vienen elegidas por la política de revisión de la consulta: esta
 * función no decide qué versión de un hecho vale, sólo cuál de las alternativas
 * declaradas la aporta.
 */
export function buildAnnualFundamentals(
  rows: readonly FundamentalRow[],
  anchor: string,
  cutoffDate: string,
): AnnualFundamentals {
  // Orden fijo para que dos filas que compiten por la misma partida —un hecho de
  // un antecesor del linaje y el del sucesor— se resuelvan siempre igual: gana
  // la publicada más tarde, que es la que un lector de ese corte vería última.
  const usable = rows
    .filter((row) => row.value !== null && row.asOf <= cutoffDate)
    .sort(
      (left, right) =>
        right.availableAt.localeCompare(left.availableAt) ||
        left.observationId.localeCompare(right.observationId),
    );

  const fiscalYearEnds = [
    ...new Set(
      usable
        .filter((row) => isFiscalYearRow(row, anchor))
        .map((row) => row.asOf),
    ),
  ].sort((left, right) => right.localeCompare(left));

  const fiscalYears = fiscalYearEnds.map((fiscalYearEnd) => {
    const items: Partial<Record<LineItemId, LineItemValue>> = {};

    for (const definition of LINE_ITEMS) {
      for (const concept of definition.concepts) {
        const match = usable.find(
          (row) =>
            row.concept === concept &&
            row.asOf === fiscalYearEnd &&
            (definition.periodType === "instant"
              ? row.periodType === "instant"
              : isFiscalYearRow(row, anchor)),
        );

        if (match !== undefined) {
          items[definition.item] = {
            item: definition.item,
            concept,
            value: match.value!,
            unit: match.unit,
            currency: match.currency,
            asOf: match.asOf,
            observationId: match.observationId,
            availableAt: match.availableAt,
            recordedAt: match.recordedAt,
            sourceDocumentId: match.sourceDocumentId,
          };
          break;
        }
      }
    }

    return { fiscalYearEnd, items };
  });

  return { version: ANNUAL_FUNDAMENTALS_VERSION, fiscalYears };
}
