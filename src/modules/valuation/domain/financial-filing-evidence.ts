import { z } from "zod";

import { htmlToText } from "@/modules/ingestion/domain/html-text";
import type { SecAnnualReport } from "@/modules/fundamentals/domain/sec-annual-report";
import {
  calendarDateSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import {
  divide,
  engineDecimalSchema,
  parseDecimal,
  ZERO,
  ONE,
} from "./decimal-policy";
import { monetaryFactSchema, type MonetaryFact } from "./valuation-facts";

export const FINANCIAL_FILING_EVIDENCE_VERSION =
  "financial-filing-evidence-1.1.0";

type Row = { readonly label: string; readonly numbers: readonly string[] };
type Table = { readonly text: string; readonly rows: readonly Row[] };

export const financialFilingEvidenceSchema = z.strictObject({
  version: z.literal(FINANCIAL_FILING_EVIDENCE_VERSION),
  fiscalYearEnd: calendarDateSchema,
  commonBook: monetaryFactSchema,
  priorBook: monetaryFactSchema,
  commonIncome: monetaryFactSchema,
  commonDividends: monetaryFactSchema,
  netRepurchases: monetaryFactSchema,
  payout: engineDecimalSchema,
  regulatoryCapital: z.string().trim().min(1).max(1024),
  assetQuality: z.string().trim().min(1).max(1024),
  cleanSurplus: z.string().trim().min(1).max(1024),
  sourceDocumentId: z.string().trim().min(1).max(256),
  availableAt: utcTimestampSchema,
});

export type FinancialFilingEvidence = z.infer<
  typeof financialFilingEvidenceSchema
>;

export type FinancialFilingResult =
  | { readonly status: "ready"; readonly evidence: FinancialFilingEvidence }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "filing_year_mismatch"
        | "table_missing_or_ambiguous"
        | "equity_bridge_mismatch"
        | "earnings_bridge_mismatch"
        | "distribution_unsupported"
        | "capital_requirement_not_met";
    };

function label(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function numeric(cell: string): string | null {
  const compact = cell.replace(/[$,%\s]/gu, "");
  if (!/^\(?[0-9][0-9,]*(?:\.[0-9]+)?\)?$/u.test(compact)) return null;
  const negative = compact.startsWith("(");
  const unsigned = compact.replace(/[(),]/gu, "");
  return negative ? `-${unsigned}` : unsigned;
}

/** The SEC's visible HTML cells, not hidden ix:header or narrative numbers. */
function tablesOf(html: string): readonly Table[] {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/giu)].map(
    (table) => {
      const rows = [
        ...table[1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu),
      ].map((row) => {
        const cells = [
          ...row[1]!.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/giu),
        ].map((cell) => htmlToText(cell[1]!));
        return {
          label: label(cells[0] ?? ""),
          numbers: cells
            .slice(1)
            .map(numeric)
            .filter((value): value is string => value !== null),
        };
      });
      return { text: label(htmlToText(table[1]!)), rows };
    },
  );
}

function row(table: Table, pattern: RegExp): Row | null {
  const matches = table.rows.filter((candidate) =>
    pattern.test(candidate.label),
  );
  return matches.length === 1 ? matches[0]! : null;
}

function oneTable(
  tables: readonly Table[],
  terms: readonly string[],
): Table | null {
  const matches = tables.filter((table) =>
    terms.every((term) => table.text.includes(term)),
  );
  return matches.length === 1 ? matches[0]! : null;
}

function value(table: Table, pattern: RegExp, index: number): string | null {
  return row(table, pattern)?.numbers[index] ?? null;
}

/** Prudential's 2025 insurance presentation keeps no preferred shares issued. */
function derivePrudentialEvidence(input: {
  readonly tables: readonly Table[];
  readonly html: string;
  readonly report: SecAnnualReport;
  readonly fiscalYearEnd: string;
  readonly priorFiscalYearEnd: string;
}): FinancialFilingResult {
  const { tables, html, report, fiscalYearEnd, priorFiscalYearEnd } = input;
  const balance = oneTable(tables, [
    "total prudential financial, inc. equity",
    "preferred stock",
    "none issued",
    "commercial mortgage and other loans",
  ]);
  const earnings = oneTable(tables, [
    "net income (loss) attributable to prudential financial, inc.",
    "less: income (loss) attributable to noncontrolling interests",
    "earnings per share",
  ]);
  const changes = oneTable(tables, [
    "total prudential financial, inc. equity",
    "dividends declared on common stock",
    `balance, december 31, ${fiscalYearEnd.slice(0, 4)}`,
  ]);
  const perShare = oneTable(tables, [
    "basic earnings per share",
    "participating unvested share-based payment awards",
    "available to holders of common stock",
  ]);
  if (
    balance === null ||
    earnings === null ||
    changes === null ||
    perShare === null
  )
    return { status: "unavailable", reason: "table_missing_or_ambiguous" };
  const currentYear = fiscalYearEnd.slice(0, 4);
  const priorYear = priorFiscalYearEnd.slice(0, 4);
  if (
    !balance.text.includes(currentYear) ||
    !balance.text.includes(priorYear) ||
    !earnings.text.includes(currentYear) ||
    !changes.text.includes(currentYear) ||
    !perShare.text.includes(currentYear)
  )
    return { status: "unavailable", reason: "filing_year_mismatch" };
  const current = value(
    balance,
    /^total prudential financial, inc\. equity$/u,
    0,
  );
  const prior = value(
    balance,
    /^total prudential financial, inc\. equity$/u,
    1,
  );
  const totalCurrent = value(balance, /^total equity$/u, 0);
  const totalPrior = value(balance, /^total equity$/u, 1);
  const noncontrolCurrent = value(balance, /^noncontrolling interests$/u, 0);
  const noncontrolPrior = value(balance, /^noncontrolling interests$/u, 1);
  const preferredCurrent = value(
    balance,
    /^preferred stock .*none issued\)$/u,
    0,
  );
  const preferredPrior = value(
    balance,
    /^preferred stock .*none issued\)$/u,
    1,
  );
  const incomeBridgeIndex = earnings.rows.findIndex(
    (candidate) =>
      candidate.label ===
      "less: income (loss) attributable to noncontrolling interests and redeemable noncontrolling interests",
  );
  const incomeRow = earnings.rows[incomeBridgeIndex + 1];
  const parentIncome =
    incomeBridgeIndex >= 0 &&
    incomeRow?.label ===
      "net income (loss) attributable to prudential financial, inc."
      ? (incomeRow.numbers[0] ?? null)
      : null;
  const allocation = value(
    perShare,
    /^less: dividends and undistributed earnings allocated to participating unvested share-based payment awards$/u,
    0,
  );
  const perShareIncomeRows = perShare.rows.filter(
    (candidate) =>
      candidate.label ===
      "net income (loss) attributable to prudential financial available to holders of common stock",
  );
  const income =
    perShareIncomeRows.length === 2
      ? (perShareIncomeRows[0]!.numbers[0] ?? null)
      : null;
  const totalIncome = value(earnings, /^net income \(loss\)$/u, 0);
  const noncontrolIncome = value(
    earnings,
    /^less: income \(loss\) attributable to noncontrolling interests and redeemable noncontrolling interests$/u,
    0,
  );
  const priorBalanceIndex = changes.rows.findIndex(
    (candidate) => candidate.label === `balance, december 31, ${priorYear}`,
  );
  const currentBalanceIndex = changes.rows.findIndex(
    (candidate) => candidate.label === `balance, december 31, ${currentYear}`,
  );
  if (priorBalanceIndex < 0 || currentBalanceIndex <= priorBalanceIndex)
    return { status: "unavailable", reason: "table_missing_or_ambiguous" };
  const currentChanges = changes.rows.slice(
    priorBalanceIndex + 1,
    currentBalanceIndex,
  );
  const fromChanges = (pattern: RegExp) => {
    const matches = currentChanges.filter((candidate) =>
      pattern.test(candidate.label),
    );
    return matches.length === 1 ? (matches[0]!.numbers[0] ?? null) : null;
  };
  const dividends = fromChanges(/^dividends declared on common stock$/u);
  const purchase = fromChanges(/^common stock acquired$/u);
  const statementIncome = fromChanges(/^net income \(loss\)$/u);
  const statementCurrent =
    changes.rows[currentBalanceIndex]!.numbers[5] ?? null;
  const statementPrior = changes.rows[priorBalanceIndex]!.numbers[5] ?? null;
  const loanRow = row(
    balance,
    /^commercial mortgage and other loans \(net of \$[\d,]+ and \$[\d,]+ allowance for credit losses;/u,
  );
  const allowances = loanRow?.label.match(
    /net of \$([\d,]+) and \$([\d,]+) allowance for credit losses/u,
  );
  const narrative = label(htmlToText(html));
  const rbc = narrative.match(
    new RegExp(
      `pica's rbc ratio as of december 31, ${priorYear}.{0,120}?was ([0-9]+)%`,
      "u",
    ),
  );
  const requirement = narrative.match(
    /([0-9]+)% regulatory required minimum that would require corrective action/u,
  );
  const rbcUnfiled = narrative.includes(
    `although not yet filed, we expect the rbc ratios for pica and our other domestic insurance subsidiaries as of december 31, ${currentYear}`,
  );
  const values = [
    current,
    prior,
    totalCurrent,
    totalPrior,
    noncontrolCurrent,
    noncontrolPrior,
    preferredCurrent,
    preferredPrior,
    parentIncome,
    allocation,
    income,
    totalIncome,
    noncontrolIncome,
    dividends,
    purchase,
    statementIncome,
    statementCurrent,
    statementPrior,
    loanRow?.numbers[0],
    loanRow?.numbers[1],
    allowances?.[1],
    allowances?.[2],
  ];
  if (
    values.some((item) => item === null || item === undefined) ||
    rbc === null ||
    requirement === null ||
    !rbcUnfiled
  )
    return { status: "unavailable", reason: "table_missing_or_ambiguous" };
  const dec = (amount: string) => parseDecimal(amount, "financialFiling");
  if (
    !dec(preferredCurrent!).eq(ZERO) ||
    !dec(preferredPrior!).eq(ZERO) ||
    !dec(current!).plus(dec(noncontrolCurrent!)).eq(dec(totalCurrent!)) ||
    !dec(prior!).plus(dec(noncontrolPrior!)).eq(dec(totalPrior!)) ||
    !dec(current!).eq(dec(statementCurrent!)) ||
    !dec(prior!).eq(dec(statementPrior!))
  )
    return { status: "unavailable", reason: "equity_bridge_mismatch" };
  if (
    !dec(totalIncome!).minus(dec(noncontrolIncome!)).eq(dec(parentIncome!)) ||
    !dec(parentIncome!).minus(dec(allocation!)).eq(dec(income!)) ||
    !dec(statementIncome!).eq(dec(parentIncome!)) ||
    !dec(perShareIncomeRows[1]!.numbers[0]!).eq(dec(income!))
  )
    return { status: "unavailable", reason: "earnings_bridge_mismatch" };
  if (!dec(rbc[1]!).gte(dec(requirement[1]!)))
    return { status: "unavailable", reason: "capital_requirement_not_met" };
  const distributions = dec(dividends!)
    .negated()
    .plus(dec(purchase!).negated());
  if (
    !dec(current!).gt(ZERO) ||
    !dec(prior!).gt(ZERO) ||
    !dec(income!).gt(ZERO) ||
    !dec(dividends!).lte(ZERO) ||
    !dec(purchase!).lte(ZERO) ||
    !distributions.gte(ZERO) ||
    !distributions.lte(dec(income!)) ||
    !dec(allowances![1]!.replaceAll(",", "")).gte(ZERO) ||
    !dec(allowances![2]!.replaceAll(",", "")).gte(ZERO)
  )
    return { status: "unavailable", reason: "distribution_unsupported" };
  const fact = (amount: string, asOf: string): MonetaryFact => ({
    value: dec(amount).times("1000000").toString(),
    asOf,
    currency: "USD",
    unit: "monetary",
    availableAt: report.acceptedAt,
    sourceId: "sec-edgar",
    sourceDocumentId: report.accessionNumber,
    observationId: null,
    qualityFlags: ["filing_table_reconciled"],
  });
  const residual = dec(current!)
    .minus(dec(prior!))
    .minus(dec(income!))
    .plus(distributions);
  return {
    status: "ready",
    evidence: financialFilingEvidenceSchema.parse({
      version: FINANCIAL_FILING_EVIDENCE_VERSION,
      fiscalYearEnd,
      commonBook: fact(current!, fiscalYearEnd),
      priorBook: fact(prior!, priorFiscalYearEnd),
      commonIncome: fact(income!, fiscalYearEnd),
      commonDividends: fact(
        dec(dividends!).negated().toString(),
        fiscalYearEnd,
      ),
      netRepurchases: fact(dec(purchase!).negated().toString(), fiscalYearEnd),
      payout: divide(distributions, dec(income!), "payout").toString(),
      regulatoryCapital: `PICA RBC ${rbc[1]}% al cierre ${priorYear} frente al mínimo regulatorio ${requirement[1]}%. La cifra ${currentYear} aún no estaba presentada en el 10-K; PICA es una subsidiaria, no el grupo consolidado (${report.accessionNumber}).`,
      assetQuality: `Reserva de pérdidas crediticias en préstamos hipotecarios comerciales y otros: USD ${allowances![1]} millones frente a USD ${allowances![2]} millones previos; préstamos netos USD ${loanRow!.numbers[0]} y ${loanRow!.numbers[1]} millones (${report.accessionNumber}); no prueba suficiencia de reservas.`,
      cleanSurplus: `Cambio del patrimonio común: USD ${dec(current!).minus(dec(prior!)).toString()} millones; utilidad disponible a comunes menos dividendos y recompras: USD ${dec(income!).minus(distributions).toString()} millones; residuo de OCI, asignación a premios en acciones y otros movimientos: USD ${residual.toString()} millones (${report.accessionNumber}).`,
      sourceDocumentId: report.accessionNumber,
      availableAt: report.acceptedAt,
    }),
  };
}

/**
 * A narrow, refusal-first reader for a bank 10-K. Every amount comes from one
 * cited filing; two independent equity/earnings identities must close.
 */
export function deriveFinancialFilingEvidence(input: {
  readonly html: string;
  readonly report: SecAnnualReport;
  readonly fiscalYearEnd: string;
  readonly priorFiscalYearEnd: string;
}): FinancialFilingResult {
  const { html, report, fiscalYearEnd, priorFiscalYearEnd } = input;
  if (
    report.reportDate !== fiscalYearEnd ||
    Number(fiscalYearEnd.slice(0, 4)) -
      Number(priorFiscalYearEnd.slice(0, 4)) !==
      1
  )
    return { status: "unavailable", reason: "filing_year_mismatch" };
  const tables = tablesOf(html);
  if (report.cik === "0001137774")
    return derivePrudentialEvidence({
      tables,
      html,
      report,
      fiscalYearEnd,
      priorFiscalYearEnd,
    });
  const equity = oneTable(tables, [
    "total stockholders' equity",
    "less: preferred stock",
    "common stockholders' equity",
    "in millions",
  ]);
  const distribution = oneTable(tables, [
    "net income applicable to common equity",
    "dividends declared on common stock",
    "net purchase of treasury stock",
    "in millions",
  ]);
  const earnings = oneTable(tables, [
    "net income applicable to common stockholders",
    "less: preferred stock dividends",
    "net income applicable to common equity",
    "in millions",
  ]);
  const perShare = oneTable(tables, [
    "basic earnings per share",
    "dividends and undistributed earnings allocated to participating securities",
    "net income applicable to common stockholders",
  ]);
  const capital = oneTable(tables, [
    "standardized",
    "capital ratio requirements",
    "cet1 capital ratio",
  ]);
  const quality = oneTable(tables, [
    "common stockholders' equity",
    "allowance for loan losses to total retained loans",
    "in millions",
  ]);
  if (
    [equity, distribution, earnings, perShare, capital, quality].some(
      (table) => table === null,
    )
  )
    return { status: "unavailable", reason: "table_missing_or_ambiguous" };

  const currentYear = fiscalYearEnd.slice(0, 4);
  const priorYear = priorFiscalYearEnd.slice(0, 4);
  for (const table of [equity!, earnings!, perShare!, capital!, quality!]) {
    if (!table.text.includes(currentYear) || !table.text.includes(priorYear))
      return { status: "unavailable", reason: "filing_year_mismatch" };
  }
  const current = value(equity!, /^common stockholders' equity$/u, 0);
  const prior = value(equity!, /^common stockholders' equity$/u, 1);
  const totalCurrent = value(equity!, /^total stockholders' equity$/u, 0);
  const totalPrior = value(equity!, /^total stockholders' equity$/u, 1);
  const preferredCurrent = value(equity!, /^less: preferred stock$/u, 0);
  const preferredPrior = value(equity!, /^less: preferred stock$/u, 1);
  const income = value(
    distribution!,
    /^net income applicable to common equity$/u,
    0,
  );
  const incomeBridge = value(
    earnings!,
    /^net income applicable to common equity$/u,
    0,
  );
  const totalIncome = value(earnings!, /^net income$/u, 0);
  const preferredDividends = value(
    earnings!,
    /^less: preferred stock dividends$/u,
    0,
  );
  const participating = value(
    perShare!,
    /^less: dividends and undistributed earnings allocated to participating securities$/u,
    0,
  );
  const availableRows = perShare!.rows.filter(
    (candidate) =>
      candidate.label === "net income applicable to common stockholders",
  );
  const availableIncome =
    availableRows.length === 2 ? (availableRows[0]!.numbers[0] ?? null) : null;
  const dividends = value(
    distribution!,
    /^dividends declared on common stock$/u,
    0,
  );
  const purchase = value(distribution!, /^net purchase of treasury stock$/u, 0);
  const cet1 = value(capital!, /^cet1 capital ratio$/u, 0);
  const cet1Requirement = value(capital!, /^cet1 capital ratio$/u, 2);
  const allowanceCurrent = value(
    quality!,
    /^allowance for loan losses to total retained loans$/u,
    0,
  );
  const allowancePrior = value(
    quality!,
    /^allowance for loan losses to total retained loans$/u,
    1,
  );
  const values = [
    current,
    prior,
    totalCurrent,
    totalPrior,
    preferredCurrent,
    preferredPrior,
    income,
    incomeBridge,
    totalIncome,
    preferredDividends,
    participating,
    availableIncome,
    dividends,
    purchase,
    cet1,
    cet1Requirement,
    allowanceCurrent,
    allowancePrior,
  ];
  if (values.some((item) => item === null))
    return { status: "unavailable", reason: "table_missing_or_ambiguous" };
  const dec = (value: string) => parseDecimal(value, "financialFiling");
  if (
    !dec(totalCurrent!).minus(dec(preferredCurrent!)).eq(dec(current!)) ||
    !dec(totalPrior!).minus(dec(preferredPrior!)).eq(dec(prior!))
  )
    return { status: "unavailable", reason: "equity_bridge_mismatch" };
  if (
    !dec(income!).eq(dec(incomeBridge!)) ||
    !dec(totalIncome!).minus(dec(preferredDividends!)).eq(dec(income!)) ||
    !dec(income!).minus(dec(participating!)).eq(dec(availableIncome!)) ||
    !dec(availableRows[1]!.numbers[0]!).eq(dec(availableIncome!))
  )
    return { status: "unavailable", reason: "earnings_bridge_mismatch" };
  if (!dec(cet1!).gte(dec(cet1Requirement!)))
    return { status: "unavailable", reason: "capital_requirement_not_met" };
  const commonDistributions = dec(dividends!)
    .negated()
    .plus(dec(purchase!).negated());
  if (
    !dec(current!).gt(ZERO) ||
    !dec(prior!).gt(ZERO) ||
    !dec(availableIncome!).gt(ZERO) ||
    !commonDistributions.gte(ZERO) ||
    !commonDistributions.lte(dec(availableIncome!)) ||
    !dec(allowanceCurrent!).gte(ZERO) ||
    !dec(allowancePrior!).gte(ZERO)
  )
    return { status: "unavailable", reason: "distribution_unsupported" };
  const payout = divide(commonDistributions, dec(availableIncome!), "payout");
  if (payout.lt(ZERO) || payout.gt(ONE))
    return { status: "unavailable", reason: "distribution_unsupported" };
  const fact = (amount: string, asOf: string): MonetaryFact => ({
    value: dec(amount).times("1000000").toString(),
    asOf,
    currency: "USD",
    unit: "monetary",
    availableAt: report.acceptedAt,
    sourceId: "sec-edgar",
    sourceDocumentId: report.accessionNumber,
    observationId: null,
    qualityFlags: ["filing_table_reconciled"],
  });
  const residual = dec(current!)
    .minus(dec(prior!))
    .minus(dec(availableIncome!))
    .plus(commonDistributions);
  return {
    status: "ready",
    evidence: financialFilingEvidenceSchema.parse({
      version: FINANCIAL_FILING_EVIDENCE_VERSION,
      fiscalYearEnd,
      commonBook: fact(current!, fiscalYearEnd),
      priorBook: fact(prior!, priorFiscalYearEnd),
      commonIncome: fact(availableIncome!, fiscalYearEnd),
      commonDividends: fact(
        dec(dividends!).negated().toString(),
        fiscalYearEnd,
      ),
      netRepurchases: fact(dec(purchase!).negated().toString(), fiscalYearEnd),
      payout: payout.toString(),
      regulatoryCapital: `CET1 consolidado ${cet1}% frente al requisito ${cet1Requirement}% (${report.accessionNumber}); verificación automática, no opinión de solvencia.`,
      assetQuality: `Reserva para pérdidas de préstamos / préstamos retenidos: ${allowanceCurrent}% frente a ${allowancePrior}% previo (${report.accessionNumber}); no prueba suficiencia de reservas.`,
      cleanSurplus: `Cambio del patrimonio común: USD ${dec(current!).minus(dec(prior!)).toString()} millones; utilidad disponible a comunes menos dividendos y recompras netas: USD ${dec(availableIncome!).minus(commonDistributions).toString()} millones; residuo OCI, asignación a valores participantes y otros movimientos: USD ${residual.toString()} millones (${report.accessionNumber}).`,
      sourceDocumentId: report.accessionNumber,
      availableAt: report.acceptedAt,
    }),
  };
}
