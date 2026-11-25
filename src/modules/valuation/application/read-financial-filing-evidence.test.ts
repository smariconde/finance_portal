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
    const ctx = (id: string, period: string, member = "") =>
      `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">0000019617</identifier>${member === "" ? "" : `<segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">us-gaap:${member}</xbrldi:explicitMember></segment>`}</entity><period>${period}</period></context>`;
    const usd = (
      concept: string,
      id: string,
      value: string,
      unit = "usd",
      decimals = "-6",
    ) =>
      `<us-gaap:${concept} contextRef="${id}" unitRef="${unit}" decimals="${decimals}">${value}</us-gaap:${concept}>`;
    const instance = `<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<unit id="usd"><measure>iso4217:USD</measure></unit>
<unit id="shares"><measure>shares</measure></unit>
<unit id="eps"><divide><unitNumerator><measure>iso4217:USD</measure></unitNumerator><unitDenominator><measure>shares</measure></unitDenominator></divide></unit>
${ctx("close", "<instant>2025-12-31</instant>")}
${ctx("prior", "<instant>2024-12-31</instant>")}
${ctx("fy", "<startDate>2025-01-01</startDate><endDate>2025-12-31</endDate>")}
${usd("StockholdersEquity", "close", "1100")}
${usd("StockholdersEquity", "prior", "1000")}
${usd("PreferredStockValue", "close", "0")}
${usd("NetIncomeLoss", "fy", "100")}
${usd("EarningsPerShareBasic", "fy", "10", "eps", "0")}
${usd("WeightedAverageNumberOfSharesOutstandingBasic", "fy", "10", "shares", "0")}
${usd("ComprehensiveIncomeNetOfTax", "fy", "100")}
${usd("StatutoryAccountingPracticesStatutoryCapitalAndSurplusBalance", "close", "500")}
${usd("FinancingReceivableAllowanceForCreditLosses", "close", "7")}
</xbrl>`;
    const source = reader([submissions, "<table></table>", instance]);
    const result = await readFinancialFilingEvidence(input, source.read);
    expect(source.calls.at(-1)).toEqual([
      "https://www.sec.gov/Archives/edgar/data/19617/000162828026008131/jpm-20251231_htm.xml",
      "application/xml",
    ]);
    expect(result).toMatchObject({
      version: "financial-xbrl-evidence-1.0.0",
      commonIncome: { value: "100" },
      payout: "0",
    });
  });
});
