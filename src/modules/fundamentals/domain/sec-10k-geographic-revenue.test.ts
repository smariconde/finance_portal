import { describe, expect, it } from "vitest";

import {
  SEC_10K_GEOGRAPHIC_REVENUE_VERSION,
  extractGeographicRevenue,
  extractGeographicRevenueFromText,
} from "./sec-10k-geographic-revenue";

/** Relleno de prosa: ningún lugar, ningún monto. */
function prose(words: number): string {
  return Array.from({ length: words }, (_, index) => `word${index % 7}`).join(
    " ",
  );
}

const ROW_TABLE =
  "Revenue by Geographic Area Revenues attributed to countries based on the location of the customer were as follows (in millions): 2025 2024 United States $ 9,034 $ 7,806 Switzerland 5,334 4,251 Japan 2,850 5,930 China 636 743 Other 1,038 1,079 Total $ 19,892 $ 19,809";

describe("sec-10k-geographic-revenue-1.0.0", () => {
  it("cuts the revenue table by country and names its version", () => {
    const result = extractGeographicRevenueFromText(
      `${prose(400)} ${ROW_TABLE} ${prose(400)}`,
    );

    expect(result?.version).toBe(SEC_10K_GEOGRAPHIC_REVENUE_VERSION);
    expect(result?.section.section).toBe("geographic_revenue");
    expect(result?.section.text).toContain("United States $ 9,034");
    expect(result?.section.text).toContain("Total $ 19,892");
    expect(result?.rows).toBe(4);
  });

  it("reads a table laid out in columns, labels first and amounts below", () => {
    const columns =
      "Revenue by geographic area is as follows: U.S. Europe Canada Asia Pacific Other (1) Consolidated (in thousands) Fiscal Year 2025 $ 2,141,773 $ 1,102,696 $ 501,025 $ 205,023 $ 64,865 $ 4,015,382";

    expect(
      extractGeographicRevenueFromText(`${prose(300)} ${columns}`)?.section
        .text,
    ).toContain("$ 2,141,773");
  });

  it("keeps a row whose label carries a footnote marker", () => {
    const footnoted =
      "Summarized geographic information related to the Company's operating revenues (in millions): United States (2) 6,629.4 6,353.3 Brazil 708.3 786.1 Mexico 508.9 544.9 Germany 455.5 402.2 Total operating revenues $ 10,644.6";

    expect(extractGeographicRevenueFromText(footnoted)?.rows).toBe(4);
  });

  it("prefers the geographic table over a product table that repeats U.S. and International", () => {
    const products = Array.from(
      { length: 6 },
      (_, index) =>
        `FRANCHISE ${index} U.S. 1,754 1,684 International 2,157 2,049 Worldwide 3,910 3,733`,
    ).join(" ");
    const text = `Sales to Customers (Dollars in Millions) ${products} ${prose(300)} Sales to Customers Long-Lived Assets (Dollars in Millions) 2025 2024 United States $53,752 50,302 Europe 21,535 20,212 Western Hemisphere excluding U.S. 4,875 4,714 Asia-Pacific, Africa 14,031 13,593 Worldwide total $94,193 88,821`;

    expect(extractGeographicRevenueFromText(text)?.section.text).toContain(
      "Europe 21,535",
    );
  });

  it("never takes a units table, even when its title says sales", () => {
    const units =
      "Wholesales (in thousands of units) 2025 2024 United States 2,105 2,200 China 379 442 Canada 292 269 United Kingdom 218 242 Germany 155 155";
    const revenue =
      "Geographic Information We report revenue on a where-sold basis. Total Company revenues and long-lived assets, split geographically (in millions): United States $ 122,574 $ 44,994 Canada 14,548 8,567 United Kingdom 12,298 2,260 Mexico 2,463 3,515 All Other 35,384 6,492 Total Company $ 187,267";

    expect(
      extractGeographicRevenueFromText(`${units} ${prose(600)} ${revenue}`)
        ?.section.text,
    ).toContain("$ 122,574");
  });

  it("does not mistake a table of assets or portfolio for revenue", () => {
    const assets =
      "Geographical Exposure The following table indicates the geographic exposure of the Company's fixed maturity securities: Japan $ 35,775 44.0 % United States and Canada 30,191 37.1 United Kingdom 2,607 3.2 Germany 1,846 2.3";

    expect(extractGeographicRevenueFromText(assets)).toBeNull();
  });

  it("returns null when the filing has no geographic revenue table", () => {
    expect(
      extractGeographicRevenueFromText(
        `${prose(500)} Our operations are located in the Southeast and Midwest regions of the U.S. ${prose(500)}`,
      ),
    ).toBeNull();
  });

  it("ignores prose amounts in billions and percentages", () => {
    const narrative =
      "International sales increased 13% in 2025. Changes in foreign exchange rates increased International net sales by $4.9 billion and reduced North America net sales by $454 million. Europe grew 7.5% and Japan 3.2%.";

    expect(extractGeographicRevenueFromText(narrative)).toBeNull();
  });

  it("cuts to the ceiling on a character boundary and says so", () => {
    const result = extractGeographicRevenueFromText(
      `${ROW_TABLE} ${prose(2_000)}`,
      400,
    );

    expect(result?.section.byteLength).toBeLessThanOrEqual(400);
    expect(result?.section.truncated).toBe(true);
  });

  it("reads the visible text of the filing, not its hidden XBRL header", () => {
    const html = `<html><body><ix:header><div>Revenue by geographic area United States $ 9,999 Japan 8,888</div></ix:header><p>${prose(50)}</p><div>${ROW_TABLE}</div></body></html>`;

    expect(extractGeographicRevenue(html)?.section.text).not.toContain("9,999");
  });
});
