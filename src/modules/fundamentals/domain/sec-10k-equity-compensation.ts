import {
  tenKVisibleText,
  truncateUtf8,
  type TenKSection,
} from "./sec-10k-sections";

/**
 * La nota de compensación en acciones de un 10-K (`F4-05`,
 * [ADR 0040](../../../../docs/architecture/adr/0040-failure-probability-employee-options.md),
 * decisión 5), recortada a un techo de bytes: la evidencia de la que la IA
 * transcribe opciones vivas, su strike y plazo, y las unidades de acciones no
 * consolidadas.
 *
 * Versión propia, como la tabla geográfica: mover la de las secciones haría
 * repreguntar por la evidencia de la industria.
 *
 * Los filers la titulan distinto —«Share-Based Compensation» (Apple), «Common
 * stock, stock option plans and stock compensation agreements» (Johnson &
 * Johnson), «Stock option activity» dentro de la nota de patrimonio
 * (Salesforce)— y ponen las tablas de opciones y de unidades a pocos KB una de
 * otra. La regla es una heurística declarada y determinista: cada ancla
 * —título de nota o de tabla de actividad— se puntúa por el vocabulario de
 * tabla que la sigue, gana la mejor, y el recorte empieza en la primera ancla
 * con puntaje de su grupo, para que opciones y unidades entren juntas.
 *
 * `1.1.0` (`F6-13`): la fila de saldo también es «Outstanding on January 1,
 * 2025» (Coca-Cola) y la versalita «OUTSTANDING AT JULY 1, 2025» (Procter &
 * Gamble). Con `1.0.0` las dos notas puntuaban cero y la tarea salteaba con
 * `equity_note_not_found`, lo que dejaba la corrida sin snapshot.
 *
 * `1.2.0` (`F6-16`): más formas de la fila de saldo, medidas en los 10-K que
 * salteaban —«Outstanding December 31, 2025» sin preposición (Merck),
 * «Nonvested, March 31, 2026» (Deckers), «Unvested as of December 31, 2025»
 * (Align) y «Outstanding at the end of 2026» (Costco)—. Y el estado de
 * patrimonio deja de ganar: Costco imprime «BALANCE AT SEPTEMBER 1, 2024» en
 * versalitas junto a «Release of vested RSUs», y `1.1.0` recortaba ahí. Un
 * cuerpo con resultado neto y dividendos o recompras es ese estado, no la
 * nota, y el «BALANCE» en versalitas ya no cuenta como saldo.
 */
export const SEC_10K_EQUITY_COMPENSATION_VERSION =
  "sec-10k-equity-compensation-1.2.0";

/** Opciones y unidades de una nota entran; la nota entera de otra no. */
export const EQUITY_COMPENSATION_CEILING_BYTES = 12_000;

const ANCHOR =
  /\b(?:(?:stock|share|equity)[-\s]based\s+(?:compensation|payment|awards?)|stock\s+option\s+plans?|stock\s+compensation|equity\s+incentive\s+plans?|(?:stock\s+)?option\s+activity|summary\s+of\s+(?:the\s+)?(?:\w+[’']?s?\s+){0,4}(?:stock\s+)?(?:options?|RSUs?|restricted\s+(?:stock|share)\s+units?)|restricted\s+(?:stock|share)\s+(?:units?\s+)?activity|restricted\s+stock\s+and\s+(?:restricted\s+stock\s+)?units|incentive\s+program|RSU\s+activity)\b/giu;

/**
 * Vocabulario propio de premios en acciones. «Outstanding» o «balance» solos no
 * cuentan: el estado de patrimonio los repite en cada fila y no es la nota.
 */
const AWARD_TERMS =
  /\b(?:options?|exercise\s+price|contractual\s+(?:life|term)|granted|exercised|vested|forfeited|canceled|cancelled|exercisable|restricted\s+(?:stock|share)\s+units?|RSUs?|performance(?:-based)?\s+(?:share|stock|restricted\s+stock)\s+units?|PSUs?|PRSUs?)\b/giu;
/** Menos que esto en la tabla que sigue al ancla no es una nota de premios. */
const MIN_AWARD_TERMS = 3;

/**
 * Una fila con saldo: «Balance as of …», «Shares at …», «Outstanding at …»,
 * «Outstanding on …» u «Outstanding December 31, 2025» —con o sin año:
 * ExxonMobil imprime «Issued and outstanding at December 31» y deja el año en el
 * encabezado—, «Nonvested, March 31, 2026», «Unvested as of …», la misma fila en
 * versalitas, u «Outstanding, end of year …» (Ford) y «Outstanding at the end of
 * 2026» (Costco). Sin preposición sólo con mes y día: «outstanding 2025» en
 * prosa no es una fila.
 */
const BALANCE_LABEL =
  "(?:[Bb]alance|[Ss]hares|SHARES|[Oo]utstanding|OUTSTANDING|[Nn]on-?vested|NONVESTED|[Uu]nvested|UNVESTED)";
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH = `(?:${[...MONTH_NAMES, ...MONTH_NAMES.map((name) => name.toUpperCase())].join("|")})`;
const MONTH_DAY = `${MONTH}\\s+[0-9]{1,2}(?:,\\s+[0-9]{4})?`;
const PREPOSITION = "(?:as\\s+of|AS\\s+OF|at|AT|on|ON)";
const BALANCE_ROW = new RegExp(
  [
    "\\b(?:",
    `${BALANCE_LABEL},?\\s+(?:${PREPOSITION}\\s+)?${MONTH_DAY}\\b`,
    `|${BALANCE_LABEL}\\s+${PREPOSITION}\\s+[0-9]{4}\\b`,
    "|(?:[Bb]alance|[Oo]utstanding|[Nn]on-?vested|[Uu]nvested),?\\s+(?:at\\s+)?(?:the\\s+)?end\\s+of\\s+(?:the\\s+)?(?:fiscal\\s+)?(?:year|period|[0-9]{4})\\b",
    ")[^.]{0,80}?[0-9]{1,3}(?:,[0-9]{3})*",
  ].join(""),
  "gu",
);

/**
 * El estado de patrimonio: resultado neto y, cerca, dividendos o recompras.
 * Tiene saldos y «vested RSUs», pero no es la nota.
 */
const EQUITY_STATEMENT =
  /\bnet\s+income\b[\s\S]{0,600}?\b(?:dividends?\s+declared|repurchases?\s+of\s+common\s+stock|common\s+stock\s+repurchased)\b/iu;

/** Dónde se cuenta el vocabulario: la tabla que sigue al ancla. */
const BODY_CHARS = 4_000;
/** Lo que se mira antes del ancla: el número y título de la nota. */
const LEAD_CHARS = 200;
/** Cuán atrás puede estar otra ancla del mismo grupo. */
const GROUP_REACH = 6_000;

export type EquityCompensationSection = {
  readonly version: typeof SEC_10K_EQUITY_COMPENSATION_VERSION;
  readonly section: Omit<TenKSection, "section"> & {
    readonly section: "equity_compensation";
  };
  /** Puntaje del ancla elegida: términos de tabla más filas de saldo. */
  readonly score: number;
} | null;

function scoreOf(text: string, anchor: number): number {
  const body = text.slice(anchor, anchor + BODY_CHARS);
  const terms = [...body.matchAll(AWARD_TERMS)].length;
  const balances = [...body.matchAll(BALANCE_ROW)].length;

  // Sin una fila de saldo no hay tabla, y sin vocabulario de premios la tabla
  // es de otra cosa: el estado de patrimonio también tiene saldos.
  return balances === 0 ||
    terms < MIN_AWARD_TERMS ||
    EQUITY_STATEMENT.test(body.slice(0, 1_500))
    ? 0
    : terms + balances * 5;
}

/** Cada ancla con su posición y su puntaje, en orden de aparición. */
export function rankEquityCompensationAnchors(
  text: string,
): readonly { at: number; anchor: string; score: number }[] {
  return [...text.matchAll(ANCHOR)].map((match) => ({
    at: match.index,
    anchor: match[0],
    score: scoreOf(text, match.index),
  }));
}

export function extractEquityCompensationFromText(
  text: string,
  ceilingBytes: number = EQUITY_COMPENSATION_CEILING_BYTES,
): EquityCompensationSection {
  const anchors = rankEquityCompensationAnchors(text);
  let best: { at: number; score: number } | null = null;

  for (const anchor of anchors) {
    // A igual puntaje gana la primera: la nota viene antes que sus referencias.
    if (anchor.score > 0 && (best === null || anchor.score > best.score)) {
      best = anchor;
    }
  }

  if (best === null) return null;

  const winner = best;
  const groupStart =
    anchors.find(
      (anchor) =>
        anchor.score > 0 &&
        anchor.at <= winner.at &&
        winner.at - anchor.at <= GROUP_REACH,
    )?.at ?? winner.at;
  const start = Math.max(0, groupStart - LEAD_CHARS);
  const cut = truncateUtf8(
    text.slice(start, start + ceilingBytes * 2).trim(),
    ceilingBytes,
  );

  return {
    version: SEC_10K_EQUITY_COMPENSATION_VERSION,
    section: {
      section: "equity_compensation",
      text: cut.text,
      byteLength: new TextEncoder().encode(cut.text).byteLength,
      truncated: cut.truncated,
    },
    score: winner.score,
  };
}

export function extractEquityCompensation(
  html: string,
  ceilingBytes: number = EQUITY_COMPENSATION_CEILING_BYTES,
): EquityCompensationSection {
  return extractEquityCompensationFromText(tenKVisibleText(html), ceilingBytes);
}
