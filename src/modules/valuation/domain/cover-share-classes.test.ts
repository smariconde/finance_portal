import { describe, expect, it } from "vitest";

import type {
  CoverShareFact,
  XbrlContext,
  XbrlShareFact,
  XbrlShareFacts,
} from "@/modules/fundamentals/domain/sec-xbrl-instance";

import {
  SHARES_OUTSTANDING_CLASSES_CONVERTED_VERSION,
  SHARES_OUTSTANDING_CLASSES_VERSION,
  sumCoverShareClasses,
} from "./cover-share-classes";

const CIK = "0001321655";
const fact = (
  member: string,
  value: string,
  overrides: Partial<CoverShareFact> = {},
): CoverShareFact => ({
  contextId: member,
  cik: CIK,
  instant: "2026-10-26",
  members: [{ axis: "StatementClassOfStockAxis", member }],
  typed: false,
  value,
  ...overrides,
});
const sum = (facts: readonly CoverShareFact[], cik = CIK) =>
  sumCoverShareClasses({
    cik,
    facts,
    accessionNumber: "0001321655-26-000099",
    acceptedAt: "2026-11-03T21:05:00.000Z",
  });

describe(SHARES_OUTSTANDING_CLASSES_VERSION, () => {
  // PLTR, 10-Q del 2026-09-30: A, B y F.
  it("sums every class at the cover date and cites the filing", () => {
    expect(
      sum([
        fact("CommonClassAMember", "2306705341"),
        fact("CommonClassBMember", "101787133"),
        fact("CommonClassFMember", "1005000"),
      ]),
    ).toEqual({
      status: "summed",
      observation: {
        concept: "dei:EntityCommonStockSharesOutstanding",
        asOf: "2026-10-26",
        availableAt: "2026-11-03T21:05:00.000Z",
        value: "2409497474",
        observationId: null,
        sourceDocumentId: "0001321655-26-000099",
        qualityFlags: [SHARES_OUTSTANDING_CLASSES_VERSION],
      },
      classes: [
        { member: "CommonClassAMember", shares: "2306705341", weight: "1" },
        { member: "CommonClassBMember", shares: "101787133", weight: "1" },
        { member: "CommonClassFMember", shares: "1005000", weight: "1" },
      ],
    });
  });

  it("weighs Berkshire's class A in class B shares, as declared", () => {
    const result = sum(
      [
        fact("CommonClassAMember", "480476", { cik: "0001067983" }),
        fact("CommonClassBMember", "1403805594", { cik: "0001067983" }),
      ],
      "0001067983",
    );
    expect(result).toMatchObject({
      status: "summed",
      observation: {
        value: "2124519594",
        qualityFlags: [
          SHARES_OUTSTANDING_CLASSES_VERSION,
          "share_class_weights_declared",
        ],
      },
    });
  });

  it("leaves a single class to the undimensioned rule", () => {
    expect(sum([fact("CommonClassAMember", "10")])).toEqual({
      status: "unavailable",
      reason: "single_class",
    });
  });

  it("refuses classes counted at different dates", () => {
    expect(
      sum([
        fact("CommonClassAMember", "10"),
        fact("CommonClassBMember", "5", { instant: "2026-10-27" }),
      ]),
    ).toEqual({ status: "unavailable", reason: "class_dates_differ" });
  });

  it("refuses a count on another axis or with a second member", () => {
    expect(
      sum([
        fact("CommonClassAMember", "10"),
        fact("CommonClassBMember", "5", {
          members: [
            { axis: "StatementClassOfStockAxis", member: "CommonClassBMember" },
            { axis: "LegalEntityAxis", member: "SubsidiaryMember" },
          ],
        }),
      ]),
    ).toEqual({ status: "unavailable", reason: "class_member_ambiguous" });
  });

  it("ignores another filer's facts", () => {
    expect(
      sum([
        fact("CommonClassAMember", "10", { cik: "0000000099" }),
        fact("CommonClassBMember", "5", { cik: "0000000099" }),
      ]),
    ).toEqual({ status: "unavailable", reason: "no_class_facts" });
  });
});

describe(SHARES_OUTSTANDING_CLASSES_CONVERTED_VERSION, () => {
  // Visa declara la conversión; las cifras son sintéticas con su forma.
  const VISA = "0001403161";
  const CLOSE = "2026-09-30";
  const cover = (member: string, value: string) =>
    fact(member, value, { cik: VISA, instant: "2026-10-29" });
  const COVER = [
    cover("CommonClassAMember", "1700000000"),
    cover("CommonClassB1Member", "2000000"),
    cover("CommonClassCMember", "10000000"),
  ];

  function extension(
    entries: readonly (readonly [
      string,
      string | null,
      string,
      "pure" | "shares",
      string?,
    ])[],
  ): XbrlShareFacts {
    const contexts = new Map<string, XbrlContext>();
    const facts: XbrlShareFact[] = [];
    entries.forEach(([local, member, value, unit, date], index) => {
      const id = `x-${index}`;
      contexts.set(id, {
        id,
        cik: VISA,
        instant: date ?? CLOSE,
        startDate: null,
        endDate: null,
        members:
          member === null
            ? []
            : [{ axis: "StatementClassOfStockAxis", member }],
        typed: false,
      });
      facts.push({
        concept: `extension:${local}`,
        contextId: id,
        unit,
        value,
        decimals: unit === "pure" ? 4 : -6,
      });
    });
    return {
      version: "sec-xbrl-share-facts-1.0.0",
      contexts,
      facts,
      conflicting: [],
    };
  }

  const RATES = [
    ["CommonStockConversionRate", "CommonClassAMember", "0", "pure"],
    ["CommonStockConversionRate", "CommonClassB1Member", "1.5000", "pure"],
    ["CommonStockConversionRate", "CommonClassCMember", "4.0000", "pure"],
  ] as const;
  const AS_CONVERTED = [
    [
      "SharesOutstandingAsConvertedBasis",
      "SeriesBPreferredStockMember",
      "1000000",
      "shares",
    ],
    [
      "SharesOutstandingAsConvertedBasis",
      "CommonClassCMember",
      "40000000",
      "shares",
    ],
    ["SharesOutstandingAsConvertedBasis", null, "1747000000", "shares"],
  ] as const;
  const convert = (
    conversionFacts: XbrlShareFacts | null,
    facts: readonly CoverShareFact[] = COVER,
  ) =>
    sumCoverShareClasses({
      cik: VISA,
      facts,
      conversionFacts,
      accessionNumber: "0001403161-26-000134",
      acceptedAt: "2026-11-12T21:00:00.000Z",
    });

  it("weighs each class by the filing's own rate and adds what converts outside the cover", () => {
    expect(convert(extension([...RATES, ...AS_CONVERTED]))).toEqual({
      status: "summed",
      observation: {
        concept: "dei:EntityCommonStockSharesOutstanding",
        asOf: "2026-10-29",
        availableAt: "2026-11-12T21:00:00.000Z",
        // 1.700 M + 2 M × 1,5 + 10 M × 4 + 1 M de preferentes
        value: "1744000000",
        observationId: null,
        sourceDocumentId: "0001403161-26-000134",
        qualityFlags: [
          SHARES_OUTSTANDING_CLASSES_CONVERTED_VERSION,
          "share_class_conversion_reported",
        ],
      },
      classes: [
        { member: "CommonClassAMember", shares: "1700000000", weight: "1" },
        { member: "CommonClassB1Member", shares: "2000000", weight: "1.5000" },
        { member: "CommonClassCMember", shares: "10000000", weight: "4.0000" },
        {
          member: "SeriesBPreferredStockMember",
          shares: "1000000",
          weight: "1",
        },
      ],
      control: {
        asOf: CLOSE,
        filerTotal: "1747000000",
        difference: "-0.001717",
      },
    });
  });

  it("refuses a class without a positive rate, never weighing it as one", () => {
    expect(convert(extension([RATES[0], RATES[2], ...AS_CONVERTED]))).toEqual({
      status: "unavailable",
      reason: "conversion_rate_missing",
    });
    expect(
      convert(
        extension([
          RATES[0],
          ["CommonStockConversionRate", "CommonClassB1Member", "0", "pure"],
          RATES[2],
          ...AS_CONVERTED,
        ]),
      ),
    ).toEqual({ status: "unavailable", reason: "conversion_rate_missing" });
  });

  it("uses rates no later than the cover and refuses without them", () => {
    expect(
      convert(
        extension(
          RATES.map(
            ([local, member, value, unit]) =>
              [local, member, value, unit, "2026-11-30"] as const,
          ),
        ),
      ),
    ).toEqual({ status: "unavailable", reason: "conversion_rate_missing" });
    expect(convert(null)).toEqual({
      status: "unavailable",
      reason: "conversion_facts_missing",
    });
  });

  it("checks the total against the filing's own as-converted total", () => {
    expect(convert(extension([...RATES, AS_CONVERTED[0]]))).toEqual({
      status: "unavailable",
      reason: "as_converted_total_missing",
    });
    expect(
      convert(
        extension([
          ...RATES,
          AS_CONVERTED[0],
          ["SharesOutstandingAsConvertedBasis", null, "1800000000", "shares"],
        ]),
      ),
    ).toEqual({ status: "unavailable", reason: "as_converted_total_mismatch" });
  });

  it("needs the valued class on the cover", () => {
    expect(
      convert(extension([...RATES, ...AS_CONVERTED]), COVER.slice(1)),
    ).toEqual({ status: "unavailable", reason: "conversion_rate_missing" });
  });
});
