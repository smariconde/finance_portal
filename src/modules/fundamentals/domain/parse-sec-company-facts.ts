import { decimalStringSchema } from "@/modules/ingestion/domain/staged-record";

import {
  canonicalDecimalFromJsonNumber,
  ExactJsonNumber,
  ExactJsonUnavailableError,
  parseJsonWithExactNumbers,
} from "./exact-json";
import { isCalendarDate, normalizeCik } from "./parse-sec-submissions";

/**
 * Parser del formato de cable de `companyfacts`: todos los hechos XBRL sin
 * dimensiones que un filer presentó, agrupados por taxonomía, concepto y unidad.
 *
 * Contrato de cable verificado el 2026-09-14 contra el filer 320193, sin conservar
 * el payload: 25.135 puntos en `dei` y `us-gaap`; cada punto trae `end`, `val`,
 * `accn`, `fy`, `fp`, `form`, `filed` y, cuando es un período, `start`. `frame`
 * aparece en algunos y **no se lee**: lo asigna la SEC al hecho más reciente de
 * cada período calendario y lo mueve cuando llega otra presentación, así que no
 * es una propiedad del hecho reportado sino del índice del día.
 *
 * `fy` y `fp` describen a la **presentación**, no al período del hecho: el 10-K
 * de FY2023 repite el revenue de FY2021 con `fy=2023`. Por eso viajan a la
 * presentación y nunca se usan para fechar un valor.
 *
 * El importe se lee del texto fuente del JSON (`exact-json.ts`): un `double`
 * redondearía en silencio cualquier valor por encima de 2^53.
 */
export const SEC_COMPANY_FACTS_PARSER_VERSION = "sec-companyfacts-1.0.0";

export type SecReportedFact = {
  readonly taxonomy: string;
  readonly concept: string;
  /** Unidad tal como la publica la fuente (`USD`, `USD/shares`, `shares`). */
  readonly unit: string;
  readonly start: string | null;
  readonly end: string;
  /** Decimal canónico tomado del texto fuente. */
  readonly value: string;
  readonly accessionNumber: string;
  readonly form: string;
  readonly filed: string;
  readonly fiscalYear: number | null;
  readonly fiscalPeriod: string | null;
};

export type SecFactField =
  "point" | "end" | "start" | "val" | "accn" | "form" | "filed" | "fy" | "fp";

export type SecFactRowRejection = {
  readonly taxonomy: string;
  readonly concept: string;
  readonly unit: string;
  readonly index: number;
  /** Campo que no se entendió; nunca el valor recibido (`TM-02`). */
  readonly field: SecFactField;
};

export type SecCompanyFactsPayloadRejectionCode =
  | "payload_not_json"
  | "exact_numbers_unavailable"
  | "payload_not_object"
  | "cik_invalid"
  | "facts_missing"
  | "taxonomy_invalid"
  | "concept_invalid"
  | "units_invalid"
  | "points_invalid";

export type SecCompanyFactsCounts = {
  readonly concepts: number;
  readonly selectedConcepts: number;
  readonly points: number;
  readonly selectedPoints: number;
};

export type SecCompanyFactsParseResult =
  | {
      readonly ok: true;
      readonly parserVersion: string;
      readonly cik: string;
      readonly facts: readonly SecReportedFact[];
      readonly rejections: readonly SecFactRowRejection[];
      readonly counts: SecCompanyFactsCounts;
    }
  | {
      readonly ok: false;
      readonly parserVersion: string;
      readonly code: SecCompanyFactsPayloadRejectionCode;
    };

const EXACT_KEYS: ReadonlySet<string> = new Set(["val"]);
const ACCESSION = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u;
const TAXONOMY = /^[a-z][a-z0-9-]{0,31}$/u;
const CONCEPT = /^[A-Za-z_][A-Za-z0-9_.-]{0,255}$/u;
const FISCAL_PERIOD = /^[A-Z0-9]{1,4}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type SecFactPointResult =
  | { readonly ok: true; readonly fact: SecReportedFact }
  | { readonly ok: false; readonly field: SecFactField };

/**
 * Un punto del cable XBRL de la SEC. `companyconcept` publica exactamente los
 * mismos puntos que `companyfacts` —verificado el 2026-09-15 sobre los filers
 * 320193 y 1045810—, así que los dos parsers comparten esta lectura.
 */
export function readSecFactPoint(
  taxonomy: string,
  concept: string,
  unit: string,
  point: unknown,
): SecFactPointResult {
  if (!isRecord(point)) {
    return { ok: false, field: "point" };
  }

  if (!isCalendarDate(point.end)) {
    return { ok: false, field: "end" };
  }

  const start = point.start ?? null;

  if (start !== null && (!isCalendarDate(start) || start > point.end)) {
    return { ok: false, field: "start" };
  }

  // Un `val` ausente, `null` o escrito como string no es un cero con ruido: es
  // un punto que no se entiende y se rechaza (`TM-05`).
  const value =
    point.val instanceof ExactJsonNumber
      ? canonicalDecimalFromJsonNumber(point.val.source)
      : null;

  if (value === null || !decimalStringSchema.safeParse(value).success) {
    return { ok: false, field: "val" };
  }

  if (typeof point.accn !== "string" || !ACCESSION.test(point.accn)) {
    return { ok: false, field: "accn" };
  }

  if (
    typeof point.form !== "string" ||
    point.form.trim().length === 0 ||
    point.form.trim().length > 32
  ) {
    return { ok: false, field: "form" };
  }

  if (!isCalendarDate(point.filed)) {
    return { ok: false, field: "filed" };
  }

  const fiscalYear = point.fy ?? null;

  if (
    fiscalYear !== null &&
    !(
      typeof fiscalYear === "number" &&
      Number.isInteger(fiscalYear) &&
      fiscalYear >= 1900 &&
      fiscalYear <= 2200
    )
  ) {
    return { ok: false, field: "fy" };
  }

  const fiscalPeriod = point.fp ?? null;

  if (
    fiscalPeriod !== null &&
    !(typeof fiscalPeriod === "string" && FISCAL_PERIOD.test(fiscalPeriod))
  ) {
    return { ok: false, field: "fp" };
  }

  return {
    ok: true,
    fact: {
      taxonomy,
      concept,
      unit,
      start,
      end: point.end,
      value,
      accessionNumber: point.accn,
      form: point.form.trim(),
      filed: point.filed,
      fiscalYear,
      fiscalPeriod,
    },
  };
}

export function parseSecCompanyFacts(
  text: string,
  isSelected: (taxonomy: string, concept: string) => boolean,
): SecCompanyFactsParseResult {
  const parserVersion = SEC_COMPANY_FACTS_PARSER_VERSION;
  let payload: unknown;

  try {
    payload = parseJsonWithExactNumbers(text, EXACT_KEYS);
  } catch (error) {
    return {
      ok: false,
      parserVersion,
      code:
        error instanceof ExactJsonUnavailableError
          ? "exact_numbers_unavailable"
          : "payload_not_json",
    };
  }

  if (!isRecord(payload)) {
    return { ok: false, parserVersion, code: "payload_not_object" };
  }

  const cik = normalizeCik(payload.cik);

  if (cik === null) {
    return { ok: false, parserVersion, code: "cik_invalid" };
  }

  if (!isRecord(payload.facts)) {
    return { ok: false, parserVersion, code: "facts_missing" };
  }

  const facts: SecReportedFact[] = [];
  const rejections: SecFactRowRejection[] = [];
  let concepts = 0;
  let selectedConcepts = 0;
  let points = 0;
  let selectedPoints = 0;

  // La forma se valida en **todo** el documento, también en lo que no se
  // selecciona: un cambio de formato en un concepto ajeno es la misma señal de
  // que el parser dejó de entender el cable, y publicar «la parte que anduvo»
  // sería publicar un subconjunto sin saberlo.
  for (const [taxonomy, taxonomyNode] of Object.entries(payload.facts)) {
    if (!TAXONOMY.test(taxonomy) || !isRecord(taxonomyNode)) {
      return { ok: false, parserVersion, code: "taxonomy_invalid" };
    }

    for (const [concept, conceptNode] of Object.entries(taxonomyNode)) {
      if (!CONCEPT.test(concept) || !isRecord(conceptNode)) {
        return { ok: false, parserVersion, code: "concept_invalid" };
      }

      if (!isRecord(conceptNode.units)) {
        return { ok: false, parserVersion, code: "units_invalid" };
      }

      const selected = isSelected(taxonomy, concept);
      concepts += 1;
      selectedConcepts += selected ? 1 : 0;

      for (const [unit, unitPoints] of Object.entries(conceptNode.units)) {
        if (
          unit.trim().length === 0 ||
          unit.length > 64 ||
          !Array.isArray(unitPoints)
        ) {
          return { ok: false, parserVersion, code: "points_invalid" };
        }

        points += unitPoints.length;

        if (!selected) {
          continue;
        }

        selectedPoints += unitPoints.length;

        unitPoints.forEach((point, index) => {
          const result = readSecFactPoint(taxonomy, concept, unit, point);

          if (result.ok) {
            facts.push(result.fact);
          } else {
            rejections.push({
              taxonomy,
              concept,
              unit,
              index,
              field: result.field,
            });
          }
        });
      }
    }
  }

  return {
    ok: true,
    parserVersion,
    cik,
    facts,
    rejections,
    counts: { concepts, selectedConcepts, points, selectedPoints },
  };
}
