import { describe, expect, it } from "vitest";

import {
  instanceDocumentOf,
  readCaptiveFinanceFilingEvidence,
} from "./read-captive-finance-filing";

const submissions = JSON.stringify({
  filings: {
    recent: {
      form: ["10-K", "10-Q"],
      accessionNumber: ["0000018230-26-000008", "0000018230-26-000020"],
      acceptanceDateTime: [
        "2026-02-13T21:10:00.000Z",
        "2026-05-01T12:00:00.000Z",
      ],
      primaryDocument: ["cat-20251231.htm", "cat-20260331.htm"],
      reportDate: ["2025-12-31", "2026-03-31"],
    },
  },
});
const instance = `<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217">
<unit id="usd"><measure>iso4217:USD</measure></unit>
<context id="c-1"><entity><identifier scheme="http://www.sec.gov/CIK">0000018230</identifier></entity><period><instant>2025-12-31</instant></period></context>
<us-gaap:ShortTermBorrowings contextRef="c-1" unitRef="usd">5514000000</us-gaap:ShortTermBorrowings>
</xbrl>`;
const input = {
  cik: "0000018230",
  knownAt: "2026-11-18T00:00:00.000Z",
  fiscalYearEnd: "2025-12-31",
};

function reader(answers: readonly (string | null)[]) {
  const calls: [string, string][] = [];
  const read = async (url: string, accept: string) => {
    calls.push([url, accept]);
    return answers[calls.length - 1] ?? null;
  };
  return { read, calls };
}

describe("captive finance filing source contract", () => {
  it("names the instance EDGAR extracts next to the primary document", () => {
    expect(instanceDocumentOf("cat-20251231.htm")).toBe("cat-20251231_htm.xml");
    expect(instanceDocumentOf("de-20251102x10k.html")).toBe(
      "de-20251102x10k_htm.xml",
    );
    expect(instanceDocumentOf("report.txt")).toBeNull();
  });

  it("reads submissions, then the instance of the 10-K known at the cutoff", async () => {
    const source = reader([submissions, instance]);
    const filing = await readCaptiveFinanceFilingEvidence(input, source.read);

    expect(source.calls).toEqual([
      [
        "https://data.sec.gov/submissions/CIK0000018230.json",
        "application/json",
      ],
      [
        "https://www.sec.gov/Archives/edgar/data/18230/000001823026000008/cat-20251231_htm.xml",
        "application/xml",
      ],
    ]);
    expect(filing).toMatchObject({
      accessionNumber: "0000018230-26-000008",
      acceptedAt: "2026-02-13T21:10:00.000Z",
      reportDate: "2025-12-31",
    });
    expect(filing?.instance.facts).toHaveLength(1);
  });

  it("does not read a 10-K accepted after the cutoff", async () => {
    const source = reader([submissions, instance]);

    expect(
      await readCaptiveFinanceFilingEvidence(
        { ...input, knownAt: "2026-02-13T21:09:59.000Z" },
        source.read,
      ),
    ).toBeNull();
    expect(source.calls).toHaveLength(1);
  });

  it("does not read a 10-K of another fiscal year", async () => {
    const source = reader([submissions, instance]);

    expect(
      await readCaptiveFinanceFilingEvidence(
        { ...input, fiscalYearEnd: "2024-12-31" },
        source.read,
      ),
    ).toBeNull();
    expect(source.calls).toHaveLength(1);
  });

  it("returns nothing when a read fails or the instance is not one", async () => {
    for (const answers of [
      [null],
      ["not json"],
      [submissions, null],
      [submissions, "<html>10-K</html>"],
    ]) {
      expect(
        await readCaptiveFinanceFilingEvidence(input, reader(answers).read),
      ).toBeNull();
    }
  });
});
