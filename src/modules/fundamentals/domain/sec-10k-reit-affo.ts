import { tenKVisibleText, truncateUtf8 } from "./sec-10k-sections";

/** A bounded annual FFO/AFFO reconciliation, never the whole filing. */
export const SEC_10K_REIT_AFFO_VERSION = "sec-10k-reit-affo-1.0.0";
export const REIT_AFFO_EXTRACT_MAX_BYTES = 14_000;

export type ReitAffoExtract = {
  readonly version: typeof SEC_10K_REIT_AFFO_VERSION;
  readonly text: string;
  readonly byteLength: number;
  readonly truncated: boolean;
};

const AFFO = /\b(?:adjusted\s+funds\s+from\s+operations|AFFO)\b/giu;
const FFO = /\b(?:funds\s+from\s+operations|FFO)\b/giu;
const RECONCILIATION = /\b(?:reconciliation|reconcile|adjustments?)\b/giu;
const MAINTENANCE =
  /\b(?:recurring\s+cap(?:ital\s+expenditures|ex)|property\s+improvements|tenant\s+improvements|leasing\s+commissions|turnover\s+costs)\b/giu;
const INCOME =
  /\b(?:net\s+(?:income|earnings)|attributable\s+to\s+common)\b/giu;

function count(pattern: RegExp, text: string): number {
  return [...text.matchAll(pattern)].length;
}

/**
 * Pick a table-like span with annual income, FFO, AFFO and maintenance. A
 * glossary definition or a quarterly-only table is not enough. The caller
 * still has to verify the period and every number against the same filing.
 */
export function extractTenKReitAffo(
  html: string,
  fiscalYearEnd: string,
): ReitAffoExtract | null {
  const visible = tenKVisibleText(html);
  const year = fiscalYearEnd.slice(0, 4);
  let best: { readonly text: string; readonly score: number } | null = null;

  for (const match of visible.matchAll(AFFO)) {
    const start = Math.max(0, match.index - 2_500);
    const span = visible.slice(
      start,
      match.index + REIT_AFFO_EXTRACT_MAX_BYTES,
    );
    if (
      !span.includes(year) ||
      count(FFO, span) < 2 ||
      count(RECONCILIATION, span) === 0 ||
      count(MAINTENANCE, span) === 0 ||
      count(INCOME, span) === 0
    )
      continue;
    const score =
      count(FFO, span) * 2 +
      count(RECONCILIATION, span) +
      count(MAINTENANCE, span) * 3 +
      count(INCOME, span);
    if (best === null || score > best.score) best = { text: span, score };
  }

  if (best === null) return null;
  const cut = truncateUtf8(best.text, REIT_AFFO_EXTRACT_MAX_BYTES);
  return {
    version: SEC_10K_REIT_AFFO_VERSION,
    text: cut.text,
    byteLength: new TextEncoder().encode(cut.text).byteLength,
    truncated: cut.truncated,
  };
}
