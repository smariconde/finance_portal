import { tenKVisibleText } from "@/modules/fundamentals/domain/sec-10k-sections";
import type { SecAnnualReport } from "@/modules/fundamentals/domain/sec-annual-report";

import { formatDecimal, parseDecimal, ZERO, type Dec } from "./decimal-policy";
import type { MonetaryFact } from "./valuation-facts";

/**
 * El escudo de quebrantos de un modelo de crecimiento (`F6-21`, ADR 0063).
 *
 * `2.0.0` (2026-11-18, decisión del owner con las notas medidas de DDOG, CRWD,
 * RDDT, UBER, PLTR, ABNB y MU): se toma **sólo el pool federal de EE.UU.**, el
 * que el 10-K escribe con su monto, y los estatales y extranjeros quedan fuera
 * con nombre. `1.0.0` se negaba ante cualquier mención de otra jurisdicción,
 * que está en casi todo 10-K, y ninguna empresa medida pasaba.
 *
 * - El monto sale de una oración que dice «federal» y «net operating loss» o
 *   «NOL» con montos en millones o miles de millones: la cláusula federal
 *   cuando la oración enumera jurisdicciones («$A and $B, respectively»), o la
 *   suma de sus tramos cuando sólo habla del federal (UBER: uno que vence y
 *   otro indefinido).
 * - Una oración que dice que no queda quebranto federal es un cero con
 *   evidencia (ABNB).
 * - Montos federales distintos en el mismo 10-K se niegan
 *   (`tax_pool_not_reconciled`): no se elige entre dos.
 * - Sin monto federal escrito, el escudo es cero y se nombra: es la cota
 *   inferior del valor, nunca un número inventado (MU, cuyos quebrantos son de
 *   Malasia).
 * - Un documento sin «tax» se niega (`tax_note_missing`): no se valúa un
 *   escudo cero sobre un 10-K que no se pudo leer.
 * - El tope anual es el 80 % de la base imponible que fija la TCJA para los
 *   quebrantos federales posteriores a 2017; los anteriores no tienen tope y
 *   vencen. Usarlo para todo el pool es la simplificación declarada.
 *
 * `2.1.0` (2026-11-19, SNOW FY2026 medido): `2.0.0` negaba un pool que el 10-K
 * escribe una sola vez, por dos lecturas de más.
 *
 * - Un desglose («Of the $7.3 billion U.S. federal NOL carryforwards, $7.2
 *   billion … and the remaining $0.1 billion …») es el mismo pool: el monto es
 *   el que encabeza y las partes tienen que sumarlo dentro del redondeo impreso.
 *   Si no lo suman, el pool no reconcilia. `2.0.0` sumaba encabezado y partes.
 * - Una oración cuyo sujeto es la reserva de valuación («The valuation
 *   allowance was $3.7 billion and $3.1 billion … respectively, primarily
 *   relating to U.S. federal and state net operating loss carryforwards») da
 *   montos de la reserva, no de quebrantos: no se lee. `2.0.0` tomaba el primero
 *   como federal.
 *
 * Montos federales distintos siguen negándose: no se elige entre dos.
 */
export const GROWTH_TAX_EVIDENCE_VERSION = "growth-tax-evidence-2.1.0";

/** TCJA, IRC §172(a)(2): 80 % de la base imponible para quebrantos post-2017. */
export const FEDERAL_NOL_OFFSET_LIMIT = "0.8";

export type GrowthTaxBasis =
  | "federal_amount_stated"
  | "no_federal_carryforward_stated"
  | "federal_amount_not_stated";

export type GrowthTaxEvidence = {
  readonly version: typeof GROWTH_TAX_EVIDENCE_VERSION;
  readonly basis: GrowthTaxBasis;
  readonly lossCarryforward: MonetaryFact;
  readonly lossOffsetLimit: string;
  readonly lossPolicyRationale: string;
};

export type GrowthTaxReading =
  | { readonly status: "ready"; readonly evidence: GrowthTaxEvidence }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "filing_year_mismatch"
        | "tax_note_missing"
        | "jurisdictions_not_reconciled"
        | "tax_pool_not_reconciled";
    };

const NOL = /operating loss(?:es)? carry ?forwards?|\bNOLs?\b/iu;
const FEDERAL = /\bfederal\b/iu;
const OTHER_JURISDICTION =
  /\b(?:state|states|foreign|local|non-u\.?s\.?|international|california|new york|massachusetts|texas|malaysia|ireland|israel|united kingdom|u\.?k\.?|canada|germany|japan|china|india|netherlands|luxembourg|singapore)\b/iu;
const MONEY = /\$\s?([\d,]+(?:\.\d+)?)\s*(million|billion)\b/giu;
const NO_FEDERAL =
  /\bno (?:remaining )?(?:u\.?s\.? )?(?:federal )?(?:net operating loss|nol)s?(?: carry ?forwards?)?(?: remaining)? for (?:u\.?s\.? )?federal\b|\bno (?:remaining )?(?:u\.?s\.? )?federal (?:net operating loss|nol)/iu;
/** La reserva de valuación como sujeto: sus montos no son quebrantos. */
const VALUATION_ALLOWANCE_SUBJECT =
  /^(?:the |our |its )?(?:(?:change|increase|decrease) in (?:the |our )?)?valuation allowance\b/iu;
/** «Of the $X [U.S.] federal …»: el desglose de un pool ya escrito. */
const BREAKDOWN =
  /^of (?:the |our |its |this |these )?(?:approximately )?\$\s?([\d,]+(?:\.\d+)?)\s*(million|billion)\b(?:\s+of)?\s+(?:(?:total|aggregate)\s+)?(?:u\.?s\.?\s+)?federal\b/iu;
/** Una oración más larga es casi siempre una tabla aplanada. */
const MAX_SENTENCE = 600;

const JURISDICTION_WORD =
  "(?:u\\.?s\\.?\\s+)?(?:federal|state|foreign|local|[A-Z][a-zA-Z]+(?:\\s[A-Z][a-zA-Z]+)?)";
const JURISDICTION_LIST = new RegExp(
  `${JURISDICTION_WORD}(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)${JURISDICTION_WORD})+`,
  "gu",
);

function amountsOf(text: string): Dec[] {
  return printedAmountsOf(text).map((amount) => amount.value);
}

type PrintedAmount = { readonly value: Dec; readonly halfUnit: Dec };

/** Cada monto con la mitad de su último dígito impreso: su redondeo. */
function printedAmountsOf(text: string): PrintedAmount[] {
  return [...text.matchAll(MONEY)].map((match) => {
    const digits = match[1]!.replaceAll(",", "");
    const scale = match[2]!.toLowerCase() === "billion" ? 1e9 : 1e6;
    const decimals = digits.includes(".") ? digits.split(".")[1]!.length : 0;
    return {
      value: parseDecimal(digits, "taxLoss").times(scale),
      halfUnit: parseDecimal("0.5", "taxLoss")
        .times(scale)
        .div(parseDecimal("10", "taxLoss").pow(decimals)),
    };
  });
}

/**
 * `2.1.0`: el desglose de un pool. El encabezado es el monto; las partes lo
 * corroboran dentro del redondeo impreso de cada número. `undefined` si la
 * oración no es un desglose federal.
 */
function breakdownAmount(sentence: string): Dec | null | undefined {
  if (!BREAKDOWN.test(sentence)) return undefined;
  const [total, ...parts] = printedAmountsOf(sentence);
  if (total === undefined) return undefined;
  if (parts.length === 0) return total.value;
  const sum = parts.reduce((acc, part) => acc.plus(part.value), ZERO);
  const tolerance = parts.reduce(
    (acc, part) => acc.plus(part.halfUnit),
    total.halfUnit,
  );
  return sum.minus(total.value).abs().lte(tolerance) ? total.value : null;
}

/** «federal and state … $A and $B, respectively»: el monto en la posición federal. */
function respectiveFederalAmount(sentence: string): Dec | null {
  const amounts = amountsOf(sentence);

  for (const match of sentence.matchAll(JURISDICTION_LIST)) {
    const items = match[0]
      .split(/\s*,\s*(?:and\s+)?|\s+and\s+/u)
      .filter((item) => item.length > 0);
    const position = items.findIndex((item) => FEDERAL.test(item));

    if (items.length >= 2 && position >= 0 && items.length === amounts.length) {
      return amounts[position]!;
    }
  }

  return null;
}

/** Sin «respectively»: suma los montos de las cláusulas que sólo hablan del federal. */
function federalClauseAmount(sentence: string): Dec | null {
  const clauses = sentence.split(
    /;|\s+and\s+(?=(?:u\.?s\.?\s+)?(?:state|foreign|local|non-u\.?s\.?|international|california)\b)/iu,
  );
  const federal = clauses.filter(
    (clause) => FEDERAL.test(clause) && !OTHER_JURISDICTION.test(clause),
  );
  const amounts = federal.flatMap(amountsOf);

  return amounts.length === 0
    ? null
    : amounts.reduce((sum, amount) => sum.plus(amount), ZERO);
}

export function deriveGrowthTaxEvidence(input: {
  readonly html: string;
  readonly report: SecAnnualReport;
  readonly fiscalYearEnd: string;
}): GrowthTaxReading {
  if (input.report.reportDate !== input.fiscalYearEnd)
    return { status: "unavailable", reason: "filing_year_mismatch" };
  const text = tenKVisibleText(input.html)
    .replace(/\s+/gu, " ")
    .replace(/[’‘]/gu, "'");
  // Un documento que no habla de impuestos no es un 10-K leído: se niega en
  // vez de valuar un escudo cero sobre nada.
  if (!/\btax(?:es)?\b/iu.test(text))
    return { status: "unavailable", reason: "tax_note_missing" };
  const sentences = text
    .split(/(?<=\.)\s+(?=[A-Z])/u)
    .filter(
      (sentence) =>
        sentence.length <= MAX_SENTENCE &&
        NOL.test(sentence) &&
        FEDERAL.test(sentence),
    );

  const stated = new Map<string, Dec>();
  let statesNone = false;
  let breakdownUnreconciled = false;

  for (const sentence of sentences) {
    if (NO_FEDERAL.test(sentence)) {
      statesNone = true;
      continue;
    }

    if (VALUATION_ALLOWANCE_SUBJECT.test(sentence)) continue;

    const breakdown = breakdownAmount(sentence);
    if (breakdown === null) {
      breakdownUnreconciled = true;
      continue;
    }

    const amount =
      breakdown !== undefined
        ? breakdown
        : /\brespectively\b/iu.test(sentence)
          ? respectiveFederalAmount(sentence)
          : federalClauseAmount(sentence);

    if (amount !== null && amount.gt(ZERO)) {
      stated.set(formatDecimal(amount, "taxLoss"), amount);
    }
  }

  if (
    stated.size > 1 ||
    (stated.size === 1 && statesNone) ||
    breakdownUnreconciled
  )
    return { status: "unavailable", reason: "tax_pool_not_reconciled" };

  const [amount] = [...stated.values()];
  const basis: GrowthTaxBasis =
    amount !== undefined
      ? "federal_amount_stated"
      : statesNone
        ? "no_federal_carryforward_stated"
        : "federal_amount_not_stated";
  const value = amount ?? ZERO;

  return {
    status: "ready",
    evidence: {
      version: GROWTH_TAX_EVIDENCE_VERSION,
      basis,
      lossCarryforward: {
        value: formatDecimal(value, "taxLoss"),
        currency: "USD",
        unit: "monetary",
        asOf: input.fiscalYearEnd,
        availableAt: input.report.acceptedAt,
        sourceId: "sec-edgar",
        sourceDocumentId: input.report.accessionNumber,
        observationId: null,
        qualityFlags: [],
      },
      lossOffsetLimit: FEDERAL_NOL_OFFSET_LIMIT,
      lossPolicyRationale: `${GROWTH_TAX_EVIDENCE_VERSION}: ${RATIONALE[basis]}`,
    },
  };
}

const RATIONALE: Record<GrowthTaxBasis, string> = {
  federal_amount_stated:
    "the U.S. federal NOL amount stated in the cited 10-K, offset at the TCJA 80% annual cap; state and foreign pools are excluded.",
  no_federal_carryforward_stated:
    "the cited 10-K states no remaining U.S. federal NOL; the shield is zero.",
  federal_amount_not_stated:
    "the cited 10-K states no U.S. federal NOL amount; the shield is valued at zero, a lower bound, and state and foreign pools are excluded.",
};
