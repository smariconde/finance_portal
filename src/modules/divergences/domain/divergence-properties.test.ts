import { describe, expect, it } from "vitest";

import {
  syntheticFiler,
  type SyntheticSplit,
  type SyntheticYear,
} from "../infrastructure/synthetic-divergence-filer";

/**
 * Properties of the divergence views (`F8-04`) over generated filers. No
 * property-testing dependency: a seeded generator in the file, so a failure
 * names its seed and case and replays exactly.
 */

const SEED = 0x5eed_f804;
const RUNS = 150;

/** mulberry32: small, deterministic, good enough to spread cases. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** A positive decimal with up to `scale` places, never zero. */
    positive(min: number, max: number, scale = 2) {
      const value = min + next() * (max - min);
      return Math.max(value, 10 ** -scale).toFixed(scale);
    },
    pick<T>(values: readonly T[]): T {
      return values[Math.floor(next() * values.length)]!;
    },
    chance(p: number) {
      return next() < p;
    },
  };
}

type Endpoint = {
  readonly price: string;
  readonly shares: string;
  readonly eps: string;
};

/**
 * A filer whose EPS is its net income over its diluted shares, so the bridge
 * has something true to check.
 */
function filerYears(earlier: Endpoint, latest: Endpoint): SyntheticYear[] {
  const one = (fiscalYearEnd: string, point: Endpoint): SyntheticYear => ({
    fiscalYearEnd,
    close: { marketDate: fiscalYearEnd, value: point.price },
    shares: point.shares,
    diluted: point.shares,
    netIncome: (Number(point.eps) * Number(point.shares)).toFixed(4),
    eps: point.eps,
  });
  return [one("2023-12-31", earlier), one("2025-12-31", latest)];
}

function randomEndpoint(random: ReturnType<typeof generator>): Endpoint {
  return {
    price: random.positive(1, 2000),
    shares: random.positive(1_000, 5_000_000, 0),
    eps: random.positive(0.01, 40),
  };
}

const close = (a: string | null, b: string | null, tolerance = 1e-8) => {
  expect(a === null).toBe(b === null);
  if (a !== null && b !== null)
    expect(Math.abs(Number(a) - Number(b))).toBeLessThan(
      tolerance * Math.max(1, Math.abs(Number(b))),
    );
};

describe("divergence properties", () => {
  it("las identidades son exactas: brecha = y − x, brecha = por acción + sesgo", () => {
    const random = generator(SEED);
    for (let run = 0; run < RUNS; run += 1) {
      const { views, bridge } = syntheticFiler({
        years: filerYears(randomEndpoint(random), randomEndpoint(random)),
      })(2);
      const { fundamental, growth } = views;

      // Exact decimals: the identities hold digit for digit, not "close".
      const exact = (a: string, b: string, c: string) =>
        expect(Number(a)).toBeCloseTo(Number(b) - Number(c), 9);
      exact(
        fundamental.gapPp!,
        growth.dilutedEps.value!,
        growth.marketCap.value!,
      );
      exact(
        fundamental.shareCountBiasPp!,
        growth.price.value!,
        growth.marketCap.value!,
      );
      exact(
        fundamental.gapPp!,
        Number(fundamental.perShareGapPp!) +
          Number(fundamental.shareCountBiasPp!) +
          "",
        "0",
      );
      exact(
        bridge.viewGapDifferencePp!,
        bridge.earningsShareEffectPp!,
        bridge.valueShareEffectPp!,
      );
      expect(fundamental.biasMarked).toBe(
        Math.abs(Number(fundamental.shareCountBiasPp)) > 2,
      );
    }
  });

  it("un split confirmado entre las puntas no mueve ninguna tasa", () => {
    const random = generator(SEED + 1);
    for (let run = 0; run < RUNS; run += 1) {
      const earlier = randomEndpoint(random);
      const latest = randomEndpoint(random);
      const ratio = random.pick(["2", "3", "4", "5", "10", "20"]);
      const k = Number(ratio);
      // The same company seen raw before a k:1 split: price and EPS × k,
      // shares ÷ k. Shares stay integral so the raw filing is plausible.
      const shares = String(Number(earlier.shares) * k);
      const adjusted = { ...earlier, shares };
      const raw: Endpoint = {
        price: String(Number(earlier.price) * k),
        shares: earlier.shares,
        eps: String(Number(earlier.eps) * k),
      };
      const split: SyntheticSplit = {
        ratio,
        marketDate: "2024-06-10",
        secEffectiveOn: "2024-06-30",
        secAvailableAt: "2024-08-01T10:00:00.000Z",
      };
      const control = syntheticFiler({
        years: filerYears(adjusted, latest),
      })(2).views;
      const splitRun = syntheticFiler({
        years: filerYears(raw, latest),
        splits: [split],
      })(2).views;

      expect(splitRun.fundamental.category).toBe(control.fundamental.category);
      for (const key of [
        "marketCap",
        "dilutedEps",
        "price",
        "dilutedShares",
        "netIncome",
      ] as const)
        close(splitRun.growth[key].value, control.growth[key].value);
      close(splitRun.fundamental.gapPp, control.fundamental.gapPp);
      close(
        splitRun.fundamental.shareCountBiasPp,
        control.fundamental.shareCountBiasPp,
      );
    }
  });

  it("un split sin confirmación de la SEC no se ajusta: queda sin tasa por acción", () => {
    const random = generator(SEED + 2);
    for (let run = 0; run < 40; run += 1) {
      const earlier = randomEndpoint(random);
      const raw: Endpoint = {
        ...earlier,
        price: String(Number(earlier.price) * 4),
        eps: String(Number(earlier.eps) * 4),
      };
      const { views } = syntheticFiler({
        years: filerYears(raw, randomEndpoint(random)),
        splits: [
          {
            ratio: "4",
            marketDate: "2024-06-10",
            // The SEC never confirmed it before the cutoff.
            secEffectiveOn: "2024-06-30",
            secAvailableAt: "2026-06-01T10:00:00.000Z",
          },
        ],
      })(2);

      expect(views.growth.price.value).toBeNull();
      expect(views.growth.dilutedEps.value).toBeNull();
      expect(views.fundamental.gapPp).toBeNull();
    }
  });

  it("escalar los beneficios no mueve sus tasas; la unidad no es crecimiento", () => {
    const random = generator(SEED + 3);
    for (let run = 0; run < RUNS; run += 1) {
      const earlier = randomEndpoint(random);
      const latest = randomEndpoint(random);
      const c = Number(random.pick(["0.001", "0.5", "3", "1000"]));
      const scaled = (point: Endpoint): Endpoint => ({
        ...point,
        eps: String(Number(point.eps) * c),
      });
      const base = syntheticFiler({ years: filerYears(earlier, latest) })(2);
      const other = syntheticFiler({
        years: filerYears(scaled(earlier), scaled(latest)),
      })(2);

      close(
        other.views.growth.dilutedEps.value,
        base.views.growth.dilutedEps.value,
        1e-6,
      );
      close(
        other.views.growth.netIncome.value,
        base.views.growth.netIncome.value,
        1e-6,
      );
      close(
        other.views.growth.marketCap.value,
        base.views.growth.marketCap.value,
      );
    }
  });

  it("un beneficio no positivo en una punta nunca da una tasa ni un cero", () => {
    const random = generator(SEED + 4);
    for (let run = 0; run < RUNS; run += 1) {
      const earlier = randomEndpoint(random);
      const latest = randomEndpoint(random);
      const sign = (point: Endpoint): Endpoint =>
        random.chance(0.5)
          ? point
          : {
              ...point,
              eps: random.chance(0.2) ? "0" : `-${point.eps}`,
            };
      const a = sign(earlier);
      const b = sign(latest);
      const { views } = syntheticFiler({ years: filerYears(a, b) })(2);
      const positive = Number(a.eps) > 0 && Number(b.eps) > 0;

      if (positive) {
        expect(views.fundamental.category).toBe("comparable");
        continue;
      }
      expect(views.fundamental.category).not.toBe("comparable");
      expect(views.fundamental.gapPp).toBeNull();
      expect(views.growth.dilutedEps.value).toBeNull();
      expect(views.growth.dilutedEps.reason).toBe("non_positive_endpoint");
      // The market side never depends on earnings.
      expect(views.growth.marketCap.value).not.toBeNull();
    }
  });

  it("una revisión publicada después del corte nunca cambia el resultado", () => {
    const random = generator(SEED + 5);
    for (let run = 0; run < RUNS; run += 1) {
      const years = filerYears(randomEndpoint(random), randomEndpoint(random));
      const base = syntheticFiler({ years })(2).views;
      const revised = syntheticFiler({
        years: years.map((year) => ({
          ...year,
          epsRevisions: [
            {
              value: random.positive(0.01, 80),
              availableAt: random.pick([
                "2026-03-01T00:00:00.001Z",
                "2026-05-01T10:00:00.000Z",
                "2030-01-01T00:00:00.000Z",
              ]),
            },
          ],
        })),
      })(2).views;

      expect(revised).toEqual(base);
    }
  });

  it("las tasas extremas son finitas, canónicas y del signo de su razón", () => {
    const random = generator(SEED + 6);
    for (let run = 0; run < RUNS; run += 1) {
      const factor = random.pick(["0.000001", "0.001", "1", "1000", "1000000"]);
      const earlier = randomEndpoint(random);
      const latest = {
        ...earlier,
        // Plain decimal text, as the SEC prints it: never an exponent.
        eps: (Number(earlier.eps) * Number(factor))
          .toFixed(14)
          .replace(/0+$/u, "")
          .replace(/\.$/u, ""),
      };
      const { views } = syntheticFiler({ years: filerYears(earlier, latest) })(
        2,
      );
      const rate = views.growth.dilutedEps.value;

      expect(rate).not.toBeNull();
      expect(rate).toMatch(/^-?\d+(\.\d+)?$/u);
      expect(Number.isFinite(Number(rate))).toBe(true);
      // A CAGR never falls to −100 % or below while both ends are positive.
      expect(Number(rate)).toBeGreaterThan(-100);
      const ratio = Number(latest.eps) / Number(earlier.eps);
      if (ratio > 1 + 1e-9) expect(Number(rate)).toBeGreaterThan(0);
      if (ratio < 1 - 1e-9) expect(Number(rate)).toBeLessThan(0);
    }
  });
});
