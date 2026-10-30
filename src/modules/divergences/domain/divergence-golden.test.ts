import { describe, expect, it } from "vitest";

import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import {
  syntheticFiler,
  type SyntheticYear,
} from "../infrastructure/synthetic-divergence-filer";

/**
 * Golden dataset of the divergence views (`F8-04`), reviewed by hand in
 * [docs/data/divergence-golden.md](../../../../docs/data/divergence-golden.md).
 *
 * Every expected number was computed **outside this code**, with Python's
 * `Decimal` at 50 digits: `years = days / 365.2425` and
 * `CAGR = ((latest / earlier) ^ (1 / years) − 1) × 100`. The test runs the same
 * chain the sector reading runs —fiscal closes, split basis, views, bridge— and
 * compares to eight decimals.
 */

const near = (actual: string | null, expected: string) => {
  expect(actual).not.toBeNull();
  expect(Math.abs(Number(actual) - Number(expected))).toBeLessThan(1e-8);
};

function year(
  fiscalYearEnd: string,
  values: Omit<SyntheticYear, "fiscalYearEnd" | "close"> & {
    readonly price: string | null;
    readonly closeOn?: string;
  },
): SyntheticYear {
  const { price, closeOn, ...rest } = values;
  return {
    fiscalYearEnd,
    close:
      price === null
        ? null
        : { marketDate: closeOn ?? fiscalYearEnd, value: price },
    ...rest,
  };
}

const EARLIER = "2023-12-31";
const LATEST = "2025-12-31";

describe("divergence golden dataset", () => {
  it("G1 recompras: el EPS crece más que el market cap y el rombo lo marca", () => {
    const run = syntheticFiler({
      years: [
        year(EARLIER, {
          price: "100",
          shares: "1000",
          diluted: "1000",
          netIncome: "5000",
          eps: "5",
        }),
        year(LATEST, {
          price: "121",
          shares: "900",
          diluted: "900",
          netIncome: "5400",
          eps: "6",
        }),
      ],
    });
    const { views, bridge } = run(2);

    near(views.years, "2.00141002");
    expect(views.marketCapBasis).toBe("shares_outstanding_at_close");
    expect(views.marketCap).toEqual({ earlier: "100000", latest: "108900" });
    near(views.growth.marketCap.value, "4.35202869");
    near(views.growth.dilutedEps.value, "9.53747633");
    near(views.growth.price.value, "9.99261404");
    near(views.growth.netIncome.value, "3.92023113");
    near(views.growth.dilutedShares.value, "-5.12814919");
    near(views.fundamental.gapPp, "5.18544764");
    near(views.fundamental.shareCountBiasPp, "5.64058534");
    near(views.fundamental.perShareGapPp, "-0.45513770");
    near(views.aggregate.gapPp, "-0.43179756");
    expect(views.fundamental.biasMarked).toBe(true);
    // 5400 / 6 = 900 diluted shares: the bridge closes at both ends.
    expect(bridge.latest?.reconciled).toBe(true);
    expect(bridge.earlier?.reconciled).toBe(true);
  });

  it("G2 dilución: el mismo precio con más acciones es un sesgo negativo", () => {
    const run = syntheticFiler({
      years: [
        year(EARLIER, {
          price: "100",
          shares: "1000",
          diluted: "1000",
          netIncome: "5000",
          eps: "5",
        }),
        year(LATEST, {
          price: "100",
          shares: "1100",
          diluted: "1100",
          netIncome: "6050",
          eps: "5.5",
        }),
      ],
    });
    const { views } = run(2);

    near(views.growth.marketCap.value, "4.87736364");
    near(views.growth.price.value, "0");
    near(views.fundamental.gapPp, "0");
    near(views.fundamental.shareCountBiasPp, "-4.87736364");
    near(views.fundamental.perShareGapPp, "4.87736364");
    near(views.aggregate.gapPp, "5.11525040");
    expect(views.fundamental.biasMarked).toBe(true);
  });

  it("G3 split 4:1 entre las puntas: se compara en la base nueva, no en la cruda", () => {
    const run = syntheticFiler({
      years: [
        // Raw: 200 × 250 shares and EPS 8, published before the split.
        year("2020-12-31", {
          price: "200",
          closeOn: "2020-12-30",
          shares: "250",
          diluted: "250",
          netIncome: "2000",
          eps: "8",
        }),
        year(EARLIER, {
          price: "55",
          shares: "1000",
          diluted: "1000",
          netIncome: "2600",
          eps: "2.6",
        }),
        year(LATEST, {
          price: "60",
          shares: "1000",
          diluted: "1000",
          netIncome: "3200",
          eps: "3.2",
        }),
      ],
      splits: [
        {
          ratio: "4",
          marketDate: "2022-01-10",
          secEffectiveOn: "2022-02-28",
          secAvailableAt: "2022-03-01T10:00:00.000Z",
        },
      ],
    });
    const { pair, views, bridge } = run(5);

    expect(pair.earlier?.splitBasis.adjustedPrice).toBe("50");
    expect(pair.earlier?.splitBasis.adjustedEps).toBe("2");
    expect(pair.earlier?.marketCap).toBe("50000");
    near(views.years, "4.99941819");
    near(views.growth.marketCap.value, "3.71416905");
    near(views.growth.dilutedEps.value, "9.85725609");
    near(views.growth.price.value, "3.71416905");
    near(views.growth.dilutedShares.value, "0");
    near(views.fundamental.gapPp, "6.14308704");
    near(views.fundamental.shareCountBiasPp, "0");
    expect(views.fundamental.biasMarked).toBe(false);
    // 2000 / 8 = 250 raw, 1000 on the new basis: still reconciled.
    expect(bridge.earlier?.reconciled).toBe(true);
  });

  it("G4 outlier: la tasa extrema se conserva exacta, sin recorte en el dominio", () => {
    const run = syntheticFiler({
      years: [
        year(EARLIER, {
          price: "20",
          shares: "1000",
          diluted: "1000",
          netIncome: "100",
          eps: "0.1",
        }),
        year(LATEST, {
          price: "30",
          shares: "1000",
          diluted: "1000",
          netIncome: "5000",
          eps: "5",
        }),
      ],
    });
    const { views } = run(2);

    near(views.growth.dilutedEps.value, "606.13303212");
    near(views.growth.marketCap.value, "22.45699560");
    near(views.fundamental.gapPp, "583.67603651");
  });

  it("G5 respaldo: sin acciones al cierre, market cap con diluidas en las dos puntas", () => {
    const run = syntheticFiler({
      years: [
        year(EARLIER, {
          price: "40",
          shares: null,
          diluted: "1050",
          netIncome: "4200",
          eps: "4",
        }),
        year(LATEST, {
          price: "44",
          shares: null,
          diluted: "1000",
          netIncome: "4600",
          eps: "4.6",
        }),
      ],
    });
    const { views } = run(2);

    expect(views.marketCapBasis).toBe("weighted_diluted_shares");
    expect(views.marketCap).toEqual({ earlier: "42000", latest: "44000" });
    near(views.growth.marketCap.value, "2.35158589");
    near(views.growth.dilutedEps.value, "7.23277352");
    near(views.fundamental.gapPp, "4.88118762");
    near(views.fundamental.shareCountBiasPp, "2.52577774");
    near(views.aggregate.gapPp, "2.29868418");
    expect(views.fundamental.biasMarked).toBe(true);
  });

  it("G6 pérdidas: una punta no positiva es una categoría, nunca una tasa", () => {
    const losses = (earlierEps: string, latestEps: string) =>
      syntheticFiler({
        years: [
          year(EARLIER, {
            price: "10",
            shares: "1000",
            diluted: "1000",
            netIncome: String(Number(earlierEps) * 1000),
            eps: earlierEps,
          }),
          year(LATEST, {
            price: "12",
            shares: "1000",
            diluted: "1000",
            netIncome: String(Number(latestEps) * 1000),
            eps: latestEps,
          }),
        ],
      })(2).views;

    const cases = [
      ["-1", "2", "earnings_turned_positive"],
      ["1", "-2", "earnings_turned_non_positive"],
      ["-1", "-2", "earnings_non_positive"],
      ["0", "2", "earnings_turned_positive"],
    ] as const;
    for (const [from, to, category] of cases) {
      const views = losses(from, to);
      expect(views.fundamental.category).toBe(category);
      expect(views.fundamental.gapPp).toBeNull();
      expect(views.aggregate.category).toBe(category);
      expect(views.perShare.category).toBe(category);
      // The market side still has its rate: only earnings lack one.
      near(views.growth.marketCap.value, "9.53747633");
    }
  });

  it("G7 tolerancia de precio: siete días antes del cierre vale, ocho no", () => {
    const at = (closeOn: string) =>
      syntheticFiler({
        years: [
          year(EARLIER, {
            price: "100",
            shares: "1000",
            diluted: "1000",
            netIncome: "5000",
            eps: "5",
          }),
          year(LATEST, {
            price: "121",
            closeOn,
            shares: "900",
            diluted: "900",
            netIncome: "5400",
            eps: "6",
          }),
        ],
      })(2);

    const seven = at("2025-12-24");
    expect(seven.pair.latest?.priceLagDays).toBe(7);
    near(seven.views.fundamental.gapPp, "5.18544764");

    const eight = at("2025-12-23");
    expect(eight.pair.latest?.price).toBeNull();
    expect(eight.pair.latest?.missing).toContain("price_near_fiscal_close");
    expect(eight.views.fundamental.category).toBe("unavailable");
  });

  it("G8 restatement: lo publicado después del corte no entra; antes, sí", () => {
    const filer = (availableAt: string) =>
      syntheticFiler({
        years: [
          year(EARLIER, {
            price: "100",
            shares: "1000",
            diluted: "1000",
            netIncome: "5000",
            eps: "5",
          }),
          year(LATEST, {
            price: "121",
            shares: "900",
            diluted: "900",
            netIncome: "5400",
            eps: "6",
            epsRevisions: [{ value: "6.6", availableAt }],
          }),
        ],
      })(2);

    // Accepted after the 2026-03-01 cutoff: the original 6 stands.
    const later = filer("2026-04-15T10:00:00.000Z");
    expect(later.pair.latest?.dilutedEps?.value).toBe("6");
    near(later.views.fundamental.gapPp, "5.18544764");

    // Accepted before it: the revision is what was known.
    const known = filer("2026-02-20T10:00:00.000Z");
    expect(known.pair.latest?.dilutedEps?.value).toBe("6.6");
  });

  it("G9 sin look-ahead: un corte anterior al 10-K no ve el último ejercicio", () => {
    const run = syntheticFiler({
      years: [
        year("2022-12-31", {
          price: "90",
          shares: "1000",
          diluted: "1000",
          netIncome: "4000",
          eps: "4",
        }),
        year(EARLIER, {
          price: "100",
          shares: "1000",
          diluted: "1000",
          netIncome: "5000",
          eps: "5",
        }),
        year(LATEST, {
          price: "121",
          shares: "900",
          diluted: "900",
          netIncome: "5400",
          eps: "6",
        }),
      ],
      query: pointInTimeQuerySchema.parse({
        effectiveAt: "2025-06-30T00:00:00.000Z",
        revisionPolicy: "as_known",
        knownAt: "2025-06-30T00:00:00.000Z",
        sourcePolicyVersion: "source-policy-1.0.0",
      }),
    });
    const { pair } = run(2);

    // At mid-2025 the latest fiscal close is 2023, and its pair is 2021: none.
    expect(pair.latest?.fiscalYearEnd).toBe(EARLIER);
    expect(pair.earlier).toBeNull();
    expect(pair.reason).toBe("no_comparable_year");
  });
});
