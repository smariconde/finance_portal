import { describe, expect, it } from "vitest";

import {
  extractTenKOutlook,
  TEN_K_OUTLOOK_CEILINGS,
  withoutMdnaBoilerplate,
} from "./sec-10k-outlook";

const filler = (word: string, count: number) =>
  Array.from({ length: count }, () => `${word} sentence.`).join(" ");

/** Un 10-K sintético: índice, los cuatro ítems y una referencia cruzada. */
function tenK(options: { mdna?: boolean; mdnaWords?: number } = {}): string {
  const mdna =
    options.mdna === false
      ? ""
      : `<h2>Item 7. Management's Discussion and Analysis of Financial Condition</h2><p>${filler("Services grew", options.mdnaWords ?? 400)}</p>
<h2>Item 7A. Quantitative and Qualitative Disclosures About Market Risk</h2><p>${filler("Rates", 50)}</p>`;

  return `<html><head><title>x</title></head><body>
<ix:header><p>hidden xbrl header</p></ix:header>
<p>Item 1. Business Item 1A. Risk Factors Item 1B. Unresolved Item 7. Management's Discussion and Analysis Item 7A. Quantitative</p>
<h2>Item 1. Business</h2><p>${filler("The company designs phones", 300)}</p>
<h2>Item 1A. Risk Factors</h2><p>${filler("Competition is intense", 300)}</p>
<h2>Item 1B. Unresolved Staff Comments</h2><p>None.</p>
${mdna}
<h2>Item 8. Financial Statements</h2><p>See Item 7. Management's Discussion and Analysis for details.</p>
</body></html>`;
}

describe("sec-10k-outlook-1.0.0", () => {
  it("cuts business, MD&A and the start of risk factors, skipping the index", () => {
    const outlook = extractTenKOutlook(tenK());

    expect(outlook.business?.text.startsWith("Item 1. Business")).toBe(true);
    expect(outlook.mdna?.text).toMatch(/^Item 7\. Management's Discussion/u);
    expect(outlook.mdna?.text).not.toContain("Item 7A");
    expect(outlook.mdna?.truncated).toBe(false);
    expect(outlook.risks?.text.startsWith("Item 1A. Risk Factors")).toBe(true);
    expect(outlook.risks?.text).not.toContain("hidden xbrl header");
  });

  it("caps every section by bytes and says it was truncated", () => {
    const outlook = extractTenKOutlook(tenK({ mdnaWords: 4000 }));

    expect(outlook.mdna?.byteLength).toBeLessThanOrEqual(
      TEN_K_OUTLOOK_CEILINGS.mdnaBytes,
    );
    expect(outlook.mdna?.truncated).toBe(true);
    expect(outlook.risks?.byteLength).toBeLessThanOrEqual(
      TEN_K_OUTLOOK_CEILINGS.riskBytes,
    );
    expect(outlook.risks?.truncated).toBe(true);
  });

  it("names an MD&A it cannot find as null, never a cross-reference", () => {
    const outlook = extractTenKOutlook(tenK({ mdna: false }));

    expect(outlook.mdna).toBeNull();
    expect(outlook.business).not.toBeNull();
  });
});

describe("withoutMdnaBoilerplate", () => {
  it("drops warnings, accounting estimates and liquidity up to the next performance heading", () => {
    const mdna = [
      "Item 7. Management's Discussion and Analysis.",
      "Forward-Looking Statements This report contains forward-looking statements.",
      "Overview We sell things.",
      "Critical Accounting Estimates Inventories are valued at cost.",
      "Liquidity and Capital Resources Cash was large.",
      "Results of Operations Net sales increased 11% in 2025.",
      "Guidance We expect growth.",
    ].join(" ");
    const kept = withoutMdnaBoilerplate(mdna);

    expect(kept).toContain("Overview We sell things.");
    expect(kept).toContain("Net sales increased 11% in 2025.");
    expect(kept).toContain("Guidance We expect growth.");
    expect(kept).not.toContain("forward-looking statements");
    expect(kept).not.toContain("Inventories are valued");
    expect(kept).not.toContain("Cash was large");
  });

  it("keeps an MD&A without boilerplate as it is", () => {
    const mdna = "Overview Revenue grew. Operating income rose.";

    expect(withoutMdnaBoilerplate(mdna)).toBe(mdna);
  });
});
