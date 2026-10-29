import { describe, expect, it } from "vitest";

import { readGrowthTaxFilingEvidence } from "./read-growth-tax-filing";

const submissions = JSON.stringify({
  filings: {
    recent: {
      form: ["10-K"],
      accessionNumber: ["0000723125-26-000023"],
      acceptanceDateTime: ["2026-10-01T16:00:00.000Z"],
      primaryDocument: ["mu-20260903.htm"],
      reportDate: ["2026-09-03"],
    },
  },
});
const note = `<html><body>Income Taxes. As of September 3, 2026, U.S. federal net operating loss carryforwards of $125 million carry forward indefinitely and may offset up to 80% of taxable income.</body></html>`;
const input = {
  cik: "0000723125",
  knownAt: "2026-10-28T23:00:00.000Z",
  fiscalYearEnd: "2026-09-03",
};
function reader(answers: readonly (string | null)[]) {
  const calls: [string, string][] = [];
  const read = async (url: string, accept: string) => {
    calls.push([url, accept]);
    return answers[calls.length - 1] ?? null;
  };
  return { read, calls };
}

describe("growth tax filing source contract", () => {
  it("reads only the known 10-K through the supplied metered reader", async () => {
    const source = reader([submissions, note]);
    const result = await readGrowthTaxFilingEvidence(input, source.read);
    expect(result.status).toBe("ready");
    expect(source.calls).toEqual([
      [
        "https://data.sec.gov/submissions/CIK0000723125.json",
        "application/json",
      ],
      [
        "https://www.sec.gov/Archives/edgar/data/723125/000072312526000023/mu-20260903.htm",
        "text/html",
      ],
    ]);
  });

  it("does not open the HTML before its SEC acceptance or for a wrong year", async () => {
    for (const request of [
      { ...input, knownAt: "2026-10-01T15:59:59.000Z" },
      { ...input, fiscalYearEnd: "2025-09-04" },
    ]) {
      const source = reader([submissions, note]);
      expect(
        (await readGrowthTaxFilingEvidence(request, source.read)).status,
      ).toBe("unavailable");
      expect(source.calls).toHaveLength(1);
    }
  });

  it("fails closed on a missing source, bad JSON or missing note", async () => {
    for (const answers of [
      [null],
      ["{"],
      [submissions, null],
      [submissions, "<html></html>"],
    ]) {
      expect(
        (await readGrowthTaxFilingEvidence(input, reader(answers).read)).status,
      ).toBe("unavailable");
    }
  });
});
