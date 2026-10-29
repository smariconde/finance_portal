import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { deriveGrowthTaxEvidence } from "./growth-tax-evidence";

const report = {
  cik: "0000723125",
  accessionNumber: "0000723125-26-000023",
  acceptedAt: "2026-10-01T16:00:00.000Z",
  reportDate: "2026-09-03",
  primaryDocument: "mu-20260903.htm",
  url: "https://www.sec.gov/Archives/edgar/data/723125/000072312526000023/mu-20260903.htm",
};
const filing = (note: string) =>
  `<html><body><h2>Income Taxes</h2><p>${note}</p></body></html>`;
const frozenMuNote = readFileSync(
  resolve("tests/fixtures/sec/mu-2026-growth-tax-note.txt"),
  "utf8",
);
const frozenMuManifest = JSON.parse(
  readFileSync(
    resolve("tests/fixtures/sec/mu-2026-growth-tax-note.manifest.json"),
    "utf8",
  ),
) as { extractBytes: number; extractSha256: string; sourceUrl: string };

describe("growth tax evidence", () => {
  it("rejects the frozen MU 2026 SEC note with a verified extract hash", () => {
    expect(Buffer.byteLength(frozenMuNote)).toBe(frozenMuManifest.extractBytes);
    expect(createHash("sha256").update(frozenMuNote).digest("hex")).toBe(
      frozenMuManifest.extractSha256,
    );
    expect(frozenMuManifest.sourceUrl).toBe(report.url);
    expect(
      deriveGrowthTaxEvidence({
        html: frozenMuNote,
        report,
        fiscalYearEnd: "2026-09-03",
      }),
    ).toEqual({
      status: "unavailable",
      reason: "jurisdictions_not_reconciled",
    });
  });

  it("accepts only a single dated U.S. federal pool with a disclosed cap", () => {
    const result = deriveGrowthTaxEvidence({
      html: filing(
        "As of September 3, 2026, we had U.S. federal net operating loss carryforwards of $125 million. These carry forward indefinitely and may offset up to 80% of taxable income.",
      ),
      report,
      fiscalYearEnd: "2026-09-03",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.evidence.lossCarryforward.value).toBe("125000000");
    expect(result.evidence.lossOffsetLimit).toBe("0.8");
    expect(result.evidence.lossCarryforward.sourceDocumentId).toBe(
      report.accessionNumber,
    );
  });

  it("refuses MU's Malaysia and other jurisdiction pools as one shield", () => {
    expect(
      deriveGrowthTaxEvidence({
        html: filing(
          "Net operating loss carryforwards totaled $1,680 million, primarily in Malaysia ($1,460 million) with no expiration; the remainder expires between 2027 and 2046.",
        ),
        report,
        fiscalYearEnd: "2026-09-03",
      }),
    ).toEqual({
      status: "unavailable",
      reason: "jurisdictions_not_reconciled",
    });
  });

  it.each([
    ["no note", "tax_note_missing"],
    [
      "U.S. federal net operating loss carryforwards of $125 million expire in 2030 and may offset up to 80% of taxable income.",
      "tax_pool_not_reconciled",
    ],
    [
      "U.S. federal net operating loss carryforwards of $125 million carry forward indefinitely.",
      "tax_pool_not_reconciled",
    ],
    [
      "U.S. federal net operating loss carryforwards of $125 million carry forward indefinitely and may offset up to 120% of taxable income.",
      "tax_pool_not_reconciled",
    ],
  ] as const)("refuses missing or incomplete policy %#", (note, reason) => {
    expect(
      deriveGrowthTaxEvidence({
        html: filing(note),
        report,
        fiscalYearEnd: "2026-09-03",
      }),
    ).toEqual({ status: "unavailable", reason });
  });

  it("does not use a 10-K from another fiscal year", () => {
    expect(
      deriveGrowthTaxEvidence({
        html: filing(
          "U.S. federal net operating loss carryforwards of $125 million carry forward indefinitely and may offset up to 80% of taxable income.",
        ),
        report,
        fiscalYearEnd: "2025-09-04",
      }),
    ).toEqual({ status: "unavailable", reason: "filing_year_mismatch" });
  });
});
