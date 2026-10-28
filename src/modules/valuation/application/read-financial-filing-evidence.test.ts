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
});
