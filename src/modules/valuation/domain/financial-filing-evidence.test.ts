import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { SecAnnualReport } from "@/modules/fundamentals/domain/sec-annual-report";

import { deriveFinancialFilingEvidence } from "./financial-filing-evidence";

const html = readFileSync(
  resolve("tests/fixtures/sec/jpm-2025-financial-tables.html"),
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(
    resolve("tests/fixtures/sec/jpm-2025-financial-tables.manifest.json"),
    "utf8",
  ),
) as { extractSha256: string; extractBytes: number; sourceUrl: string };
const report: SecAnnualReport = {
  cik: "0000019617",
  accessionNumber: "0001628280-26-008131",
  acceptedAt: "2026-02-13T12:00:00.000Z",
  reportDate: "2025-12-31",
  primaryDocument: "jpm-20251231.htm",
  url: "https://www.sec.gov/Archives/edgar/data/19617/000162828026008131/jpm-20251231.htm",
};
const request = {
  html,
  report,
  fiscalYearEnd: "2025-12-31",
  priorFiscalYearEnd: "2024-12-31",
};

describe("financial-filing-evidence-1.1.0 bank", () => {
  it("matches the frozen SEC extract manifest", () => {
    expect(Buffer.byteLength(html)).toBe(manifest.extractBytes);
    expect(createHash("sha256").update(html).digest("hex")).toBe(
      manifest.extractSha256,
    );
    expect(manifest.sourceUrl).toBe(report.url);
  });
  it("reconciles JPM common book, common income and distributions from one 10-K", () => {
    const result = deriveFinancialFilingEvidence(request);
    expect(result).toMatchObject({
      status: "ready",
      evidence: {
        commonBook: { value: "342393000000", sourceId: "sec-edgar" },
        priorBook: { value: "324708000000" },
        commonIncome: { value: "55681000000" },
        commonDividends: { value: "16060000000" },
        netRepurchases: { value: "30573000000" },
        sourceDocumentId: report.accessionNumber,
      },
    });
    if (result.status === "ready") {
      expect(Number(result.evidence.payout)).toBeCloseTo(46633 / 55681);
      expect(result.evidence.regulatoryCapital).toContain("14.6%");
      expect(result.evidence.assetQuality).toContain("1.83%");
      expect(result.evidence.cleanSurplus).toContain("8637");
    }
  });

  it("rejects a changed equity row and an unsupported fiscal year", () => {
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        html: html.replaceAll("342,393", "342,394"),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "equity_bridge_mismatch",
    });
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        fiscalYearEnd: "2024-12-31",
      }),
    ).toMatchObject({ status: "unavailable", reason: "filing_year_mismatch" });
  });

  it("refuses missing source tables instead of using zero", () => {
    expect(
      deriveFinancialFilingEvidence({ ...request, html: "<table></table>" }),
    ).toMatchObject({
      status: "unavailable",
      reason: "table_missing_or_ambiguous",
    });
  });

  it("rejects distributions greater than earnings and failed capital requirements", () => {
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        html: html.replace("(16,060)", "(70,000)"),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "distribution_unsupported",
    });
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        html: html.replaceAll("14.6", "10.6"),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "capital_requirement_not_met",
    });
  });

  it("rejects a broken common-income bridge and a missing distribution", () => {
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        html: html.replaceAll("57,048", "57,049"),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "earnings_bridge_mismatch",
    });
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        html: html.replace("268", "269"),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "earnings_bridge_mismatch",
    });
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        html: html.replace("(30,573)", "—"),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "table_missing_or_ambiguous",
    });
  });
});
import { createHash } from "node:crypto";
