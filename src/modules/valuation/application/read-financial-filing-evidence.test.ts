import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readFinancialFilingEvidence } from "./read-financial-filing-evidence";

const html = readFileSync(
  resolve("tests/fixtures/sec/jpm-2025-financial-tables.html"),
  "utf8",
);
const submissions = JSON.stringify({
  filings: {
    recent: {
      form: ["10-K"],
      accessionNumber: ["0001628280-26-008131"],
      acceptanceDateTime: ["2026-02-13T21:20:00.000Z"],
      primaryDocument: ["jpm-20251231.htm"],
      reportDate: ["2025-12-31"],
    },
  },
});
const input = {
  cik: "0000019617",
  knownAt: "2026-10-28T00:00:00.000Z",
  fiscalYearEnd: "2025-12-31",
  priorFiscalYearEnd: "2024-12-31",
};

function reader(answers: readonly (string | null)[]) {
  const calls: [string, string][] = [];
  const read = async (url: string, accept: string) => {
    calls.push([url, accept]);
    return answers[calls.length - 1] ?? null;
  };
  return { read, calls };
}

describe("financial filing source contract", () => {
  it("reads submissions then one known 10-K and validates reconciled facts", async () => {
    const source = reader([submissions, html]);
    const result = await readFinancialFilingEvidence(input, source.read);
    expect(result?.commonIncome.value).toBe("55681000000");
    expect(source.calls).toEqual([
      [
        "https://data.sec.gov/submissions/CIK0000019617.json",
        "application/json",
      ],
      [
        "https://www.sec.gov/Archives/edgar/data/19617/000162828026008131/jpm-20251231.htm",
        "text/html",
      ],
    ]);
  });

  it("refuses a filing not yet known without requesting its HTML", async () => {
    const source = reader([submissions, html]);
    expect(
      await readFinancialFilingEvidence(
        {
          ...input,
          knownAt: "2026-02-13T21:19:59.000Z",
        },
        source.read,
      ),
    ).toBeNull();
    expect(source.calls).toHaveLength(1);
  });

  it("refuses bad JSON, missing payloads, wrong year and unparseable tables", async () => {
    for (const answers of [
      [null],
      ["{"],
      [submissions, null],
      [submissions, "<table></table>"],
    ]) {
      expect(
        await readFinancialFilingEvidence(input, reader(answers).read),
      ).toBeNull();
    }
    const source = reader([submissions, html]);
    expect(
      await readFinancialFilingEvidence(
        { ...input, fiscalYearEnd: "2024-12-31" },
        source.read,
      ),
    ).toBeNull();
    expect(source.calls).toHaveLength(1);
  });

  it("falls back to the XBRL of the same 10-K when the tables are not recognized (F6-50)", async () => {
    const source = reader([submissions, "<table></table>", instance()]);
    const result = await readFinancialFilingEvidence(input, source.read);
    expect(source.calls.at(-1)).toEqual([
      "https://www.sec.gov/Archives/edgar/data/19617/000162828026008131/jpm-20251231_htm.xml",
      "application/xml",
    ]);
    expect(result).toMatchObject({
      version: "financial-xbrl-evidence-1.1.0",
      commonIncome: { value: "100" },
      payout: "0",
    });
  });

  it("reads a broker-dealer's XBRL directly and asks companyconcept for a year the 10-K no longer tags (F6-53)", async () => {
    const concept = JSON.stringify({
      cik: 19617,
      taxonomy: "us-gaap",
      tag: "PaymentsForRepurchaseOfCommonStock",
      label: "Payments for Repurchase of Common Stock",
      description: "synthetic",
      entityName: "Synthetic Dealer",
      units: {
        USD: [
          {
            start: "2023-01-01",
            end: "2023-12-31",
            val: 20,
            accn: "0001628280-25-000001",
            fy: 2024,
            fp: "FY",
            form: "10-K",
            filed: "2025-02-14",
          },
        ],
      },
    });
    const source = reader([
      submissions,
      instance({ repurchases: ["20", "20", null] }),
      concept,
    ]);
    const result = await readFinancialFilingEvidence(
      { ...input, assetProfile: "broker_dealer" },
      source.read,
    );
    expect(source.calls.map(([url]) => url)).toEqual([
      "https://data.sec.gov/submissions/CIK0000019617.json",
      "https://www.sec.gov/Archives/edgar/data/19617/000162828026008131/jpm-20251231_htm.xml",
      "https://data.sec.gov/api/xbrl/companyconcept/CIK0000019617/us-gaap/PaymentsForRepurchaseOfCommonStock.json",
    ]);
    expect(
      result?.payoutBasis?.years.map((year) => year.netRepurchases),
    ).toEqual(["20", "20", "20"]);
    expect(result?.payout).toBe("0.2");
  });

  it("refuses a companyconcept document of another filer", async () => {
    const concept = JSON.stringify({
      cik: 42,
      taxonomy: "us-gaap",
      tag: "PaymentsForRepurchaseOfCommonStock",
      units: { USD: [] },
    });
    const source = reader([
      submissions,
      instance({ repurchases: ["20", "20", null] }),
      concept,
    ]);
    expect(
      await readFinancialFilingEvidence(
        { ...input, assetProfile: "broker_dealer" },
        source.read,
      ),
    ).toBeNull();
  });
});

/** Un instance sintético de tres ejercicios con el patrimonio limpio cerrando. */
function instance(
  options: { readonly repurchases?: readonly (string | null)[] } = {},
): string {
  const ctx = (id: string, period: string) =>
    `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">0000019617</identifier></entity><period>${period}</period></context>`;
  const usd = (
    concept: string,
    id: string,
    value: string,
    unit = "usd",
    decimals = "-6",
  ) =>
    `<us-gaap:${concept} contextRef="${id}" unitRef="${unit}" decimals="${decimals}">${value}</us-gaap:${concept}>`;
  const years = [2025, 2024, 2023];
  const repurchases = options.repurchases ?? [null, null, null];
  return `<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<unit id="usd"><measure>iso4217:USD</measure></unit>
<unit id="shares"><measure>shares</measure></unit>
<unit id="eps"><divide><unitNumerator><measure>iso4217:USD</measure></unitNumerator><unitDenominator><measure>shares</measure></unitDenominator></divide></unit>
${[2025, 2024, 2023, 2022].map((year) => ctx(`c${year}`, `<instant>${year}-12-31</instant>`)).join("\n")}
${years.map((year) => ctx(`y${year}`, `<startDate>${year}-01-01</startDate><endDate>${year}-12-31</endDate>`)).join("\n")}
${usd("StockholdersEquity", "c2025", "1100")}
${usd("StockholdersEquity", "c2024", "1000")}
${usd("StockholdersEquity", "c2023", "900")}
${usd("StockholdersEquity", "c2022", "800")}
${usd("PreferredStockValue", "c2025", "0")}
${usd("PreferredStockValue", "c2024", "0")}
${years.map((year) => usd("NetIncomeLoss", `y${year}`, "100")).join("\n")}
${years.map((year) => usd("ComprehensiveIncomeNetOfTax", `y${year}`, "100")).join("\n")}
${years.map((year) => usd("PaymentsOfDividendsCommonStock", `y${year}`, "0")).join("\n")}
${years
  .map((year, index) =>
    repurchases[index] === null
      ? ""
      : usd(
          "PaymentsForRepurchaseOfCommonStock",
          `y${year}`,
          repurchases[index]!,
        ),
  )
  .join("\n")}
${usd("EarningsPerShareBasic", "y2025", "10", "eps", "0")}
${usd("WeightedAverageNumberOfSharesOutstandingBasic", "y2025", "10", "shares", "0")}
${usd("StatutoryAccountingPracticesStatutoryCapitalAndSurplusBalance", "c2025", "500")}
${usd("FinancingReceivableAllowanceForCreditLosses", "c2025", "7")}
</xbrl>`;
}
