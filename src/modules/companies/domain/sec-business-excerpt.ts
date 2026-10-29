import { z } from "zod";

import { extractTenKSections } from "@/modules/fundamentals/domain/sec-10k-sections";

/** A short, verbatim business sentence from Item 1, never a generated claim. */
export const SEC_BUSINESS_EXCERPT_VERSION = "sec-business-excerpt-1.0.3";

export const businessExcerptSchema = z.object({
  legalEntityId: z.uuid(),
  cik: z.string().regex(/^[0-9]{10}$/u),
  accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
  acceptedAt: z.iso.datetime({ offset: true }),
  documentUrl: z.url().startsWith("https://www.sec.gov/Archives/edgar/data/"),
  excerpt: z.string().min(80).max(500),
  extractVersion: z.literal(SEC_BUSINESS_EXCERPT_VERSION),
  recordedAt: z.iso.datetime({ offset: true }),
});

export type BusinessExcerpt = z.infer<typeof businessExcerptSchema>;

const BUSINESS_VERB =
  /\b(?:provides?|offers?|develops?|designs?|manufactures?|produces?|operates?|sells?|markets?|distributes?|invests? in|engaged in|is a (?:global |leading |major |publicly traded )?(?:provider|manufacturer|developer|operator|retailer|bank|insurer|biopharmaceutical|technology|energy|financial services|real estate))\b/iu;
const BOILERPLATE =
  /\b(?:forward.look(?:ing)?|safe harbor|annual report|incorporated by reference|risk factors|statements? (?:in this report|regarding)|actual results|may differ materially|unless the context|when used in this report|dual.listed|as one enterprise|single economic enterprise|through (?:its )?(?:direct and indirect )?subsidiaries|mission to|revenue stream|also (?:offer|provide|operate)|divisions and affiliated companies|do not intend|cost.saving actions)\b/iu;

/** Refuses boilerplate, incomplete sentences and filings without a clear business statement. */
export function extractBusinessExcerpt(
  html: string,
  companyName: string,
): string | null {
  const business = extractTenKSections(html).business;
  if (business === null) return null;

  const text = business.text.replace(
    /^item\s*1\s*[.:–—-]?\s*business\.?\s*/iu,
    "",
  );
  const sentences = text.slice(0, 2_500).split(/(?<=[.!?])\s+(?=[A-Z“])/u);
  const companyStem = companyName.match(/[A-Za-z]{4,}/u)?.[0]?.toLowerCase();

  for (const sentence of sentences) {
    const candidate = sentence
      .trim()
      .replace(
        /^(?:Company Background|Business Overview|Overview|General)\s+/iu,
        "",
      );
    if (
      candidate.length >= 80 &&
      candidate.length <= 500 &&
      BUSINESS_VERB.test(candidate) &&
      !BOILERPLATE.test(candidate) &&
      (/^the (?:company|firm)\b/iu.test(candidate) ||
        (companyStem !== undefined &&
          new RegExp(`\\b${companyStem}\\b`, "iu").test(candidate)))
    ) {
      return candidate;
    }
  }

  return null;
}

/** A quote is publishable only if it occurs verbatim in the located Item 1. */
export function verifyBusinessExcerpt(html: string, quote: string): boolean {
  const section = extractTenKSections(html).business;
  const trimmed = quote.trim();
  return (
    section !== null &&
    trimmed.length >= 80 &&
    trimmed.length <= 500 &&
    section.text.includes(trimmed)
  );
}
