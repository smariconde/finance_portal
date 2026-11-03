import { describe, expect, it } from "vitest";

import { caveatsFor } from "./declared-transformation-caveats";
import type { SeriesBasis } from "./series-definition";
import type { SeriesPoint } from "./series-observation";
import {
  chainCpiIndex,
  MacroTransformError,
  SPLICE_BEFORE_BASIS,
  reconcileCpiChain,
  transformationEligibility,
  TRANSFORMATION_REFERENCE_BASES,
  transformSeries,
  type TransformationInput,
} from "./series-transformation";

const PESOS: SeriesBasis = {
  frequency: "daily",
  unit: "En millones de ARS",
  currencyCode: "ML",
};

function series(...pairs: [string, string][]): SeriesPoint[] {
  return pairs.map(([periodOn, value]) => ({
    periodOn,
    value,
    revision: 0,
    availableAt: "2026-11-02T12:00:00.000Z",
  }));
}

function run(
  input: Partial<TransformationInput> & Pick<TransformationInput, "kind">,
) {
  return transformSeries({
    basis: PESOS,
    referenceBasis: TRANSFORMATION_REFERENCE_BASES[input.kind],
    nominal: [],
    reference: [],
    ...input,
  });
}

function computedOf(result: ReturnType<typeof transformSeries>) {
  if (result.status !== "computed") {
    throw new Error(`expected computed, got ${result.status}`);
  }

  return result;
}

describe("transformationEligibility", () => {
  it("transforms a peso amount in every way", () => {
    expect(transformationEligibility(PESOS, "real_cpi")).toBeNull();
    expect(transformationEligibility(PESOS, "real_cer")).toBeNull();
    expect(transformationEligibility(PESOS, "usd_wholesale")).toBeNull();
  });

  it("lets an amount with foreign currency inside reach dollars only", () => {
    const mixed: SeriesBasis = { ...PESOS, currencyCode: "MEyML" };

    expect(transformationEligibility(mixed, "usd_wholesale")).toBeNull();
    expect(transformationEligibility(mixed, "real_cpi")).toBe(
      "includes_foreign_currency",
    );
    expect(transformationEligibility(mixed, "real_cer")).toBe(
      "includes_foreign_currency",
    );
  });

  it("refuses rates, indexes, exchange rates and dollar amounts", () => {
    for (const unit of [
      "En porcentaje nominal anual",
      "Índice base 2.2.02=1",
      "Pesos argentinos por dólar estadounidense",
      "En millones de USD",
    ]) {
      expect(transformationEligibility({ ...PESOS, unit }, "real_cpi")).toBe(
        "not_peso_amount",
      );
    }
  });

  it("names the refusal instead of computing", () => {
    expect(
      run({
        kind: "real_cpi",
        basis: { ...PESOS, currencyCode: "MEyML" },
        nominal: series(["2026-01-30", "100"]),
        reference: series(["2026-01-31", "2"]),
      }),
    ).toEqual({
      status: "not_transformable",
      kind: "real_cpi",
      reason: "includes_foreign_currency",
    });
  });
});

describe("chainCpiIndex", () => {
  it("chains monthly inflation into an index", () => {
    const chain = chainCpiIndex(
      series(["2026-01-31", "10"], ["2026-02-28", "0"], ["2026-03-31", "-50"]),
    );

    expect(chain.map((entry) => [entry.month, entry.index.toFixed()])).toEqual([
      ["2026-01", "1.1"],
      ["2026-02", "1.1"],
      ["2026-03", "0.55"],
    ]);
    expect(new Set(chain.map((entry) => entry.segment)).size).toBe(1);
  });

  it("opens a new segment after a missing month instead of interpolating", () => {
    const chain = chainCpiIndex(
      series(["2026-01-31", "1"], ["2026-03-31", "1"]),
    );

    expect(chain.map((entry) => entry.segment)).toEqual([0, 1]);
  });

  it("chains across a year boundary", () => {
    const chain = chainCpiIndex(
      series(["2025-12-31", "2"], ["2026-01-31", "2"]),
    );

    expect(chain.map((entry) => entry.segment)).toEqual([0, 0]);
  });

  it("rejects inflation of -100 % or less", () => {
    expect(() => chainCpiIndex(series(["2026-01-31", "-100"]))).toThrow(
      MacroTransformError,
    );
  });

  it("rejects two points in one month", () => {
    expect(() =>
      chainCpiIndex(series(["2026-01-15", "1"], ["2026-01-31", "1"])),
    ).toThrow(MacroTransformError);
  });
});

describe("real by chained CPI", () => {
  const inflation = series(
    ["2026-01-31", "10"],
    ["2026-02-28", "10"],
    ["2026-03-31", "0"],
  );

  it("deflates the month-end stock into pesos of the last published month", () => {
    const result = computedOf(
      run({
        kind: "real_cpi",
        nominal: series(
          ["2026-01-15", "50"],
          ["2026-01-30", "110"],
          ["2026-02-27", "121"],
          ["2026-03-31", "121"],
        ),
        reference: inflation,
      }),
    );

    expect(result.baseOn).toBe("2026-03");
    expect(result.unit).toBe("En millones de ARS de 2026-03");
    expect(result.chainVersion).toBe("bcra-cpi-chain-1.0.0");
    expect(result.points.map((point) => [point.periodOn, point.value])).toEqual(
      [
        ["2026-01-30", "121"],
        ["2026-02-27", "121"],
        ["2026-03-31", "121"],
      ],
    );
  });

  it("takes a declared base month", () => {
    const result = computedOf(
      run({
        kind: "real_cpi",
        nominal: series(["2026-03-31", "121"]),
        reference: inflation,
        baseOn: "2026-01",
      }),
    );

    expect(result.points[0]!.value).toBe("110");
  });

  it("names months before the history, not yet published and across a gap", () => {
    const result = computedOf(
      run({
        kind: "real_cpi",
        nominal: series(
          ["2025-12-31", "1"],
          ["2026-01-30", "1"],
          ["2026-02-27", "1"],
          ["2026-03-31", "1"],
          ["2026-04-30", "1"],
        ),
        reference: series(["2026-01-31", "1"], ["2026-03-31", "1"]),
      }),
    );

    expect(result.points.map((point) => point.reason)).toEqual([
      "before_reference_history",
      "reference_gap",
      "reference_gap",
      null,
      "reference_not_published",
    ]);
    expect(result.points[4]).toMatchObject({ value: null, nominal: "1" });
  });

  it("keeps the sign of a negative amount and a zero as zero", () => {
    const result = computedOf(
      run({
        kind: "real_cpi",
        nominal: series(["2026-01-30", "-100"], ["2026-02-27", "0"]),
        reference: inflation,
      }),
    );

    expect(result.points.map((point) => point.value)).toEqual(["-110", "0"]);
  });

  it("reports a base the chain does not reach", () => {
    expect(
      run({
        kind: "real_cpi",
        nominal: series(["2026-01-30", "1"]),
        reference: inflation,
        baseOn: "2026-09",
      }),
    ).toEqual({
      status: "base_not_available",
      kind: "real_cpi",
      baseOn: "2026-09",
    });
  });

  it("rejects a base that is not a month", () => {
    expect(() =>
      run({
        kind: "real_cpi",
        nominal: series(["2026-01-30", "1"]),
        reference: inflation,
        baseOn: "2026-01-31",
      }),
    ).toThrow(MacroTransformError);
  });
});

describe("real by CER", () => {
  const cer = series(
    ["2026-01-01", "1"],
    ["2026-01-02", "2"],
    ["2026-01-03", "4"],
  );

  it("deflates each day by the same day's CER, never another day's", () => {
    const result = computedOf(
      run({
        kind: "real_cer",
        nominal: series(
          ["2025-12-31", "1"],
          ["2026-01-01", "10"],
          ["2026-01-03", "40"],
          ["2026-01-04", "40"],
        ),
        reference: cer,
      }),
    );

    expect(result.baseOn).toBe("2026-01-03");
    expect(result.points.map((point) => [point.value, point.reason])).toEqual([
      [null, "before_reference_history"],
      ["40", null],
      ["40", null],
      [null, "reference_not_published"],
    ]);
    expect(result.caveats.map((caveat) => caveat.code)).toContain(
      "cer_lags_cpi",
    );
  });

  it("reports a base day without CER", () => {
    expect(
      run({
        kind: "real_cer",
        nominal: series(["2026-01-01", "1"]),
        reference: cer,
        baseOn: "2026-02-01",
      }),
    ).toMatchObject({ status: "base_not_available" });
  });

  it("rejects a non-positive CER", () => {
    expect(() =>
      run({
        kind: "real_cer",
        nominal: series(["2026-01-01", "1"]),
        reference: series(["2026-01-01", "0"]),
      }),
    ).toThrow(MacroTransformError);
  });
});

describe("dollars by the wholesale rate", () => {
  const fx = series(["2026-01-05", "1000"], ["2026-01-07", "1250"]);

  it("divides by the same day's rate and names a day without one", () => {
    const result = computedOf(
      run({
        kind: "usd_wholesale",
        basis: { ...PESOS, currencyCode: "MEyML" },
        nominal: series(
          ["2026-01-05", "2000"],
          ["2026-01-06", "2000"],
          ["2026-01-07", "2500"],
        ),
        reference: fx,
      }),
    );

    expect(result.unit).toBe("En millones de USD");
    expect(result.baseOn).toBeNull();
    expect(
      result.points.map((point) => [
        point.value,
        point.reason,
        point.referenceOn,
      ]),
    ).toEqual([
      ["2", null, "2026-01-05"],
      [null, "reference_gap", null],
      ["2", null, "2026-01-07"],
    ]);
  });

  it("keeps a non-terminating division exact to the policy's precision", () => {
    const result = computedOf(
      run({
        kind: "usd_wholesale",
        nominal: series(["2026-01-05", "1"]),
        reference: series(["2026-01-05", "3"]),
      }),
    );

    expect(result.points[0]!.value).toBe(
      "0.3333333333333333333333333333333333",
    );
  });

  it("reports each series' own dates", () => {
    const result = computedOf(
      run({
        kind: "usd_wholesale",
        nominal: series(["2026-01-05", "1"], ["2026-01-09", "1"]),
        reference: fx,
      }),
    );

    expect(result.coverage).toEqual({
      nominal: { firstOn: "2026-01-05", lastOn: "2026-01-09" },
      reference: { firstOn: "2026-01-05", lastOn: "2026-01-07" },
    });
  });

  it("refuses an empty reference by name", () => {
    expect(
      run({ kind: "usd_wholesale", nominal: series(["2026-01-05", "1"]) }),
    ).toEqual({ status: "reference_empty", kind: "usd_wholesale" });
  });
});

describe("reference basis", () => {
  it("refuses a reference whose unit moved", () => {
    expect(
      run({
        kind: "real_cpi",
        referenceBasis: {
          frequency: "monthly",
          unit: "Índice",
          currencyCode: "ML",
        },
        nominal: series(["2026-01-30", "1"]),
        reference: series(["2026-01-31", "1"]),
      }),
    ).toMatchObject({ status: "reference_basis_unexpected" });
  });
});

describe("caveatsFor", () => {
  it("returns only the caveats whose span touches the range", () => {
    expect(caveatsFor("usd_wholesale", "2016-01-01", "2019-08-31")).toEqual([]);
    expect(
      caveatsFor("usd_wholesale", "2015-12-16", "2019-09-01").map(
        (caveat) => caveat.from,
      ),
    ).toEqual(["2011-10-31", "2019-09-01"]);
    expect(
      caveatsFor("real_cpi", "2020-01-01", "2026-01-01").map(
        (caveat) => caveat.code,
      ),
    ).toEqual(["cpi_published_one_decimal"]);
  });

  it("flags the intervened INDEC years for both deflators", () => {
    for (const kind of ["real_cpi", "real_cer"] as const) {
      expect(
        caveatsFor(kind, "2010-01-01", "2010-12-31").map((c) => c.code),
      ).toContain("indec_cpi_under_intervention");
    }
  });
});

describe("reconcileCpiChain", () => {
  const monthly = series(
    ...Array.from({ length: 13 }, (_, index): [string, string] => [
      `${index === 12 ? "2026" : "2025"}-${String((index % 12) + 1).padStart(2, "0")}-28`,
      "1",
    ]),
  );

  it("reproduces the published year-on-year from twelve chained months", () => {
    // 1,01^12 − 1 = 12,6825 %; publicado con un decimal: 12,7.
    const result = reconcileCpiChain(monthly, series(["2026-01-31", "12.7"]));

    expect(result).toMatchObject({ compared: 1, outside: [] });
    expect(Number(result.maxDeviation)).toBeLessThan(0.0002);
  });

  it("flags a month the chain does not reproduce", () => {
    const result = reconcileCpiChain(monthly, series(["2026-01-31", "14"]));

    expect(result.outside.map((entry) => entry.month)).toEqual(["2026-01"]);
  });

  it("compares nothing across a gap", () => {
    const gapped = monthly.filter((point) => point.periodOn !== "2025-06-28");

    expect(
      reconcileCpiChain(gapped, series(["2026-01-31", "12.7"])).compared,
    ).toBe(0);
  });
});

describe("dollars spliced before the wholesale rate", () => {
  const wholesale = series(["2002-03-04", "2"], ["2002-03-05", "2.5"]);
  const quote = series(
    ["2001-12-20", "1"],
    ["2002-01-11", "1.6"],
    ["2002-03-04", "2.05"],
    ["2002-03-05", "3"],
  );

  it("uses the BCRA quote only before the first wholesale day and names the splice", () => {
    const result = computedOf(
      run({
        kind: "usd_spliced",
        nominal: series(
          ["2001-12-19", "10"],
          ["2001-12-20", "10"],
          ["2001-12-21", "10"],
          ["2002-01-11", "16"],
          ["2002-03-04", "20"],
          ["2002-03-05", "25"],
          ["2002-03-06", "25"],
        ),
        reference: wholesale,
        beforeSplice: { basis: SPLICE_BEFORE_BASIS, points: quote },
      }),
    );

    expect(
      result.points.map((point) => [
        point.periodOn,
        point.value,
        point.reason,
        point.referenceSeries,
      ]),
    ).toEqual([
      ["2001-12-19", null, "before_reference_history", null],
      ["2001-12-20", "10", null, "before_splice"],
      ["2001-12-21", null, "reference_gap", null],
      ["2002-01-11", "10", null, "before_splice"],
      // Desde el empalme manda el mayorista, aunque la cotización exista.
      ["2002-03-04", "10", null, "reference"],
      ["2002-03-05", "10", null, "reference"],
      ["2002-03-06", null, "reference_not_published", null],
    ]);
    expect(result.splice).toEqual({
      on: "2002-03-04",
      beforeSplice: { firstOn: "2001-12-20", lastOn: "2002-03-05" },
      levelGap: "0.025",
    });
    expect(result.unit).toBe("En millones de USD");
  });

  it("leaves the level gap null when the quote skips the splice day", () => {
    const result = computedOf(
      run({
        kind: "usd_spliced",
        nominal: series(["2002-03-04", "2"]),
        reference: wholesale,
        beforeSplice: {
          basis: SPLICE_BEFORE_BASIS,
          points: series(["2002-03-01", "2"]),
        },
      }),
    );

    expect(result.splice?.levelGap).toBeNull();
  });

  it("lets two-currency amounts reach spliced dollars only", () => {
    expect(
      transformationEligibility(
        { ...PESOS, currencyCode: "MEyML" },
        "usd_spliced",
      ),
    ).toBeNull();
  });

  it("refuses a series before the splice in another unit", () => {
    expect(
      run({
        kind: "usd_spliced",
        nominal: series(["2002-03-04", "2"]),
        reference: wholesale,
        beforeSplice: {
          basis: { ...SPLICE_BEFORE_BASIS, unit: "Pesos argentinos por euro" },
          points: quote,
        },
      }),
    ).toMatchObject({ status: "reference_basis_unexpected" });
  });

  it("never runs without the series before the splice", () => {
    expect(() =>
      run({
        kind: "usd_spliced",
        nominal: series(["2002-03-04", "2"]),
        reference: wholesale,
      }),
    ).toThrow(MacroTransformError);
  });

  it("carries the exchange-control caveat like the wholesale conversion", () => {
    expect(
      caveatsFor("usd_spliced", "2012-01-01", "2012-12-31").map(
        (caveat) => caveat.code,
      ),
    ).toEqual(["official_fx_under_controls"]);
  });
});
