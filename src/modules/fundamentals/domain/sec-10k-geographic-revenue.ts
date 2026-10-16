import {
  tenKVisibleText,
  truncateUtf8,
  type TenKSection,
} from "./sec-10k-sections";

/**
 * La tabla de ingresos por geografía de un 10-K (`F5-05`,
 * [ADR 0034](../../../../docs/architecture/adr/0034-operations-weighted-country-risk.md),
 * decisión 3), recortada a un techo de bytes.
 *
 * Es una versión propia y no `sec-10k-sections-1.1.0`: la industria guarda la
 * versión de sus secciones, y moverla haría repreguntar por la misma evidencia.
 *
 * Los filers la ponen en lugares distintos —la nota de segmentos (Apple, Ford),
 * la desagregación de ingresos (Salesforce, Norwegian, Moderna), una nota de
 * información geográfica (Incyte)— y la titulan distinto. La regla es una
 * heurística declarada y determinista: cada mención geográfica abre una ventana,
 * y gana la ventana con más **filas de tabla geográfica** —una etiqueta de país
 * o región seguida de un monto— que además hable de ingresos. Una tabla de
 * activos de largo plazo o de cartera puede quedar en la misma ventana: el
 * modelo elige, y la policy compara el total con los ingresos del ejercicio.
 */
export const SEC_10K_GEOGRAPHIC_REVENUE_VERSION =
  "sec-10k-geographic-revenue-1.0.0";

/** Una tabla geográfica completa entra holgada; dos ventanas no. */
export const GEOGRAPHIC_REVENUE_CEILING_BYTES = 6_000;

/** Lo que se mira antes de la mención: el título de la tabla suele estar ahí. */
const LEAD_CHARS = 300;

/**
 * Dónde puede empezar una tabla geográfica: una mención de geografía, o una fila
 * de Estados Unidos con monto —Johnson & Johnson titula la suya «Sales to
 * Customers» lejos del encabezado de la nota—. El título decide si es de
 * ingresos.
 */
const ANCHOR =
  /\b(?:geograph\w*|by\s+(?:country|region|destination)|attributed\s+to\s+countries|(?:revenues?|net\s+sales|sales)\s+by\b|(?:United\s+States|U\.S\.)(?=\s*(?:\(\d{1,2}\)\s*)?\$?\s?[0-9]{1,3},[0-9]{3}))/giu;

const PLACE =
  /\b(?:United\s+States|U\.\s?S\.|Americas|North\s+America|Latin\s+America|South\s+America|Canada|Mexico|Brazil|Europe|EMEA|EAME|Middle\s+East|Africa|Asia|APAC|Greater\s+China|China|Japan|Taiwan|Korea|India|Australia|United\s+Kingdom|U\.K\.|Germany|France|Switzerland|Singapore|International|Non-U\.S\.|Other\s+countries|Rest\s+of\s+(?:the\s+)?world)\b/gu;
/**
 * Un monto de tabla: con separador de miles o decimales, y que no sea un
 * porcentaje ni una cifra de prosa («$4.9 billion»). Un año suelto no califica.
 */
const AMOUNT =
  /\$?\s?\(?[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\$?\s?\(?[0-9]+\.[0-9]+(?!\s*(?:%|percent|billion|million|trillion))/gu;
/** Cuánto puede separar una etiqueta de su monto en una tabla en columnas. */
const ROW_REACH = 200;
const REVENUE_WORD = /\b(?:revenues?|net\s+sales|sales)\b/iu;
/** Títulos de otra tabla que también tiene ingresos al lado: activos, impuestos. */
const NOT_REVENUE =
  /\b(?:long-lived\s+assets|loans|fixed\s+maturit|amortized\s+cost|municipal\s+bonds|deferred\s+tax|income\s+taxes|property\s+and\s+equipment)\b/giu;
/** Lo que nunca es una tabla de ingresos aunque diga «sales»: unidades, gente. */
const NEVER_REVENUE =
  /\b(?:units|employees|passengers|square\s+feet|facilities)\b/iu;

export type GeographicRevenueSection = {
  readonly version: typeof SEC_10K_GEOGRAPHIC_REVENUE_VERSION;
  readonly section: Omit<TenKSection, "section"> & {
    readonly section: "geographic_revenue";
  };
  /** Cuántas filas geográficas con monto tenía la ventana elegida. */
  readonly rows: number;
} | null;

/**
 * Lugares **distintos** con un monto de tabla a su alcance. Distintos, porque una
 * tabla por producto repite «U.S.» e «International» en cada fila y no es un mix.
 */
function geographicRows(window: string): number {
  const amounts = [...window.matchAll(AMOUNT)].map((match) => match.index);
  const places = new Set<string>();

  for (const place of window.matchAll(PLACE)) {
    const after = place.index + place[0].length;
    if (amounts.some((at) => at >= after && at - after <= ROW_REACH)) {
      places.add(
        place[0]
          .toLowerCase()
          .replace(/\s+/gu, " ")
          .replace(/^u\.\s?s\.$/u, "united states"),
      );
    }
  }

  return places.size;
}

/** Lo que se lee como título de la tabla, a cada lado de la mención. */
const TITLE_REACH = 300;
/** Donde se cuentan las filas: una tabla, no la nota entera. */
const BODY_CHARS = 1_200;
/** Un título que dice qué es la tabla vale más que uno que la menciona. */
const STRONG_TITLE =
  /\b(?:(?:revenues?|net\s+sales|sales)\s+(?:\w+\s+){0,3}by\s+(?:geograph\w*|country|region|destination)|geographic\s+(?:revenue|sales)|revenues?\s+from\s+external\s+customers|attributed\s+to\s+countries)\b/iu;

function scoreOf(text: string, anchor: number): number {
  const title = text.slice(
    Math.max(0, anchor - TITLE_REACH),
    anchor + TITLE_REACH,
  );

  if (!REVENUE_WORD.test(title)) return 0;

  const rows = geographicRows(text.slice(anchor, anchor + BODY_CHARS));

  if (rows < 2) return 0;

  // Un título que nombra activos, cartera o impuestos antes que ingresos es de
  // otra tabla; uno que nombra los dos («revenues and long-lived assets») no.
  const revenueAt = title.search(REVENUE_WORD);
  const distractedBefore = [...title.matchAll(NOT_REVENUE)].some(
    (match) => match.index < revenueAt,
  );

  return (
    rows +
    (STRONG_TITLE.test(title) ? 10 : 0) -
    (distractedBefore || NEVER_REVENUE.test(title) ? 10 : 0)
  );
}

export function extractGeographicRevenueFromText(
  text: string,
  ceilingBytes: number = GEOGRAPHIC_REVENUE_CEILING_BYTES,
): GeographicRevenueSection {
  let best: { start: number; score: number; rows: number } | null = null;

  for (const match of text.matchAll(ANCHOR)) {
    const score = scoreOf(text, match.index);

    // A igual puntaje gana la primera: la tabla viene antes que sus
    // referencias.
    if (score > 0 && (best === null || score > best.score)) {
      best = {
        start: Math.max(0, match.index - LEAD_CHARS),
        score,
        rows: geographicRows(text.slice(match.index, match.index + BODY_CHARS)),
      };
    }
  }

  if (best === null) return null;

  const cut = truncateUtf8(
    text.slice(best.start, best.start + ceilingBytes * 2).trim(),
    ceilingBytes,
  );

  return {
    version: SEC_10K_GEOGRAPHIC_REVENUE_VERSION,
    section: {
      section: "geographic_revenue",
      text: cut.text,
      byteLength: new TextEncoder().encode(cut.text).byteLength,
      truncated: cut.truncated,
    },
    rows: best.rows,
  };
}

export function extractGeographicRevenue(
  html: string,
  ceilingBytes: number = GEOGRAPHIC_REVENUE_CEILING_BYTES,
): GeographicRevenueSection {
  return extractGeographicRevenueFromText(tenKVisibleText(html), ceilingBytes);
}
