import { describe, expect, it } from "vitest";

import { readDilutedSharesFilingEvidence } from "./read-diluted-shares-filing";

const CIK = "0000000042";
const submissions = JSON.stringify({
  filings: {
    recent: {
      form: ["10-K", "10-Q"],
      accessionNumber: ["0000000042-26-000008", "0000000042-26-000020"],
      acceptanceDateTime: [
        "2026-02-13T21:10:00.000Z",
        "2026-05-01T12:00:00.000Z",
      ],
      primaryDocument: ["acme-20251231.htm", "acme-20260331.htm"],
      reportDate: ["2025-12-31", "2026-03-31"],
    },
  },
});
const instance = `<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<unit id="usd"><measure>iso4217:USD</measure></unit>
<unit id="shares"><measure>shares</measure></unit>
<unit id="usdPerShare"><divide><unitNumerator><measure>iso4217:USD</measure></unitNumerator><unitDenominator><measure>shares</measure></unitDenominator></divide></unit>
<context id="fy"><entity><identifier scheme="http://www.sec.gov/CIK">${CIK}</identifier></entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
<context id="fy-a"><entity><identifier scheme="http://www.sec.gov/CIK">${CIK}</identifier><segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">us-gaap:CommonClassAMember</xbrldi:explicitMember></segment></entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
<us-gaap:NetIncomeLoss contextRef="fy" unitRef="usd" decimals="-6">1000000000</us-gaap:NetIncomeLoss>
<us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding contextRef="fy-a" unitRef="shares" decimals="-6">80000000</us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding>
<us-gaap:EarningsPerShareDiluted contextRef="fy-a" unitRef="usdPerShare" decimals="2">12.50</us-gaap:EarningsPerShareDiluted>
</xbrl>`;
const input = {
  ciks: [CIK],
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

describe("diluted shares filing source contract", () => {
  it("reads submissions, then the instance of the 10-K of the latest fiscal year", async () => {
    const source = reader([submissions, instance]);
    const result = await readDilutedSharesFilingEvidence(input, source.read);

    expect(source.calls).toEqual([
      [
        "https://data.sec.gov/submissions/CIK0000000042.json",
        "application/json",
      ],
      [
        "https://www.sec.gov/Archives/edgar/data/42/000000004226000008/acme-20251231_htm.xml",
        "application/xml",
      ],
    ]);
    expect(result).toMatchObject({
      status: "reconciled",
      reconciled: {
        member: "CommonClassAMember",
        accessionNumber: "0000000042-26-000008",
        availableAt: "2026-02-13T21:10:00.000Z",
      },
    });
  });

  it("does not read a 10-K accepted after the cutoff or of another year", async () => {
    const late = reader([submissions, instance]);
    expect(
      await readDilutedSharesFilingEvidence(
        { ...input, knownAt: "2026-02-13T21:09:59.000Z" },
        late.read,
      ),
    ).toEqual({ status: "unavailable", reason: "filing_unavailable" });
    expect(late.calls).toHaveLength(1);

    const other = reader([submissions, instance]);
    expect(
      await readDilutedSharesFilingEvidence(
        { ...input, fiscalYearEnd: "2024-12-31" },
        other.read,
      ),
    ).toEqual({ status: "unavailable", reason: "filing_unavailable" });
  });

  it("falls back to a declared predecessor whose 10-K closes the year", async () => {
    const holding = JSON.stringify({
      filings: {
        recent: {
          form: ["8-K12B"],
          accessionNumber: ["0000000099-26-000001"],
          acceptanceDateTime: ["2026-09-01T12:00:00.000Z"],
          primaryDocument: ["holding.htm"],
          reportDate: ["2026-09-01"],
        },
      },
    });
    const source = reader([holding, submissions, instance]);
    const result = await readDilutedSharesFilingEvidence(
      { ...input, ciks: ["0000000099", CIK] },
      source.read,
    );
    expect(source.calls.map(([url]) => url)).toEqual([
      "https://data.sec.gov/submissions/CIK0000000099.json",
      "https://data.sec.gov/submissions/CIK0000000042.json",
      "https://www.sec.gov/Archives/edgar/data/42/000000004226000008/acme-20251231_htm.xml",
    ]);
    expect(result).toMatchObject({ status: "reconciled" });
  });

  it("names a missing instance instead of guessing", async () => {
    const source = reader([submissions, null]);
    expect(await readDilutedSharesFilingEvidence(input, source.read)).toEqual({
      status: "unavailable",
      reason: "filing_unavailable",
    });
  });
});
