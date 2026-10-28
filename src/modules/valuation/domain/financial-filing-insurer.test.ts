import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { SecAnnualReport } from "@/modules/fundamentals/domain/sec-annual-report";

import { deriveFinancialFilingEvidence } from "./financial-filing-evidence";

const html = readFileSync(
  resolve("tests/fixtures/sec/pru-2025-financial-tables.html"),
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(
    resolve("tests/fixtures/sec/pru-2025-financial-tables.manifest.json"),
    "utf8",
  ),
) as { extractSha256: string; extractBytes: number; sourceUrl: string };
const report: SecAnnualReport = {
  cik: "0001137774",
  accessionNumber: "0001137774-26-000048",
  acceptedAt: "2026-02-12T22:16:21.000Z",
  reportDate: "2025-12-31",
  primaryDocument: "pru-20251231.htm",
  url: "https://www.sec.gov/Archives/edgar/data/1137774/000113777426000048/pru-20251231.htm",
};
const request = {
  html,
  report,
  fiscalYearEnd: "2025-12-31",
  priorFiscalYearEnd: "2024-12-31",
};

describe("financial-filing-evidence-1.1.0 insurer", () => {
  it("matches the frozen SEC extract manifest", () => {
    expect(Buffer.byteLength(html)).toBe(manifest.extractBytes);
    expect(createHash("sha256").update(html).digest("hex")).toBe(
      manifest.extractSha256,
    );
    expect(manifest.sourceUrl).toBe(report.url);
  });

  it("reconciles Prudential common equity, earnings and distribution", () => {
    const result = deriveFinancialFilingEvidence(request);
    expect(result).toMatchObject({
      status: "ready",
      evidence: {
        commonBook: { value: "32438000000" },
        priorBook: { value: "27872000000" },
        commonIncome: { value: "3535000000" },
        commonDividends: { value: "1932000000" },
        netRepurchases: { value: "1007000000" },
      },
    });
    if (result.status === "ready") {
      expect(Number(result.evidence.payout)).toBeCloseTo(2939 / 3535);
      expect(result.evidence.regulatoryCapital).toContain("2024");
      expect(result.evidence.regulatoryCapital).toContain("2025 aún no");
      expect(result.evidence.cleanSurplus).toContain("3970");
    }
  });

  it("rejects changed equity, income, payout and RBC evidence", () => {
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        html: html.replaceAll("32,438", "32,439"),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "equity_bridge_mismatch",
    });
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        html: html.replaceAll("3,576", "3,577"),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "earnings_bridge_mismatch",
    });
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        html: html.replaceAll("1,932", "3,932"),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "distribution_unsupported",
    });
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        html: html.replace("409%", "99%"),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "capital_requirement_not_met",
    });
  });

  it("refuses an unfiled regulatory date without the prior measured ratio", () => {
    expect(
      deriveFinancialFilingEvidence({
        ...request,
        html: html.replace("409%", "unknown"),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "table_missing_or_ambiguous",
    });
  });
});
