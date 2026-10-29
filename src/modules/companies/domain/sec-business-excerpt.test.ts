import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  extractBusinessExcerpt,
  verifyBusinessExcerpt,
} from "./sec-business-excerpt";

function corpus(cik: string): string {
  const text = readFileSync(
    `src/modules/ai-evals/infrastructure/corpus/${cik}/item_1_business.txt`,
    "utf8",
  );
  return `<h2>${text}</h2>`;
}

describe("extractBusinessExcerpt", () => {
  it("extracts a verbatim business sentence from the frozen SEC corpus", () => {
    const source = corpus("0000879169");
    const excerpt = extractBusinessExcerpt(source, "Incyte Corp");
    expect(excerpt).toContain("Incyte is a global biopharmaceutical company");
    expect(source).toContain(excerpt);
  });

  it("skips forward-looking boilerplate and can refuse a poor filing", () => {
    expect(
      extractBusinessExcerpt(corpus("0000815097"), "Carnival Corp"),
    ).toBeNull();
  });

  it("does not invent a description when Item 1 is absent", () => {
    expect(
      extractBusinessExcerpt("<h1>Risk Factors</h1>", "Example Inc"),
    ).toBeNull();
  });

  it("keeps the company sentence after an introductory heading", () => {
    const sentence =
      "The Company designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories, and sells a variety of related services.";
    const html = `<h2>Item 1. Business</h2><p>Company Background ${sentence} ${"More information about the products and services follows. ".repeat(60)}</p><h2>Item 1A. Risk Factors</h2>`;
    expect(extractBusinessExcerpt(html, "Apple Inc")).toBe(sentence);
    expect(verifyBusinessExcerpt(html, sentence)).toBe(true);
    expect(
      verifyBusinessExcerpt(html, "The Company only sells computers."),
    ).toBe(false);
  });
});
