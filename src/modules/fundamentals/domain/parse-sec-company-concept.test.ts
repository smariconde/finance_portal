import { describe, expect, it } from "vitest";

import {
  parseSecCompanyConcept,
  SEC_COMPANY_CONCEPT_PARSER_VERSION,
  SEC_COMPANY_CONCEPT_POINT_READER,
} from "./parse-sec-company-concept";
import { SEC_COMPANY_FACTS_PARSER_VERSION } from "./parse-sec-company-facts";

const CONCEPT = {
  taxonomy: "us-gaap",
  concept: "StockholdersEquityNoteStockSplitConversionRatio1",
};

/** Sobre con la forma verificada del cable; valores sintéticos. */
function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    cik: 73,
    taxonomy: CONCEPT.taxonomy,
    tag: CONCEPT.concept,
    label: "Stockholders' Equity Note, Stock Split, Conversion Ratio",
    description: "Synthetic.",
    entityName: "SPLIT SINTETICA CORP",
    units: {
      pure: [
        {
          end: "2024-05-20",
          val: 4,
          accn: "0000000073-25-000010",
          fy: 2024,
          fp: "FY",
          form: "10-K",
          filed: "2025-02-20",
        },
        {
          start: "2024-05-01",
          end: "2024-05-31",
          val: 0.1,
          accn: "0000000073-25-000020",
          fy: 2025,
          fp: "Q1",
          form: "10-Q",
          filed: "2025-05-01",
          frame: "CY2024Q2I",
        },
      ],
    },
    ...overrides,
  });
}

describe("parseSecCompanyConcept", () => {
  it("comparte la lectura de puntos con companyfacts", () => {
    expect(SEC_COMPANY_CONCEPT_PARSER_VERSION).toBe("sec-companyconcept-1.0.0");
    expect(SEC_COMPANY_CONCEPT_POINT_READER).toBe(
      SEC_COMPANY_FACTS_PARSER_VERSION,
    );
  });

  it("lee cada punto con su presentación, período y valor exacto", () => {
    const result = parseSecCompanyConcept(payload(), CONCEPT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cik).toBe("0000000073");
    expect(result.points).toBe(2);
    expect(result.rejections).toStrictEqual([]);
    expect(result.facts).toStrictEqual([
      {
        ...CONCEPT,
        unit: "pure",
        start: null,
        end: "2024-05-20",
        value: "4",
        accessionNumber: "0000000073-25-000010",
        form: "10-K",
        filed: "2025-02-20",
        fiscalYear: 2024,
        fiscalPeriod: "FY",
      },
      {
        ...CONCEPT,
        unit: "pure",
        start: "2024-05-01",
        end: "2024-05-31",
        value: "0.1",
        accessionNumber: "0000000073-25-000020",
        form: "10-Q",
        filed: "2025-05-01",
        fiscalYear: 2025,
        fiscalPeriod: "Q1",
      },
    ]);
  });

  it("toma el ratio del texto fuente y no de un double", () => {
    const text = payload().replace('"val":0.1', '"val":0.33333333333333333333');
    const result = parseSecCompanyConcept(text, CONCEPT);

    expect(result.ok && result.facts[1]?.value).toBe("0.33333333333333333333");
  });

  it("rechaza por campo un punto ilegible y sigue con el resto", () => {
    const text = payload().replace('"val":4', '"val":"4"');
    const result = parseSecCompanyConcept(text, CONCEPT);

    expect(result.ok && result.rejections).toStrictEqual([
      { ...CONCEPT, unit: "pure", index: 0, field: "val" },
    ]);
    expect(result.ok && result.facts).toHaveLength(1);
  });

  it.each([
    ["no es JSON", "{", "payload_not_json"],
    ["no es un objeto", "[]", "payload_not_object"],
    ["CIK inválido", payload({ cik: "abc" }), "cik_invalid"],
    ["otro concepto", payload({ tag: "Assets" }), "concept_mismatch"],
    ["otra taxonomía", payload({ taxonomy: "dei" }), "concept_mismatch"],
    ["unidades rotas", payload({ units: [] }), "units_invalid"],
    ["puntos rotos", payload({ units: { pure: {} } }), "points_invalid"],
  ])("cuarentena un sobre que %s", (_label, text, code) => {
    expect(parseSecCompanyConcept(text, CONCEPT)).toStrictEqual({
      ok: false,
      parserVersion: SEC_COMPANY_CONCEPT_PARSER_VERSION,
      code,
    });
  });
});
