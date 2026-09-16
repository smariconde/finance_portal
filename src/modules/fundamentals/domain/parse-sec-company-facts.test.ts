import { describe, expect, it } from "vitest";

import {
  buildFixtureCompanyFactsText,
  FIXTURE_ACCESSIONS,
} from "../infrastructure/fixture-sec-filer";
import { parseSecCompanyFacts } from "./parse-sec-company-facts";
import { isSelectedSecConcept } from "./sec-concept-selection";

function parse(text = buildFixtureCompanyFactsText()) {
  return parseSecCompanyFacts(text, isSelectedSecConcept);
}

describe("parseSecCompanyFacts", () => {
  it("reads every selected point with the provenance of its filing", () => {
    const result = parse();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cik).toBe("0000000042");
    expect(result.rejections).toStrictEqual([]);
    expect(result.facts).toHaveLength(8);
    expect(
      result.facts.find(
        (fact) =>
          fact.concept === "Assets" &&
          fact.accessionNumber === FIXTURE_ACCESSIONS.amendment,
      ),
    ).toStrictEqual({
      taxonomy: "us-gaap",
      concept: "Assets",
      unit: "USD",
      start: null,
      end: "2008-12-31",
      value: "396500000",
      accessionNumber: FIXTURE_ACCESSIONS.amendment,
      form: "10-K/A",
      filed: "2010-05-12",
      fiscalYear: 2009,
      fiscalPeriod: "FY",
    });
  });

  it("counts what the selection skipped instead of silently dropping it", () => {
    const result = parse();

    expect(result.ok && result.counts).toStrictEqual({
      concepts: 5,
      selectedConcepts: 4,
      points: 9,
      selectedPoints: 8,
    });
  });

  it("keeps a value a double would round, exactly as the source wrote it", () => {
    const result = parse(
      buildFixtureCompanyFactsText({
        rawValues: { "Assets|0": "12345678901234567890" },
      }),
    );

    expect(result.ok && result.facts[1]?.value).toBe("12345678901234567890");
  });

  it("writes a per-share amount and an exponent as canonical decimals", () => {
    const result = parse(
      buildFixtureCompanyFactsText({
        rawValues: {
          "EarningsPerShareDiluted|0": "1.370",
          "Revenues|1": "4.75E7",
        },
      }),
    );

    if (!result.ok) throw new Error("expected ok");

    const values = result.facts.map((fact) => fact.value);
    expect(values).toContain("1.37");
    expect(values).toContain("47500000");
  });

  it("rejects a point whose value is not a number, naming the field only", () => {
    const result = parse(
      buildFixtureCompanyFactsText({
        rawValues: { "Revenues|0": '"180000000"', "Revenues|2": "null" },
      }),
    );

    if (!result.ok) throw new Error("expected ok");

    expect(result.rejections).toStrictEqual([
      {
        taxonomy: "us-gaap",
        concept: "Revenues",
        unit: "USD",
        index: 0,
        field: "val",
      },
      {
        taxonomy: "us-gaap",
        concept: "Revenues",
        unit: "USD",
        index: 2,
        field: "val",
      },
    ]);
    // Nunca se convierte en cero: el punto desaparece del lote, nombrado.
    expect(result.facts.some((fact) => fact.value === "0")).toBe(false);
  });

  it("rejects a point whose period ends before it starts", () => {
    const result = parse(
      buildFixtureCompanyFactsText({
        extraPoints: {
          "USD@OperatingIncomeLoss": [
            {
              start: "2010-06-30",
              end: "2010-04-01",
              val: "1",
              accn: FIXTURE_ACCESSIONS.q2Filing,
              fy: 2010,
              fp: "Q2",
              form: "10-Q",
              filed: "2010-08-04",
            },
          ],
        },
      }),
    );

    expect(result.ok && result.rejections.map((r) => r.field)).toStrictEqual([
      "start",
    ]);
  });

  it.each([
    ["text that is not JSON", '{"cik": 42, "facts": {'],
    ["a payload without facts", '{"cik": 42}'],
    ["a zero cik", '{"cik": 0, "facts": {}}'],
    [
      "a concept without units",
      '{"cik": 42, "facts": {"us-gaap": {"Assets": {"label": "x"}}}}',
    ],
    [
      "units that are not arrays",
      '{"cik": 42, "facts": {"us-gaap": {"Assets": {"units": {"USD": {}}}}}}',
    ],
  ])("quarantines %s", (_label, text) => {
    expect(parse(text).ok).toBe(false);
  });

  it("quarantines a broken shape even inside a concept it would not select", () => {
    // Un formato que cambió en un concepto ajeno es la misma señal: publicar la
    // parte que anduvo sería publicar un subconjunto sin saberlo.
    const result = parse(
      '{"cik": 42, "facts": {"us-gaap": {"Assets": {"units": {"USD": []}}, "AccountsPayableCurrent": {"units": []}}}}',
    );

    expect(result).toMatchObject({ ok: false, code: "units_invalid" });
  });
});
