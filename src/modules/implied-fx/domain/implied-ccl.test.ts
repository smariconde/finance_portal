import { describe, expect, it } from "vitest";

import {
  declaredAdrPairSchema,
  DECLARED_ADR_PAIRS,
  ratioOn,
  type AdrLegClose,
  type DeclaredAdrPair,
} from "./declared-adr-pairs";
import {
  computeFxGap,
  computeImpliedCcl,
  ImpliedCclError,
} from "./implied-ccl";

const pair = (pairId: string, ratios: [string, string][]): DeclaredAdrPair =>
  declaredAdrPairSchema.parse({
    pairId,
    issuer: `Emisor sintético ${pairId}`,
    adrSymbol: pairId.toUpperCase(),
    localSymbol: `${pairId.toUpperCase()}.BA`,
    ratios: ratios.map(([validFrom, localPerAdr]) => ({
      validFrom,
      localPerAdr,
    })),
  });

const close = (
  legId: string,
  marketDate: string,
  value: string,
): AdrLegClose => ({
  legId,
  marketDate,
  close: value,
  currency: legId.endsWith("-adr") ? "USD" : "ARS",
});

/** Un par cuyo implícito del día es `ccl`, con ADR de 10 y ratio 1. */
const legs = (pairId: string, marketDate: string, ccl: string) => [
  close(`${pairId}-adr`, marketDate, "10"),
  close(`${pairId}-local`, marketDate, String(Number(ccl) * 10)),
];

const A = pair("aaa", [["2020-01-01", "1"]]);
const B = pair("bbb", [["2020-01-01", "1"]]);
const C = pair("ccc", [["2020-01-01", "1"]]);
const D = pair("ddd", [["2020-01-01", "1"]]);

describe("computeImpliedCcl", () => {
  it("takes the median of the pairs that closed both legs that day", () => {
    const points = computeImpliedCcl(
      [A, B, C],
      [
        ...legs("aaa", "2024-05-02", "1000"),
        ...legs("bbb", "2024-05-02", "1100"),
        // Un par raro: la mediana no se mueve.
        ...legs("ccc", "2024-05-02", "3300"),
      ],
    );

    expect(points).toEqual([
      {
        marketDate: "2024-05-02",
        value: "1100",
        reason: null,
        pairs: ["aaa", "bbb", "ccc"],
        low: "1000",
        high: "3300",
      },
    ]);
  });

  it("averages the two middle values with an even count", () => {
    const [point] = computeImpliedCcl(
      [A, B, C, D],
      [
        ...legs("aaa", "2024-05-02", "1000"),
        ...legs("bbb", "2024-05-02", "1100"),
        ...legs("ccc", "2024-05-02", "1200"),
        ...legs("ddd", "2024-05-02", "1300"),
      ],
    );

    expect(point!.value).toBe("1150");
  });

  it("is null with a reason below three pairs, never the mean of two", () => {
    const [point] = computeImpliedCcl(
      [A, B, C],
      [
        ...legs("aaa", "2024-05-02", "1000"),
        ...legs("bbb", "2024-05-02", "1100"),
        // La pata local de `ccc` no cerró ese día: el par no entra.
        close("ccc-adr", "2024-05-02", "10"),
        close("ccc-local", "2024-05-03", "12000"),
      ],
    );

    expect(point).toMatchObject({
      value: null,
      reason: "insufficient_pairs",
      pairs: ["aaa", "bbb"],
    });
  });

  it("applies the ratio in force that day and ignores days before the pair counts", () => {
    const split = pair("spl", [
      ["2020-01-01", "1"],
      ["2026-08-03", "10"],
    ]);
    const points = computeImpliedCcl(
      [split],
      [
        close("spl-adr", "2019-12-31", "10"),
        close("spl-local", "2019-12-31", "10000"),
        close("spl-adr", "2026-07-31", "10"),
        close("spl-local", "2026-07-31", "15000"),
        close("spl-adr", "2026-08-03", "10"),
        close("spl-local", "2026-08-03", "1500"),
      ],
    );

    expect(points.map((point) => [point.marketDate, point.low])).toEqual([
      ["2026-07-31", "1500"],
      ["2026-08-03", "1500"],
    ]);
  });

  it("rejects a non-positive close as a broken contract", () => {
    expect(() =>
      computeImpliedCcl([A], [close("aaa-adr", "2024-05-02", "0")]),
    ).toThrow(ImpliedCclError);
  });
});

describe("computeFxGap", () => {
  it("measures the gap only on days both series published", () => {
    expect(
      computeFxGap(
        [
          { periodOn: "2024-05-02", value: "1750" },
          { periodOn: "2024-05-03", value: "1800" },
        ],
        [{ periodOn: "2024-05-02", value: "1000" }],
      ),
    ).toEqual([{ marketDate: "2024-05-02", gap: "0.75" }]);
  });
});

describe("DECLARED_ADR_PAIRS", () => {
  it("declares each pair once, with its ratios in order", () => {
    const ids = DECLARED_ADR_PAIRS.map((entry) => entry.pairId);

    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of DECLARED_ADR_PAIRS) {
      const dates = entry.ratios.map((ratio) => ratio.validFrom);

      expect(dates).toEqual([...dates].sort());
    }
  });

  it("moves YPF from one to ten local shares at the 2026 split", () => {
    const ypf = DECLARED_ADR_PAIRS.find((entry) => entry.pairId === "ypf")!;

    expect(ratioOn(ypf, "2026-07-31")).toBe("1");
    expect(ratioOn(ypf, "2026-08-03")).toBe("10");
    expect(ratioOn(ypf, "1999-12-31")).toBeNull();
  });
});
