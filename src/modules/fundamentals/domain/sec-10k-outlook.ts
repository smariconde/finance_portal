import {
  extractTenKSections,
  tenKVisibleText,
  truncateUtf8,
  type TenKSection,
} from "./sec-10k-sections";

/**
 * Las secciones de un 10-K que hablan del futuro del negocio (`F6-11`,
 * [ADR 0050](../../../../docs/architecture/adr/0050-market-expectations-reading.md)):
 * el Item 1 (Business), el Item 7 (MD&A) y el comienzo del Item 1A (Risk
 * Factors), recortados a techos de bytes. Nunca el documento entero.
 *
 * Usa las mismas reglas que `sec-10k-sections-1.0.0`: el texto visible sin el
 * encabezado XBRL, y cada ítem es el **primer** tramo de al menos
 * `MIN_SECTION_CHARS` entre su encabezado y el del ítem siguiente. El índice
 * nombra los encabezados juntos, así que su tramo es corto y no califica.
 * Versión propia: cambiarla no mueve la de la tarea de industria.
 *
 * Del MD&A se quitan las subsecciones que no hablan del desempeño —las
 * advertencias sobre declaraciones prospectivas, las estimaciones contables
 * críticas, la liquidez y los pronunciamientos contables— desde su encabezado
 * hasta el siguiente que sí lo hace. Medido sobre Amazon: sin esto, los
 * primeros 14 KB eran advertencias y estimaciones contables, y la discusión de
 * ventas por segmento quedaba afuera.
 */
export const SEC_10K_OUTLOOK_VERSION = "sec-10k-outlook-1.0.0";

export type TenKOutlookSectionId =
  "item_1_business" | "item_7_mdna" | "item_1a_risk_factors";

export type TenKOutlookSection = Omit<TenKSection, "section"> & {
  readonly section: TenKOutlookSectionId;
};

/** ~30 KB por pedido: el peor caso del escalón más caro queda bajo USD 0,10. */
export const TEN_K_OUTLOOK_CEILINGS = Object.freeze({
  businessBytes: 8_000,
  mdnaBytes: 18_000,
  riskBytes: 4_000,
});

const MIN_SECTION_CHARS = 2_000;
const MDNA_START =
  /\bitem\s*7\s*[.:–—-]?\s*management['’]?s\s+discussion\s+and\s+analysis\b/giu;
const MDNA_END =
  /\bitem\s*(?:7a\s*[.:–—-]?\s*quantitative|8\s*[.:–—-]?\s*financial\s+statements)\b/giu;
/** Subsecciones del MD&A que no hablan del desempeño del negocio. */
const MDNA_BOILERPLATE =
  /\b(?:forward-looking\s+statements|critical\s+accounting\s+(?:policies\s+and\s+)?estimates|liquidity\s+and\s+capital\s+resources|recent\s+accounting\s+pronouncements|off-balance\s+sheet\s+arrangements)\b/giu;
/**
 * Encabezados que vuelven a hablar del desempeño: ahí termina un recorte. Se
 * exigen como se imprimen, con mayúscula de título, porque las mismas palabras
 * en minúscula aparecen dentro de lo que se quita («revenue recognition»).
 */
const MDNA_PERFORMANCE =
  /\b(?:Overview|Results of Operations|Segment (?:Information|Operating Performance|Results)|Net Sales|Net Revenues?|Total Revenues?|Operating Income|Operating Expenses|Gross Margin|Guidance|Macroeconomic Conditions|Fiscal \d{4} Highlights)\b/gu;

const RISK_START = /\bitem\s*1a\s*[.:–—-]?\s*risk\s+factors\b/giu;
const RISK_END = /\bitem\s*1b\s*[.:–—-]?\s*unresolved\b/giu;

const encoder = new TextEncoder();

function firstSpan(
  text: string,
  start: RegExp,
  end: RegExp,
): { readonly span: string; readonly closed: boolean } | null {
  const ends = [...text.matchAll(end)].map((match) => match.index);

  for (const match of text.matchAll(start)) {
    const close = ends.find((candidate) => candidate > match.index);
    const stop = close ?? text.length;

    if (stop - match.index >= MIN_SECTION_CHARS) {
      return {
        span: text.slice(match.index, stop),
        closed: close !== undefined,
      };
    }
  }

  return null;
}

function mdnaOf(
  found: { readonly span: string; readonly closed: boolean } | null,
): { readonly span: string; readonly closed: boolean } | null {
  return found === null
    ? null
    : { span: withoutMdnaBoilerplate(found.span), closed: found.closed };
}

function cut(
  section: TenKOutlookSectionId,
  found: { readonly span: string; readonly closed: boolean } | null,
  maxBytes: number,
): TenKOutlookSection | null {
  const trimmed = found?.span.trim() ?? "";

  if (found === null || trimmed.length === 0) {
    return null;
  }

  const truncated = truncateUtf8(trimmed, maxBytes);

  return {
    section,
    text: truncated.text,
    byteLength: encoder.encode(truncated.text).byteLength,
    truncated: truncated.truncated || !found.closed,
  };
}

/** El MD&A sin sus subsecciones de advertencias, contabilidad y liquidez. */
export function withoutMdnaBoilerplate(mdna: string): string {
  const boilerplate = [...mdna.matchAll(MDNA_BOILERPLATE)].map(
    (match) => match.index,
  );
  const performance = [...mdna.matchAll(MDNA_PERFORMANCE)].map(
    (match) => match.index,
  );
  let kept = "";
  let cursor = 0;

  for (const start of boilerplate) {
    if (start < cursor) continue;

    const resume =
      performance.find((candidate) => candidate > start) ?? mdna.length;

    kept += mdna.slice(cursor, start);
    cursor = resume;
  }

  return kept + mdna.slice(cursor);
}

export type TenKOutlook = {
  readonly version: typeof SEC_10K_OUTLOOK_VERSION;
  readonly business: TenKOutlookSection | null;
  readonly mdna: TenKOutlookSection | null;
  readonly risks: TenKOutlookSection | null;
};

export function extractTenKOutlook(html: string): TenKOutlook {
  const text = tenKVisibleText(html);
  const { business } = extractTenKSections(html, {
    businessBytes: TEN_K_OUTLOOK_CEILINGS.businessBytes,
    segmentBytes: 1,
  });

  return {
    version: SEC_10K_OUTLOOK_VERSION,
    business:
      business === null ? null : { ...business, section: "item_1_business" },
    mdna: cut(
      "item_7_mdna",
      mdnaOf(firstSpan(text, MDNA_START, MDNA_END)),
      TEN_K_OUTLOOK_CEILINGS.mdnaBytes,
    ),
    risks: cut(
      "item_1a_risk_factors",
      firstSpan(text, RISK_START, RISK_END),
      TEN_K_OUTLOOK_CEILINGS.riskBytes,
    ),
  };
}
