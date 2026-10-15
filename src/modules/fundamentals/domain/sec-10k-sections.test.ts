import { describe, expect, it } from "vitest";

import {
  extractTenKSections,
  tenKVisibleText,
  truncateUtf8,
} from "./sec-10k-sections";

/** Un 10-K sintético con lo que el cable real trae: índice, XBRL oculto y referencias cruzadas. */
function filing(options: { business?: string; segments?: string } = {}) {
  const business =
    options.business ??
    "Overview Fixture Corp designs and sells industrial robots. ".repeat(60);
  const segments =
    options.segments ??
    "We report two segments: Robots and Services. Segment revenue and segment operating income follow. ";

  return `<html><head><title>10-K</title><style>.x{}</style></head><body>
<div style="display:none"><ix:header><ix:hidden>Item 1. Business hidden-xbrl-fact</ix:hidden></ix:header></div>
<table><tr><td>Item 1. Business</td><td>3</td></tr><tr><td>Item 1A. Risk Factors</td><td>9</td></tr></table>
<p>See Part I, Item 1 "Business" for more.</p>
<h2>ITEM 1.BUSINESS</h2><p>${business}</p>
<h2>Item 1A. Risk Factors</h2><p>${"Our business has risks. ".repeat(40)}</p>
<p>Item 7. As described in Item 1 Business and Note 9, ${"management discussion. ".repeat(200)}</p>
<p>Item 1A Risk Factors are discussed above.</p>
<h3>Note 9. Segment Information</h3><p>${segments}</p>
<script>var Item1 = "Item 1. Business";</script>
</body></html>`;
}

describe("tenKVisibleText", () => {
  it("drops the hidden XBRL header, head, scripts and styles", () => {
    const text = tenKVisibleText(filing());

    expect(text).not.toContain("hidden-xbrl-fact");
    expect(text).not.toContain("var Item1");
    expect(text).not.toContain(".x{}");
    expect(text).toContain("ITEM 1.BUSINESS");
  });
});

describe("extractTenKSections", () => {
  it("takes the real Item 1, not the index entry nor a cross-reference", () => {
    const { business } = extractTenKSections(filing());

    expect(
      business?.text.startsWith("ITEM 1.BUSINESS Overview Fixture Corp"),
    ).toBe(true);
    expect(business?.text).not.toContain("Our business has risks");
    expect(business?.truncated).toBe(false);
  });

  it("finds the segment note after Item 1 by its heading", () => {
    const { segments } = extractTenKSections(filing());

    expect(segments?.section).toBe("segment_note");
    expect(segments?.text.startsWith("Segment Information")).toBe(true);
    expect(segments?.text).toContain("Robots and Services");
  });

  it("recognises the headings other filers use for the segment note", () => {
    for (const heading of [
      "Information about Segments and Geographic Areas",
      "Disclosures about Segments and Related Information",
      "Segment Reporting",
    ]) {
      const html = filing().replace("Note 9. Segment Information", heading);

      expect(extractTenKSections(html).segments?.text.startsWith(heading)).toBe(
        true,
      );
    }
  });

  it("cuts each section at its byte ceiling and says so", () => {
    const { business, segments } = extractTenKSections(filing(), {
      businessBytes: 500,
      segmentBytes: 120,
    });

    expect(business!.byteLength).toBeLessThanOrEqual(500);
    expect(business!.truncated).toBe(true);
    expect(segments!.byteLength).toBeLessThanOrEqual(120);
  });

  it("returns null for a document without an Item 1 long enough to be one", () => {
    const html =
      "<p>Item 1. Business 3 Item 1A. Risk Factors 9</p><p>No body here.</p>";

    expect(extractTenKSections(html)).toMatchObject({
      business: null,
      segments: null,
    });
  });
});

describe("truncateUtf8", () => {
  it("never splits a multi-byte character", () => {
    const cut = truncateUtf8("ab—cd", 4);

    expect(cut).toEqual({ text: "ab", truncated: true });
    expect(truncateUtf8("ab—cd", 5)).toEqual({ text: "ab—", truncated: true });
    expect(truncateUtf8("abc", 3)).toEqual({ text: "abc", truncated: false });
  });
});
