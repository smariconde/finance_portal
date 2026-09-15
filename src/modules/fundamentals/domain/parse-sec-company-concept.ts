import {
  ExactJsonUnavailableError,
  parseJsonWithExactNumbers,
} from "./exact-json";
import {
  readSecFactPoint,
  SEC_COMPANY_FACTS_PARSER_VERSION,
  type SecFactRowRejection,
  type SecReportedFact,
} from "./parse-sec-company-facts";
import { normalizeCik } from "./parse-sec-submissions";

/**
 * Parser del formato de cable de `companyconcept`: los puntos de **un** concepto
 * XBRL de un filer, agrupados por unidad.
 *
 * Contrato de cable verificado el 2026-09-15 contra los filers 320193, 1045810,
 * 1652044, 831001 y 4281 para `us-gaap:StockholdersEquityNoteStockSplitConversionRatio1`,
 * sin conservar el payload: el sobre trae `cik`, `taxonomy`, `tag`, `label`,
 * `description`, `entityName` y `units`, y cada punto es idéntico al que el mismo
 * filer publica en `companyfacts` —se comparó el arreglo entero en los dos
 * primeros—. Un filer que nunca etiquetó el concepto responde `404`, que no es un
 * documento roto: lo decide el adaptador, no este parser.
 *
 * La lectura de cada punto es la de `companyfacts` (`readSecFactPoint`): si
 * cambia, tienen que subir las dos versiones, y el test lo fija.
 */
export const SEC_COMPANY_CONCEPT_PARSER_VERSION = "sec-companyconcept-1.0.0";

/** Versión de la lectura de puntos que este parser comparte. */
export const SEC_COMPANY_CONCEPT_POINT_READER =
  SEC_COMPANY_FACTS_PARSER_VERSION;

export type SecCompanyConceptPayloadRejectionCode =
  | "payload_not_json"
  | "exact_numbers_unavailable"
  | "payload_not_object"
  | "cik_invalid"
  | "concept_mismatch"
  | "units_invalid"
  | "points_invalid";

export type SecCompanyConceptParseResult =
  | {
      readonly ok: true;
      readonly parserVersion: string;
      readonly cik: string;
      readonly facts: readonly SecReportedFact[];
      readonly rejections: readonly SecFactRowRejection[];
      readonly points: number;
    }
  | {
      readonly ok: false;
      readonly parserVersion: string;
      readonly code: SecCompanyConceptPayloadRejectionCode;
    };

const EXACT_KEYS: ReadonlySet<string> = new Set(["val"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSecCompanyConcept(
  text: string,
  expected: { readonly taxonomy: string; readonly concept: string },
): SecCompanyConceptParseResult {
  const parserVersion = SEC_COMPANY_CONCEPT_PARSER_VERSION;
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

  // Un documento de otro concepto no es «sin puntos»: es la respuesta equivocada.
  if (
    payload.taxonomy !== expected.taxonomy ||
    payload.tag !== expected.concept
  ) {
    return { ok: false, parserVersion, code: "concept_mismatch" };
  }

  if (!isRecord(payload.units)) {
    return { ok: false, parserVersion, code: "units_invalid" };
  }

  const facts: SecReportedFact[] = [];
  const rejections: SecFactRowRejection[] = [];
  let points = 0;

  for (const [unit, unitPoints] of Object.entries(payload.units)) {
    if (
      unit.trim().length === 0 ||
      unit.length > 64 ||
      !Array.isArray(unitPoints)
    ) {
      return { ok: false, parserVersion, code: "points_invalid" };
    }

    points += unitPoints.length;

    unitPoints.forEach((point, index) => {
      const result = readSecFactPoint(
        expected.taxonomy,
        expected.concept,
        unit,
        point,
      );

      if (result.ok) {
        facts.push(result.fact);
      } else {
        rejections.push({
          taxonomy: expected.taxonomy,
          concept: expected.concept,
          unit,
          index,
          field: result.field,
        });
      }
    });
  }

  return { ok: true, parserVersion, cik, facts, rejections, points };
}
