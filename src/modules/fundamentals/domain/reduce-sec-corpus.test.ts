import { describe, expect, it } from "vitest";

import { parseJsonPreservingNumbers } from "./exact-json";
import {
  CORPUS_HISTORY_YEARS,
  reduceSecCompanyFacts,
  reduceSecSubmissions,
  SecCorpusReductionError,
} from "./reduce-sec-corpus";

function point(end: string, extra: Record<string, unknown> = {}) {
  return { end, val: 1, accn: "0000320193-24-000081", form: "10-K", ...extra };
}

function companyFacts(facts: Record<string, unknown>) {
  return { cik: 320193, entityName: "Apple Inc.", facts };
}

describe("reduceSecCompanyFacts", () => {
  it("anchors the floor on the document, never on the clock", () => {
    const reduction = reduceSecCompanyFacts(
      companyFacts({
        "us-gaap": {
          Revenues: {
            units: { USD: [point("2024-09-28"), point("2010-09-25")] },
          },
        },
      }),
    );

    expect(reduction.anchorOn).toBe("2024-09-28");
    expect(reduction.floorOn).toBe("2016-09-28");
    expect(reduction.counts).toStrictEqual({
      conceptsKept: 1,
      conceptsDropped: 0,
      pointsKept: 1,
      pointsDropped: 1,
    });
  });

  it("keeps a wider window than the ingestion's, so the window still has to cut", () => {
    // Ocho ejercicios contra cinco más uno: un punto de hace siete años entra al
    // corpus y la ventana de la ADR 0017 lo descarta después. Si el reductor
    // usara la misma ventana, ese test no mediría nada.
    expect(CORPUS_HISTORY_YEARS).toBeGreaterThan(6);

    const reduction = reduceSecCompanyFacts(
      companyFacts({
        "us-gaap": {
          Revenues: {
            units: { USD: [point("2024-09-28"), point("2017-09-30")] },
          },
        },
      }),
    );

    expect(reduction.counts.pointsKept).toBe(2);
  });

  it("keeps concepts the ingestion does not select, so 'not selected' has data", () => {
    const reduction = reduceSecCompanyFacts(
      companyFacts({
        "us-gaap": {
          Revenues: { units: { USD: [point("2024-09-28")] } },
          CommonStockSharesIssued: { units: { shares: [point("2024-09-28")] } },
          AllocatedShareBasedCompensationExpense: {
            units: { USD: [point("2024-09-28")] },
          },
        },
      }),
    );

    const kept = Object.keys(
      (reduction.document as { facts: { "us-gaap": object } }).facts["us-gaap"],
    );

    expect(kept).toContain("Revenues");
    // Casi-acierto declarado: se parece a `CommonStockSharesOutstanding`.
    expect(kept).toContain("CommonStockSharesIssued");
    // Y algo que sobra de verdad se va.
    expect(kept).not.toContain("AllocatedShareBasedCompensationExpense");
    expect(reduction.counts.conceptsDropped).toBe(1);
  });

  it("keeps the first concept of a taxonomy it does not know", () => {
    const reduction = reduceSecCompanyFacts(
      companyFacts({
        aapl: {
          SomeExtensionConcept: { units: { USD: [point("2024-09-28")] } },
          AnotherExtensionConcept: { units: { USD: [point("2024-09-28")] } },
        },
      }),
    );

    const facts = (reduction.document as { facts: Record<string, object> })
      .facts;

    expect(Object.keys(facts.aapl!)).toStrictEqual(["SomeExtensionConcept"]);
  });

  it("gives the unknown taxonomy's slot to the next concept when the first falls outside the window", () => {
    const reduction = reduceSecCompanyFacts(
      companyFacts({
        "us-gaap": {
          Revenues: { units: { USD: [point("2024-09-28")] } },
        },
        aapl: {
          OldExtensionConcept: { units: { USD: [point("2005-09-24")] } },
          LiveExtensionConcept: { units: { USD: [point("2024-09-28")] } },
        },
      }),
    );

    const facts = (reduction.document as { facts: Record<string, object> })
      .facts;

    expect(Object.keys(facts.aapl!)).toStrictEqual(["LiveExtensionConcept"]);
  });

  it("drops label and description but keeps every other key of a concept", () => {
    const reduction = reduceSecCompanyFacts(
      companyFacts({
        "us-gaap": {
          Revenues: {
            label: "Revenues",
            description: "Amount of revenue recognized…",
            units: { USD: [point("2024-09-28")] },
          },
        },
      }),
    );

    const concept = (
      reduction.document as {
        facts: { "us-gaap": { Revenues: Record<string, unknown> } };
      }
    ).facts["us-gaap"].Revenues;

    expect(Object.keys(concept)).toStrictEqual(["units"]);
  });

  it("does not write a unit that lost every point", () => {
    const reduction = reduceSecCompanyFacts(
      companyFacts({
        "us-gaap": {
          Revenues: {
            units: {
              USD: [point("2024-09-28")],
              EUR: [point("2005-09-24")],
            },
          },
        },
      }),
    );

    const units = (
      reduction.document as {
        facts: { "us-gaap": { Revenues: { units: Record<string, unknown> } } };
      }
    ).facts["us-gaap"].Revenues.units;

    expect(Object.keys(units)).toStrictEqual(["USD"]);
  });

  it("keeps every number as its source text", () => {
    const payload = parseJsonPreservingNumbers(
      `{"cik":320193,"facts":{"us-gaap":{"Revenues":{"units":{"USD":[{"end":"2024-09-28","val":12345678901234567890}]}}}}}`,
    );

    const reduction = reduceSecCompanyFacts(payload);
    const [kept] = (
      reduction.document as {
        facts: {
          "us-gaap": {
            Revenues: { units: { USD: Array<{ val: { source: string } }> } };
          };
        };
      }
    ).facts["us-gaap"].Revenues.units.USD;

    expect(kept!.val.source).toBe("12345678901234567890");
  });

  it("refuses a payload without dated points instead of writing an empty corpus", () => {
    expect(() =>
      reduceSecCompanyFacts(companyFacts({ "us-gaap": { Revenues: {} } })),
    ).toThrow(SecCorpusReductionError);
  });

  it("refuses a payload that is not companyfacts", () => {
    expect(() => reduceSecCompanyFacts({ cik: 320193 })).toThrow(
      SecCorpusReductionError,
    );
    expect(() => reduceSecCompanyFacts("nope")).toThrow(
      SecCorpusReductionError,
    );
  });
});

describe("reduceSecSubmissions", () => {
  function submissions(recent: Record<string, unknown[]>) {
    return {
      cik: "320193",
      name: "Apple Inc.",
      filings: {
        recent,
        files: [
          {
            name: "CIK0000320193-submissions-001.json",
            filingFrom: "1994-01-26",
            filingTo: "2016-10-26",
          },
        ],
      },
    };
  }

  it("cuts every parallel column by the same indices", () => {
    const reduction = reduceSecSubmissions(
      submissions({
        accessionNumber: ["a-new", "a-old", "a-newer"],
        filingDate: ["2024-08-02", "2005-01-03", "2024-11-01"],
        form: ["10-Q", "10-K", "10-K"],
        acceptanceDateTime: [
          "2024-08-02T18:01:00.000Z",
          "2005-01-03T16:00:00.000Z",
          "2024-11-01T18:01:00.000Z",
        ],
      }),
    );

    const recent = (
      reduction.document as {
        filings: { recent: Record<string, unknown[]> };
      }
    ).filings.recent;

    expect(recent.filingDate).toStrictEqual(["2024-08-02", "2024-11-01"]);
    expect(recent.accessionNumber).toStrictEqual(["a-new", "a-newer"]);
    expect(recent.form).toStrictEqual(["10-Q", "10-K"]);
    expect(recent.acceptanceDateTime).toHaveLength(2);
    expect(reduction.counts).toStrictEqual({
      filingsKept: 2,
      filingsDropped: 1,
    });
  });

  it("keeps the history file index whole: it decides what a run would fetch", () => {
    const reduction = reduceSecSubmissions(
      submissions({
        accessionNumber: ["a-new"],
        filingDate: ["2024-08-02"],
      }),
    );

    const files = (reduction.document as { filings: { files: unknown[] } })
      .filings.files;

    expect(files).toHaveLength(1);
  });

  it("refuses ragged columns instead of misaligning a filing with another date", () => {
    expect(() =>
      reduceSecSubmissions(
        submissions({
          accessionNumber: ["a", "b"],
          filingDate: ["2024-08-02"],
        }),
      ),
    ).toThrow(SecCorpusReductionError);
  });

  it("drops the high-volume forms and keeps everything else, 40-F included", () => {
    const reduction = reduceSecSubmissions(
      submissions({
        accessionNumber: ["a", "b", "c", "d", "e", "f", "g"],
        filingDate: [
          "2024-08-02",
          "2024-08-03",
          "2024-08-04",
          "2024-08-05",
          "2024-08-06",
          "2024-08-07",
          "2024-08-08",
        ],
        // `40-F` es el caso que un prefijo `4` se habría llevado puesto: el
        // reporte anual de un foreign filer.
        form: ["10-K", "4", "4/A", "424B2", "40-F", "SC 13G/A", "25-NSE"],
      }),
    );

    const recent = (
      reduction.document as { filings: { recent: Record<string, unknown[]> } }
    ).filings.recent;

    expect(recent.form).toStrictEqual(["10-K", "40-F", "25-NSE"]);
    expect(recent.accessionNumber).toStrictEqual(["a", "e", "g"]);
    expect(reduction.counts.filingsDropped).toBe(4);
  });

  it("refuses a payload without filings", () => {
    expect(() => reduceSecSubmissions({ cik: "320193" })).toThrow(
      SecCorpusReductionError,
    );
  });
});
