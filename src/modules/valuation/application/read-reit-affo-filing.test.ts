import { describe, expect, it, vi } from "vitest";

import { readReitAffoFilingEvidence } from "./read-reit-affo-filing";

const request = {
  cik: "0001045609",
  knownAt: "2026-10-29T00:00:00.000Z",
  fiscalYearEnd: "2025-12-31",
};

const submissions = JSON.stringify({
  filings: {
    recent: {
      form: ["10-K"],
      accessionNumber: ["0001193125-26-051453"],
      acceptanceDateTime: ["2026-02-12T17:00:00.000Z"],
      primaryDocument: ["pld-20251231.htm"],
      reportDate: ["2025-12-31"],
    },
  },
});

const reconciliation = `
  <p>Reconciliation of net income to FFO and AFFO for the year ended December 31, 2025 (USD millions)</p>
  <p>Net income attributable to common 8</p>
  <p>Real estate depreciation 6</p>
  <p>FFO attributable to common 13</p>
  <p>Recurring capital expenditures and tenant improvements 2</p>
  <p>AFFO attributable to common 10</p>`;

describe("read REIT AFFO filing evidence", () => {
  it("returns only a bounded, dated extract of the matching 10-K", async () => {
    const read = vi
      .fn<(url: string, accept: string) => Promise<string | null>>()
      .mockResolvedValueOnce(submissions)
      .mockResolvedValueOnce(reconciliation);
    const result = await readReitAffoFilingEvidence(request, read);

    expect(result).toMatchObject({
      status: "ready",
      sourceDocumentId: "0001193125-26-051453",
      availableAt: "2026-02-12T17:00:00.000Z",
      extract: {
        text: expect.stringContaining("Recurring capital expenditures"),
      },
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]?.[0]).toBe(
      "https://www.sec.gov/Archives/edgar/data/1045609/000119312526051453/pld-20251231.htm",
    );
  });

  it("refuses a year mismatch before requesting the filing", async () => {
    const read = vi.fn().mockResolvedValueOnce(submissions);
    expect(
      await readReitAffoFilingEvidence(
        { ...request, fiscalYearEnd: "2024-12-31" },
        read,
      ),
    ).toEqual({ status: "unavailable", reason: "filing_year_mismatch" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("names missing evidence without inventing an AFFO", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(submissions)
      .mockResolvedValueOnce("<p>AFFO is a non-GAAP measure.</p>");
    expect(await readReitAffoFilingEvidence(request, read)).toEqual({
      status: "unavailable",
      reason: "annual_reconciliation_missing",
    });
  });

  it("refuses invalid submissions and an unavailable filing", async () => {
    expect(
      await readReitAffoFilingEvidence(request, async () => "not json"),
    ).toEqual({ status: "unavailable", reason: "submissions_unavailable" });
    const read = vi
      .fn()
      .mockResolvedValueOnce(submissions)
      .mockResolvedValueOnce(null);
    expect(await readReitAffoFilingEvidence(request, read)).toEqual({
      status: "unavailable",
      reason: "filing_unavailable",
    });
  });
});
