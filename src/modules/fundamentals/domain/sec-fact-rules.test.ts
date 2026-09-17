import { describe, expect, it } from "vitest";

import {
  classifySecPeriod,
  formatSecUnit,
  indexSecFilings,
  mapSecUnit,
  resolveSecAvailability,
  secFactExternalId,
} from "./sec-fact-rules";

describe("classifySecPeriod", () => {
  it("treats a point without start as an instant at its end date", () => {
    expect(classifySecPeriod(null, "2009-12-31")).toStrictEqual({
      asOf: "2009-12-31",
      periodStart: null,
      periodEnd: null,
      periodType: "instant",
    });
  });

  it.each([
    // Ejercicio calendario.
    ["2010-01-01", "2010-03-31", "quarter"],
    ["2010-04-01", "2010-06-30", "quarter"],
    ["2010-01-01", "2010-06-30", "year_to_date"],
    ["2010-01-01", "2010-09-30", "year_to_date"],
    ["2009-01-01", "2009-12-31", "annual"],
    ["2008-01-01", "2008-12-31", "annual"],
    // Ejercicio de 52/53 semanas.
    ["2025-09-28", "2025-12-27", "quarter"],
    ["2022-09-25", "2022-12-31", "quarter"],
    ["2025-09-28", "2026-03-28", "year_to_date"],
    ["2025-09-28", "2026-06-27", "year_to_date"],
    ["2024-09-29", "2025-09-27", "annual"],
    ["2022-09-25", "2023-09-30", "annual"],
  ])("classifies %s..%s as %s", (start, end, periodType) => {
    expect(classifySecPeriod(start, end)?.periodType).toBe(periodType);
  });

  it("keeps the exact interval instead of snapping it to a bucket", () => {
    expect(classifySecPeriod("2025-09-28", "2026-03-28")).toStrictEqual({
      asOf: "2026-03-28",
      periodStart: "2025-09-28",
      periodEnd: "2026-03-28",
      periodType: "year_to_date",
    });
  });

  it.each([
    ["one month", "2010-01-01", "2010-01-31"],
    ["four months", "2010-01-01", "2010-04-30"],
    ["eleven months", "2010-01-01", "2010-11-30"],
    ["a stub between buckets", "2010-01-01", "2010-02-28"],
    ["more than a year", "2009-01-01", "2010-03-31"],
  ])(
    "rejects %s instead of forcing the nearest bucket",
    (_label, start, end) => {
      expect(classifySecPeriod(start, end)).toBeNull();
    },
  );
});

describe("mapSecUnit", () => {
  it.each([
    ["USD", { unit: "monetary", currency: "USD" }],
    ["EUR", { unit: "monetary", currency: "EUR" }],
    ["USD/shares", { unit: "monetary_per_share", currency: "USD" }],
    ["shares", { unit: "shares", currency: null }],
    ["pure", { unit: "pure", currency: null }],
  ])("maps %s", (unit, expected) => {
    expect(mapSecUnit(unit)).toStrictEqual(expected);
  });

  it.each(["Year", "Store", "USD/Contract", "usd", "U.S. dollars"])(
    "rejects %s instead of guessing",
    (unit) => {
      expect(mapSecUnit(unit)).toBeNull();
    },
  );
});

describe("formatSecUnit", () => {
  it.each(["USD", "EUR", "USD/shares", "shares", "pure"])(
    "returns %s from its own mapping",
    (unit) => {
      expect(formatSecUnit(mapSecUnit(unit)!)).toBe(unit);
    },
  );

  it.each([
    ["monetary without currency", { unit: "monetary", currency: null }],
    ["shares with currency", { unit: "shares", currency: "USD" }],
    ["an unknown unit", { unit: "Year", currency: null }],
    ["a malformed currency", { unit: "monetary", currency: "usd" }],
    ["a currency on an unknown unit", { unit: "ratio", currency: "USD" }],
  ])("has no source unit for %s", (_label, unit) => {
    expect(formatSecUnit(unit)).toBeNull();
  });
});

describe("secFactExternalId", () => {
  const identity = {
    cik: "0000000042",
    concept: "us-gaap:Revenues",
    unit: "monetary",
    currency: "USD",
    periodStart: "2009-01-01",
    asOf: "2009-12-31",
    accessionNumber: "0000000042-10-000005",
  };

  // El formato entra al content hash de cada observación publicada: si este test
  // cambia, todo lo ya publicado pasaría por revisión nueva.
  it("keeps the format the published hashes were computed with", () => {
    expect(secFactExternalId(identity)).toBe(
      "0000000042:us-gaap:Revenues:USD:2009-01-01:2009-12-31:0000000042-10-000005",
    );
    expect(
      secFactExternalId({
        ...identity,
        concept: "us-gaap:EarningsPerShareDiluted",
        unit: "monetary_per_share",
      }),
    ).toBe(
      "0000000042:us-gaap:EarningsPerShareDiluted:USD/shares:2009-01-01:2009-12-31:0000000042-10-000005",
    );
    expect(
      secFactExternalId({
        ...identity,
        concept: "dei:EntityCommonStockSharesOutstanding",
        unit: "shares",
        currency: null,
        periodStart: null,
        asOf: "2010-02-15",
      }),
    ).toBe(
      "0000000042:dei:EntityCommonStockSharesOutstanding:shares:instant:2010-02-15:0000000042-10-000005",
    );
  });

  it("refuses a unit no SEC point could have produced", () => {
    expect(() =>
      secFactExternalId({ ...identity, unit: "monetary", currency: null }),
    ).toThrow(RangeError);
  });
});

describe("resolveSecAvailability", () => {
  it("uses the acceptance instant when the source publishes it", () => {
    expect(
      resolveSecAvailability({
        form: "10-K",
        filingDate: "2010-02-24",
        acceptedAt: "2010-02-23T22:40:00.000Z",
      }),
    ).toStrictEqual({
      availableAt: "2010-02-23T22:40:00.000Z",
      acceptedAt: "2010-02-23T22:40:00.000Z",
      rule: "sec_acceptance",
      inferred: false,
    });
  });

  it("infers the end of the filing day in New York and flags it", () => {
    expect(
      resolveSecAvailability({
        form: "10-Q/A",
        filingDate: "2010-08-04",
        acceptedAt: null,
      }),
    ).toStrictEqual({
      availableAt: "2010-08-05T05:00:00.000Z",
      acceptedAt: null,
      rule: "sec_filing_date_end_of_day",
      inferred: true,
    });
  });

  it("never infers earlier than the real New York midnight, in summer or winter", () => {
    // Medianoche de Nueva York: 04:00Z en verano, 05:00Z en invierno.
    for (const [filingDate, midnightUtc] of [
      ["2010-08-04", "2010-08-05T04:00:00.000Z"],
      ["2010-01-15", "2010-01-16T05:00:00.000Z"],
    ] as const) {
      const inferred = resolveSecAvailability({
        form: "10-K",
        filingDate,
        acceptedAt: null,
      });

      expect(Date.parse(inferred!.availableAt)).toBeGreaterThanOrEqual(
        Date.parse(midnightUtc),
      );
    }
  });

  it("refuses to infer for a form whose filing date may precede dissemination", () => {
    expect(
      resolveSecAvailability({
        form: "NO ACT",
        filingDate: "2016-12-05",
        acceptedAt: null,
      }),
    ).toBeNull();
  });
});

describe("indexSecFilings", () => {
  const filing = {
    accessionNumber: "0000000042-10-000004",
    form: "10-K",
    filingDate: "2010-02-23",
    reportDate: "2009-12-31",
    acceptedAt: "2010-02-23T22:10:40.000Z",
  };

  it("collapses the same filing listed twice", () => {
    const index = indexSecFilings([filing, { ...filing }]);

    expect(index.byAccession.size).toBe(1);
    expect(index.conflicting.size).toBe(0);
  });

  it("drops an accession that two rows describe differently", () => {
    const index = indexSecFilings([
      filing,
      { ...filing, acceptedAt: "2010-02-24T11:00:00.000Z" },
    ]);

    expect(index.byAccession.has(filing.accessionNumber)).toBe(false);
    expect([...index.conflicting]).toStrictEqual([filing.accessionNumber]);
  });
});
