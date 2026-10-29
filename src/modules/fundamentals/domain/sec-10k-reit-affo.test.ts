import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractTenKReitAffo,
  REIT_AFFO_EXTRACT_MAX_BYTES,
} from "./sec-10k-reit-affo";

const filing = `
  <html><head><title>Do not use this AFFO heading</title></head><body>
  <ix:header><p>AFFO reconciliation 2025 999999</p></ix:header>
  <p>Item 1. Business</p><p>${"Properties and tenants. ".repeat(600)}</p>
  <table>
    <tr><th>Reconciliation of net income to FFO and AFFO, year ended December 31, 2025</th><th>USD millions</th></tr>
    <tr><td>Net income attributable to common</td><td>8</td></tr>
    <tr><td>Real estate depreciation</td><td>6</td></tr>
    <tr><td>FFO attributable to common</td><td>13</td></tr>
    <tr><td>Recurring capital expenditures and tenant improvements</td><td>2</td></tr>
    <tr><td>AFFO attributable to common</td><td>10</td></tr>
  </table>
  </body></html>`;

describe("10-K REIT AFFO extract", () => {
  it("selects the annual reconciliation and removes hidden inline-XBRL text", () => {
    const result = extractTenKReitAffo(filing, "2025-12-31");
    expect(result?.text).toContain(
      "Reconciliation of net income to FFO and AFFO",
    );
    expect(result?.text).toContain("Recurring capital expenditures");
    expect(result?.text).not.toContain("999999");
    expect(result?.byteLength).toBeLessThanOrEqual(REIT_AFFO_EXTRACT_MAX_BYTES);
  });

  it("refuses a glossary mention and a mismatched fiscal year", () => {
    expect(
      extractTenKReitAffo(
        "<p>AFFO means adjusted funds from operations.</p>",
        "2025-12-31",
      ),
    ).toBeNull();
    expect(extractTenKReitAffo(filing, "2024-12-31")).toBeNull();
  });

  it("refuses PLD's frozen 2025 FFO excerpt without an annual AFFO reconciliation", () => {
    const base = resolve("tests/fixtures/sec/pld-2025-reit-affo-excerpts");
    const excerpt = readFileSync(`${base}.txt`, "utf8").trimEnd();
    const manifest = JSON.parse(
      readFileSync(`${base}.manifest.json`, "utf8"),
    ) as {
      extractBytes: number;
      extractSha256: string;
      affoMentions: number;
    };
    expect(Buffer.byteLength(excerpt)).toBe(manifest.extractBytes);
    expect(createHash("sha256").update(excerpt).digest("hex")).toBe(
      manifest.extractSha256,
    );
    expect(manifest.affoMentions).toBe(0);
    expect(extractTenKReitAffo(excerpt, "2025-12-31")).toBeNull();
  });
});
