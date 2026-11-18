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

describe("growth-tax-evidence-2.0.0", () => {
  const derive = (note: string, fiscalYearEnd = "2026-09-03") =>
    deriveGrowthTaxEvidence({ html: filing(note), report, fiscalYearEnd });
  const federal = (note: string) => {
    const result = derive(note);
    if (result.status !== "ready") throw new Error(JSON.stringify(result));
    return result.evidence;
  };

  it("keeps the frozen MU 2026 note out: its pools are Malaysian, not federal", () => {
    expect(Buffer.byteLength(frozenMuNote)).toBe(frozenMuManifest.extractBytes);
    expect(createHash("sha256").update(frozenMuNote).digest("hex")).toBe(
      frozenMuManifest.extractSha256,
    );
    expect(frozenMuManifest.sourceUrl).toBe(report.url);
    const result = deriveGrowthTaxEvidence({
      html: frozenMuNote,
      report,
      fiscalYearEnd: "2026-09-03",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.evidence.basis).toBe("federal_amount_not_stated");
    expect(result.evidence.lossCarryforward.value).toBe("0");
  });

  it("takes a single stated federal pool at the TCJA cap, with its filing", () => {
    const evidence = federal(
      "As of September 3, 2026, we had U.S. federal net operating loss carryforwards of $125 million.",
    );
    expect(evidence.basis).toBe("federal_amount_stated");
    expect(evidence.lossCarryforward.value).toBe("125000000");
    expect(evidence.lossOffsetLimit).toBe("0.8");
    expect(evidence.lossCarryforward.sourceDocumentId).toBe(
      report.accessionNumber,
    );
  });

  it.each([
    // DDOG 2025
    [
      "As of December 31, 2025, we have approximately $340.2 million and $474.2 million of net operating loss carryforwards, or NOLs, for federal and state income tax purposes, respectively, which begin to expire in 2028 for state purposes if not utilized.",
      "340200000",
    ],
    // CRWD FY2026
    [
      "As of January 31, 2026, we had aggregate U.S federal and California net operating loss carryforwards of $2.6 billion and $417.4 million, respectively, which may be available to offset future taxable income for income tax purposes.",
      "2600000000",
    ],
    // RDDT 2025
    [
      "As of December 31, 2025, we had U.S. federal NOL carryforwards of approximately $1.7 billion and state NOL carryforwards of approximately $806.1 million available to offset future taxable income.",
      "1700000000",
    ],
    // UBER 2025: one tranche expires, the other is indefinite
    [
      "As of December 31, 2025, we had U.S. federal net operating loss carryforwards of $43 million that begin to expire in 2031 and $4.1 billion that have an unlimited carryover period.",
      "4143000000",
    ],
    // PLTR 2025: only the indefinite part has an amount
    [
      "The U.S. federal net operating loss carryforwards will expire at various dates beginning in 2035 through 2037 if not utilized, with the exception of $8.3 billion which can be carried forward indefinitely.",
      "8300000000",
    ],
  ] as const)(
    "reads the federal amount of a measured note %#",
    (note, value) => {
      expect(federal(note).lossCarryforward.value).toBe(value);
    },
  );

  it("reads the same federal amount stated twice as one pool", () => {
    expect(
      federal(
        "At December 31, 2025, the Company has net operating loss carryforwards for federal tax purposes of approximately $340.2 million, which is available to offset federal taxable income. As of December 31, 2025, we have approximately $340.2 million and $474.2 million of net operating loss carryforwards, or NOLs, for federal and state income tax purposes, respectively.",
      ).lossCarryforward.value,
    ).toBe("340200000");
  });

  it("reads ABNB's explicit absence as a zero with evidence", () => {
    const evidence = federal(
      "As of December 31, 2025, the Company had no remaining net operating loss carryforwards for federal income tax purposes.",
    );
    expect(evidence.basis).toBe("no_federal_carryforward_stated");
    expect(evidence.lossCarryforward.value).toBe("0");
  });

  it("values an unstated federal pool at zero and names it", () => {
    const evidence = federal(
      "Income taxes: we recorded a provision for income taxes of $12 million.",
    );
    expect(evidence.basis).toBe("federal_amount_not_stated");
    expect(evidence.lossCarryforward.value).toBe("0");
    expect(evidence.lossPolicyRationale).toMatch(/lower bound/u);
  });

  it("never reads a state-only amount as federal", () => {
    expect(
      federal(
        "We record an asset for unused U.S. federal, state, and foreign NOLs. As of December 31, 2025, we had U.S. state net operating loss carryforwards of $7.0 billion.",
      ).basis,
    ).toBe("federal_amount_not_stated");
  });

  it("refuses two different federal amounts in the same 10-K", () => {
    expect(
      derive(
        "We had U.S. federal net operating loss carryforwards of $125 million. We had U.S. federal net operating loss carryforwards of $140 million.",
      ),
    ).toEqual({ status: "unavailable", reason: "tax_pool_not_reconciled" });
  });

  it("refuses an amount next to a statement that none is left", () => {
    expect(
      derive(
        "We had U.S. federal net operating loss carryforwards of $125 million. The Company had no remaining net operating loss carryforwards for federal income tax purposes.",
      ),
    ).toEqual({ status: "unavailable", reason: "tax_pool_not_reconciled" });
  });

  it("refuses a document with no income tax content", () => {
    expect(
      deriveGrowthTaxEvidence({
        html: "<html><body><p>Nothing here.</p></body></html>",
        report,
        fiscalYearEnd: "2026-09-03",
      }),
    ).toEqual({
      status: "unavailable",
      reason: "tax_note_missing",
    });
  });

  it("does not use a 10-K from another fiscal year", () => {
    expect(
      derive(
        "U.S. federal net operating loss carryforwards of $125 million.",
        "2025-09-04",
      ),
    ).toEqual({ status: "unavailable", reason: "filing_year_mismatch" });
  });
});
