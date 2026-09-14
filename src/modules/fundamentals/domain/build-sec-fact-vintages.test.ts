import { describe, expect, it } from "vitest";

import { stagedRecordSchema } from "@/modules/ingestion/domain/staged-record";

import {
  buildFixtureCompanyFactsText,
  buildFixtureSubmissions,
  buildFixtureSubmissionsHistory,
  FIXTURE_ACCEPTED_AT,
  FIXTURE_ACCESSIONS,
  FIXTURE_FILER_CIK,
  type FixtureCompanyFactsOptions,
} from "../infrastructure/fixture-sec-filer";
import { buildSecFactVintages } from "./build-sec-fact-vintages";
import { parseSecCompanyFacts } from "./parse-sec-company-facts";
import {
  parseSecFilingColumns,
  parseSecSubmissions,
  type SecFiling,
} from "./parse-sec-submissions";
import { isSelectedSecConcept } from "./sec-concept-selection";

function filings(withHistory = true): SecFiling[] {
  const submissions = parseSecSubmissions(buildFixtureSubmissions());
  const history = parseSecFilingColumns(buildFixtureSubmissionsHistory());

  if (!submissions.ok || !history.ok) {
    throw new Error("fixture must parse");
  }

  return withHistory
    ? [...submissions.filings, ...history.filings]
    : [...submissions.filings];
}

function build(
  options: FixtureCompanyFactsOptions = {},
  filingList: readonly SecFiling[] = filings(),
) {
  const facts = parseSecCompanyFacts(
    buildFixtureCompanyFactsText(options),
    isSelectedSecConcept,
  );

  if (!facts.ok) {
    throw new Error("fixture must parse");
  }

  return buildSecFactVintages({
    cik: FIXTURE_FILER_CIK,
    facts: facts.facts,
    filings: filingList,
  });
}

function recordsFor(result: ReturnType<typeof build>, concept: string) {
  return result.records.filter((record) => record.concept === concept);
}

describe("buildSecFactVintages", () => {
  it("publishes a repeated value once, available when it was first disclosed", () => {
    const assets = recordsFor(build(), "us-gaap:Assets");

    expect(assets.map((record) => record.rawValue)).toStrictEqual([
      "412000000",
      "396500000",
    ]);
    // El 10-K repitió el valor del 10-Q: la vintage es del 10-Q, que lo dijo antes.
    expect(assets[0]).toMatchObject({
      sourceDocumentId: FIXTURE_ACCESSIONS.q3Filing,
      availableAt: FIXTURE_ACCEPTED_AT.q3Filing,
    });
  });

  it("publishes the amendment as the next vintage at its acceptance", () => {
    const [, amended] = recordsFor(build(), "us-gaap:Assets");

    expect(amended).toMatchObject({
      rawValue: "396500000",
      sourceDocumentId: FIXTURE_ACCESSIONS.amendment,
      availableAt: FIXTURE_ACCEPTED_AT.amendment,
      asOf: "2008-12-31",
      periodType: "instant",
      qualityFlags: [],
    });
  });

  it("accounts for every point exactly once", () => {
    const { counts } = build();

    expect(counts).toStrictEqual({
      points: 8,
      vintages: 7,
      restated: 1,
      repeats: 1,
      rejected: 0,
      inferredAvailability: 0,
    });
    expect(counts.vintages + counts.repeats + counts.rejected).toBe(
      counts.points,
    );
  });

  it("separates a quarter from the six months that contain it", () => {
    const revenue = recordsFor(build(), "us-gaap:Revenues");

    expect(
      revenue.map((record) => [record.periodType, record.periodStart]).sort(),
    ).toStrictEqual([
      ["annual", "2009-01-01"],
      ["quarter", "2010-04-01"],
      ["year_to_date", "2010-01-01"],
    ]);
  });

  it("maps units with the currency apart and keeps the source concept", () => {
    const [eps] = recordsFor(build(), "us-gaap:EarningsPerShareDiluted");
    const [shares] = recordsFor(
      build(),
      "dei:EntityCommonStockSharesOutstanding",
    );

    expect(eps).toMatchObject({
      metricId: "us-gaap:EarningsPerShareDiluted",
      unit: "monetary_per_share",
      currency: "USD",
      rawValue: "1.37",
    });
    expect(shares).toMatchObject({
      unit: "shares",
      currency: null,
      periodType: "instant",
      asOf: "2010-02-15",
    });
  });

  it("emits records that pass staging and name their subject by CIK", () => {
    for (const record of build().records) {
      expect(stagedRecordSchema.safeParse(record).success).toBe(true);
      expect(record.subjectKey).toBe(FIXTURE_FILER_CIK);
    }
  });

  it("orders records by availability so a chain never arrives backwards", () => {
    const instants = build().records.map((record) =>
      Date.parse(record.availableAt),
    );

    expect(instants).toStrictEqual([...instants].sort((a, b) => a - b));
  });

  it("describes each filing that published a vintage once", () => {
    const { documents } = build();

    expect(documents.map((document) => document.accessionNumber)).toStrictEqual(
      [
        FIXTURE_ACCESSIONS.q3Filing,
        FIXTURE_ACCESSIONS.annual,
        FIXTURE_ACCESSIONS.amendment,
        FIXTURE_ACCESSIONS.q2Filing,
      ].sort(),
    );
    expect(
      documents.find(
        (document) => document.accessionNumber === FIXTURE_ACCESSIONS.amendment,
      ),
    ).toStrictEqual({
      accessionNumber: FIXTURE_ACCESSIONS.amendment,
      form: "10-K/A",
      filingDate: "2010-05-12",
      acceptedAt: FIXTURE_ACCEPTED_AT.amendment,
      availableAt: FIXTURE_ACCEPTED_AT.amendment,
      availabilityRule: "sec_acceptance",
      reportDate: "2009-12-31",
      fiscalYear: 2009,
      fiscalPeriod: "FY",
    });
  });

  it("infers availability from the filing date when the history file is missing", () => {
    const result = build({}, filings(false));
    const [original] = recordsFor(result, "us-gaap:Assets");

    expect(original).toMatchObject({
      sourceDocumentId: FIXTURE_ACCESSIONS.q3Filing,
      // Fin del día de filing en Nueva York, nunca antes.
      availableAt: "2009-11-04T05:00:00.000Z",
      qualityFlags: ["availability_inferred"],
    });
    expect(result.counts.inferredAvailability).toBe(1);
  });

  it("rejects facts whose filing disagrees between the two documents", () => {
    const tampered = filings().map((filing) =>
      filing.accessionNumber === FIXTURE_ACCESSIONS.amendment
        ? { ...filing, form: "10-K" }
        : filing,
    );
    const result = build({}, tampered);

    expect(result.rejections).toStrictEqual([
      {
        concept: "us-gaap:Assets",
        unit: "USD",
        accessionNumber: FIXTURE_ACCESSIONS.amendment,
        code: "filing_metadata_mismatch",
      },
    ]);
    // Sin la enmienda, el hecho queda con su único valor conocido.
    expect(recordsFor(result, "us-gaap:Assets")).toHaveLength(1);
  });

  it("rejects facts of a filing whose submissions row could not be read", () => {
    const facts = parseSecCompanyFacts(
      buildFixtureCompanyFactsText(),
      isSelectedSecConcept,
    );
    if (!facts.ok) throw new Error("fixture must parse");

    const result = buildSecFactVintages({
      cik: FIXTURE_FILER_CIK,
      facts: facts.facts,
      filings: filings().filter(
        (filing) => filing.accessionNumber !== FIXTURE_ACCESSIONS.amendment,
      ),
      unreadableAccessions: new Set([FIXTURE_ACCESSIONS.amendment]),
    });

    expect(result.rejections).toStrictEqual([
      {
        concept: "us-gaap:Assets",
        unit: "USD",
        accessionNumber: FIXTURE_ACCESSIONS.amendment,
        code: "filing_conflict",
      },
    ]);
    expect(result.counts.inferredAvailability).toBe(0);
  });

  it("rejects two values for the same fact inside one filing", () => {
    const result = build({
      extraPoints: {
        "USD@OperatingIncomeLoss": [
          {
            start: "2009-01-01",
            end: "2009-12-31",
            val: "21000000",
            accn: FIXTURE_ACCESSIONS.annual,
            fy: 2009,
            fp: "FY",
            form: "10-K",
            filed: "2010-02-23",
          },
          {
            start: "2009-01-01",
            end: "2009-12-31",
            val: "21500000",
            accn: FIXTURE_ACCESSIONS.annual,
            fy: 2009,
            fp: "FY",
            form: "10-K",
            filed: "2010-02-23",
          },
        ],
      },
    });

    expect(result.rejections.map((rejection) => rejection.code)).toStrictEqual([
      "conflicting_values_in_filing",
      "conflicting_values_in_filing",
    ]);
    expect(recordsFor(result, "us-gaap:OperatingIncomeLoss")).toHaveLength(0);
  });

  it("rejects different values disclosed at the same instant by two filings", () => {
    const simultaneous = filings().map((filing) =>
      filing.accessionNumber === FIXTURE_ACCESSIONS.amendment
        ? { ...filing, acceptedAt: FIXTURE_ACCEPTED_AT.annual }
        : filing,
    );
    const result = build({}, simultaneous);

    expect(result.rejections.map((rejection) => rejection.code)).toStrictEqual([
      "simultaneous_conflicting_values",
      "simultaneous_conflicting_values",
    ]);
    // El valor anterior al empate sigue siendo el conocido.
    expect(
      recordsFor(result, "us-gaap:Assets").map((record) => record.rawValue),
    ).toStrictEqual(["412000000"]);
  });

  it("rejects an unsupported duration and an unknown unit by name", () => {
    const result = build({
      extraPoints: {
        "USD@PaymentsOfDividends": [
          {
            start: "2010-01-01",
            end: "2010-04-30",
            val: "3000000",
            accn: FIXTURE_ACCESSIONS.q2Filing,
            fy: 2010,
            fp: "Q2",
            form: "10-Q",
            filed: "2010-08-04",
          },
        ],
        "Store@Goodwill": [
          {
            end: "2010-06-30",
            val: "12",
            accn: FIXTURE_ACCESSIONS.q2Filing,
            fy: 2010,
            fp: "Q2",
            form: "10-Q",
            filed: "2010-08-04",
          },
        ],
      },
    });

    expect(
      result.rejections.map((rejection) => [rejection.concept, rejection.code]),
    ).toStrictEqual([
      ["us-gaap:PaymentsOfDividends", "unsupported_period_duration"],
      ["us-gaap:Goodwill", "unsupported_unit"],
    ]);
  });

  it("rejects a fact from a filing without a defensible availability", () => {
    const result = build({
      extraPoints: {
        "USD@Liabilities": [
          {
            end: "2010-06-30",
            val: "250000000",
            accn: "0000000042-10-000099",
            fy: 2010,
            fp: null,
            form: "S-4",
            filed: "2010-09-01",
          },
        ],
      },
    });

    expect(result.rejections).toStrictEqual([
      {
        concept: "us-gaap:Liabilities",
        unit: "USD",
        accessionNumber: "0000000042-10-000099",
        code: "availability_unknown",
      },
    ]);
  });

  it("is deterministic: the same inputs build the same records in the same order", () => {
    expect(build()).toStrictEqual(build());
  });

  it("publishes a value that returns to an earlier figure as a new vintage", () => {
    const result = build({
      extraPoints: {
        "USD@Liabilities": [
          {
            end: "2008-12-31",
            val: "200000000",
            accn: FIXTURE_ACCESSIONS.q3Filing,
            fy: 2009,
            fp: "Q3",
            form: "10-Q",
            filed: "2009-11-03",
          },
          {
            end: "2008-12-31",
            val: "190000000",
            accn: FIXTURE_ACCESSIONS.annual,
            fy: 2009,
            fp: "FY",
            form: "10-K",
            filed: "2010-02-23",
          },
          {
            end: "2008-12-31",
            val: "200000000",
            accn: FIXTURE_ACCESSIONS.amendment,
            fy: 2009,
            fp: "FY",
            form: "10-K/A",
            filed: "2010-05-12",
          },
        ],
      },
    });

    expect(
      recordsFor(result, "us-gaap:Liabilities").map(
        (record) => record.rawValue,
      ),
    ).toStrictEqual(["200000000", "190000000", "200000000"]);
  });
});
