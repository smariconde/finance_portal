import { htmlToText } from "@/modules/ingestion/domain/html-text";

/**
 * Secciones dirigidas de un 10-K (`F5-03`,
 * [ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md),
 * decisión 6): el Item 1 (Business) y la nota de segmentos, recortados a un
 * techo de bytes. Nunca el documento entero.
 *
 * Es una regla versionada y determinista, no un parser de 10-K:
 *
 * - el texto visible sale del HTML sin el encabezado `ix:header` del XBRL en
 *   línea, que está oculto y no es prosa, ni `head`, `script` o `style`;
 * - el Item 1 es el **primer** tramo de al menos `MIN_BUSINESS_CHARS` entre un
 *   «Item 1. Business» y el «Item 1A. Risk Factors» que lo sigue. El índice
 *   nombra los dos encabezados uno al lado del otro, así que su tramo es corto y
 *   no califica; las referencias cruzadas («ver Item 1 Business y la Nota 15»)
 *   vienen después del Item 1 real, así que no llegan a ganarle. Medido sobre
 *   Alphabet: elegir el tramo más largo tomaba una referencia del MD&A;
 * - la nota de segmentos es la mención de «segment information» después del
 *   Item 1 cuyo tramo siguiente más veces dice «segment». Es una heurística
 *   declarada: si cae en una referencia cruzada, el extracto sigue hablando de
 *   segmentos, y el Item 1 es la evidencia principal.
 *
 * El recorte es por bytes UTF-8, porque es lo que paga una reserva (un token
 * nunca es menos que un byte), y respeta los límites de carácter.
 */
export const SEC_10K_SECTIONS_VERSION = "sec-10k-sections-1.0.0";

export type TenKSectionId = "item_1_business" | "segment_note";

export type TenKSection = {
  readonly section: TenKSectionId;
  readonly text: string;
  readonly byteLength: number;
  /** El tramo seguía más allá del techo, o no se encontró dónde terminaba. */
  readonly truncated: boolean;
};

export type TenKSectionCeilings = {
  readonly businessBytes: number;
  readonly segmentBytes: number;
};

/**
 * Techos de la versión: ~28 KB de evidencia por pedido. Con tres escalones el
 * peor caso queda dentro de los USD 0,10 de una tarea con margen para la
 * repetición con búsqueda de `F5-04`.
 */
export const TEN_K_SECTION_CEILINGS: TenKSectionCeilings = Object.freeze({
  businessBytes: 20_000,
  segmentBytes: 8_000,
});

const BUSINESS_START = /\bitem\s*1\s*[.:–—-]?\s*business\b/giu;
const BUSINESS_END = /\bitem\s*1a\s*[.:–—-]?\s*risk\s+factors\b/giu;
/** Un tramo más corto es el índice, no la sección. */
const MIN_BUSINESS_CHARS = 2_000;
/**
 * Cómo titulan los filers la nota: «Segment Information», «Segment Reporting»,
 * «Information about Segments and Geographic Areas» (Alphabet), «Disclosures
 * about Segments and Related Information» (ExxonMobil).
 */
const SEGMENT_HEADING =
  /\b(?:segments?\s+(?:information|reporting|data|results)|(?:information|disclosures?)\s+(?:about|by)\s+(?:our\s+)?(?:reportable\s+|operating\s+|business\s+)?segments?)\b/giu;
const SEGMENT_WORD = /\bsegment/giu;

/** Texto visible de un documento de EDGAR. */
export function tenKVisibleText(html: string): string {
  return htmlToText(
    html
      .replace(/<ix:header\b[\s\S]*?<\/ix:header>/giu, " ")
      .replace(/<head\b[\s\S]*?<\/head>/giu, " ")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/giu, " ")
      // Los encabezados y los `span` de bloque separan palabras igual que un
      // `div`: sin esto, «Item 1.Business» y «Overview» quedan pegados.
      .replace(/<\/?(?:h[1-6]|section|article|header|footer)\b[^>]*>/giu, " "),
  );
}

const encoder = new TextEncoder();

/** Corta en el último carácter que entra en `maxBytes`. */
export function truncateUtf8(
  text: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  if (encoder.encode(text).byteLength <= maxBytes) {
    return { text, truncated: false };
  }

  let bytes = 0;
  let end = 0;

  for (const character of text) {
    const size = encoder.encode(character).byteLength;

    if (bytes + size > maxBytes) {
      break;
    }

    bytes += size;
    end += character.length;
  }

  return { text: text.slice(0, end).trimEnd(), truncated: true };
}

function positions(pattern: RegExp, text: string): number[] {
  return [...text.matchAll(pattern)].map((match) => match.index);
}

function section(
  id: TenKSectionId,
  span: string,
  maxBytes: number,
  cutAtSpanEnd: boolean,
): TenKSection | null {
  const trimmed = span.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const cut = truncateUtf8(trimmed, maxBytes);

  return {
    section: id,
    text: cut.text,
    byteLength: encoder.encode(cut.text).byteLength,
    truncated: cut.truncated || !cutAtSpanEnd,
  };
}

export type TenKSections = {
  readonly version: typeof SEC_10K_SECTIONS_VERSION;
  readonly business: TenKSection | null;
  readonly segments: TenKSection | null;
};

export function extractTenKSections(
  html: string,
  ceilings: TenKSectionCeilings = TEN_K_SECTION_CEILINGS,
): TenKSections {
  const text = tenKVisibleText(html);
  const starts = positions(BUSINESS_START, text);
  const ends = positions(BUSINESS_END, text);

  let business: { start: number; end: number; closed: boolean } | null = null;

  for (const start of starts) {
    const end = ends.find((candidate) => candidate > start);
    const span = {
      start,
      end: end ?? Math.min(text.length, start + ceilings.businessBytes * 2),
      closed: end !== undefined,
    };

    if (span.end - span.start >= MIN_BUSINESS_CHARS) {
      business = span;
      break;
    }
  }

  const searchFrom = business?.end ?? 0;
  let segment: { start: number; score: number } | null = null;

  for (const start of positions(SEGMENT_HEADING, text)) {
    if (start < searchFrom) {
      continue;
    }

    const window = text.slice(start, start + ceilings.segmentBytes);
    const score = positions(SEGMENT_WORD, window).length;

    if (segment === null || score > segment.score) {
      segment = { start, score };
    }
  }

  return {
    version: SEC_10K_SECTIONS_VERSION,
    business:
      business === null
        ? null
        : section(
            "item_1_business",
            text.slice(business.start, business.end),
            ceilings.businessBytes,
            business.closed,
          ),
    segments:
      segment === null
        ? null
        : section(
            "segment_note",
            text.slice(
              segment.start,
              segment.start + ceilings.segmentBytes * 2,
            ),
            ceilings.segmentBytes,
            true,
          ),
  };
}
