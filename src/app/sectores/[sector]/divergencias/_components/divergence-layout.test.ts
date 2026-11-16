import { describe, expect, it } from "vitest";

import type { SectorDivergenceRow } from "@/modules/divergences/application/sector-divergence-matrix";
import { computeDilutionBridge } from "@/modules/divergences/domain/dilution-bridge";
import { computeDivergenceViews } from "@/modules/divergences/domain/divergence-views";
import {
  FISCAL_ENDPOINTS_VERSION,
  type FiscalEndpoint,
  type FiscalEndpointPair,
} from "@/modules/divergences/domain/fiscal-endpoints";
import { FISCAL_SPLIT_BASIS_VERSION } from "@/modules/divergences/domain/fiscal-split-basis";

import {
  describeDivergencePoint,
  hasHorizonData,
  withoutIsolatedExtremes,
  filterDivergenceRows,
  filtersActive,
  NO_FILTERS,
  formatPp,
  layoutDivergence,
  unavailableReason,
} from "./divergence-layout";

function point(
  end: string,
  price: string,
  eps: string,
  shares: string | null,
  missing: readonly string[] = [],
): FiscalEndpoint {
  return {
    fiscalYearEnd: end,
    price: { currency: "USD" } as FiscalEndpoint["price"],
    priceLagDays: 0,
    netIncome: { value: "1000" } as FiscalEndpoint["netIncome"],
    dilutedEps: null,
    dilutedShares: {
      unit: "shares",
      currency: null,
    } as FiscalEndpoint["dilutedShares"],
    sharesOutstanding: null,
    basicShares: null,
    dilutedNumerator: null,
    splitBasis: {
      version: FISCAL_SPLIT_BASIS_VERSION,
      priceFactor: "1",
      actionIds: [],
      adjustedPrice: price,
      adjustedEps: eps,
      adjustedDilutedShares: "100",
      adjustedSharesOutstanding: shares,
      adjustedBasicShares: null,
      reason: null,
    },
    marketCap: shares === null ? null : String(Number(price) * Number(shares)),
    missing,
  };
}

function row(
  id: string,
  earlier: FiscalEndpoint | null,
  latest: FiscalEndpoint | null,
): SectorDivergenceRow {
  const pair: FiscalEndpointPair = {
    version: FISCAL_ENDPOINTS_VERSION,
    horizonYears: 2,
    actualYears: null,
    latest,
    earlier,
    reason: earlier === null ? "no_comparable_year" : null,
  };
  const views = computeDivergenceViews(pair);
  const horizon = {
    earlierFiscalYearEnd: earlier?.fiscalYearEnd ?? null,
    latestFiscalYearEnd: latest?.fiscalYearEnd ?? null,
    pairReason: pair.reason,
    missing: [...(latest?.missing ?? []), ...(earlier?.missing ?? [])],
    views,
    bridge: computeDilutionBridge(pair, views),
  };
  return {
    securityId: id,
    issuerLegalEntityId: `${id}-issuer`,
    ticker: id,
    issuerName: `${id} Inc.`,
    cedear: id === "AAA",
    twoYears: horizon,
    fiveYears: horizon,
  };
}

const rows = [
  row(
    "AAA",
    point("2023-12-31", "100", "5", "100"),
    point("2025-12-31", "121", "7.2", "90"),
  ),
  row(
    "BBB",
    point("2023-12-31", "50", "2", "100"),
    point("2025-12-31", "40", "3", "100"),
  ),
  row(
    "CCC",
    point("2023-12-31", "50", "-1", "100"),
    point("2025-12-31", "60", "1", "100"),
  ),
  row("DDD", null, point("2025-12-31", "60", "1", "100")),
];

describe("divergence layout", () => {
  it("draws only comparable points on one shared domain with the diagonal", () => {
    const layout = layoutDivergence(rows, "twoYears", "fundamental");

    expect(layout.points.map((p) => p.id)).toEqual(["AAA", "BBB"]);
    expect(layout.domainX).toEqual(layout.domainY);
    expect(layout.diagonal[0]).toEqual({
      x: layout.domainX[0],
      y: layout.domainX[0],
    });
    expect(layout.points[0]?.cedear).toBe(true);
    // The exact decimal travels with the point, never the coordinate.
    expect(layout.points[0]?.rawY).toBe(
      rows[0]!.twoYears.views.growth.dilutedEps.value,
    );
  });

  it("always includes zero in the domain", () => {
    const layout = layoutDivergence(rows.slice(0, 1), "twoYears", "perShare");

    expect(layout.domainX[0]).toBeLessThanOrEqual(0);
  });

  it("names why a point is not drawn", () => {
    expect(
      unavailableReason(rows[3]!.twoYears, rows[3]!.twoYears.views.fundamental),
    ).toBe("Sin ejercicio comparable");
    const withMissing = row(
      "EEE",
      point("2023-12-31", "50", "2", null, ["shares_outstanding_at_close"]),
      point("2025-12-31", "40", "3", null, ["shares_outstanding_at_close"]),
    );
    expect(
      unavailableReason(
        withMissing.twoYears,
        withMissing.twoYears.views.aggregate,
      ),
    ).toBe("Sin acciones al cierre");
  });

  it("describes a point with its gap and bias for assistive technology", () => {
    const text = describeDivergencePoint(rows[0]!, "twoYears", "fundamental");

    expect(text).toContain("AAA, AAA Inc.");
    expect(text).toContain("sesgo por acciones");
    expect(text).toContain("supera la tolerancia");
    expect(text).toContain("con CEDEAR");
  });

  it("keeps a row in the table only if this horizon has something to show", () => {
    expect(hasHorizonData(rows[0]!, "twoYears")).toBe(true);
    // Pérdida en una punta: la categoría se muestra en la tabla.
    expect(hasHorizonData(rows[2]!, "twoYears")).toBe(true);
    const empty = row("ZZZ", null, null);
    expect(hasHorizonData(empty, "twoYears")).toBe(false);
  });

  it("formats percentage points with an explicit sign", () => {
    expect(formatPp("10.15")).toBe("+10,2");
    expect(formatPp("-3.26")).toBe("-3,3");
    expect(formatPp(null)).toBe("—");
  });
});

/** Una fila con el tamaño y el puente que un filtro decide, en las dos puntas. */
function sized(
  base: SectorDivergenceRow,
  latest: string | null,
  reconciled: readonly [boolean | null, boolean | null],
): SectorDivergenceRow {
  const data = base.twoYears;
  const endpoint = (value: boolean | null) =>
    data.bridge.latest === null
      ? null
      : { ...data.bridge.latest, reconciled: value };
  const horizon = {
    ...data,
    views: { ...data.views, marketCap: { earlier: latest, latest } },
    bridge: {
      ...data.bridge,
      earlier: endpoint(reconciled[0]),
      latest: endpoint(reconciled[1]),
    },
  };
  return { ...base, twoYears: horizon, fiveYears: horizon };
}

describe("divergence filters", () => {
  const sample = [
    sized(rows[0]!, "250000000000", [true, true]),
    sized(rows[1]!, "12000000000", [true, false]),
    sized(rows[2]!, null, [true, true]),
  ];
  const ids = (filtered: readonly SectorDivergenceRow[]) =>
    filtered.map((row) => row.securityId);

  it("sin filtros deja todo", () => {
    expect(filtersActive(NO_FILTERS)).toBe(false);
    expect(ids(filterDivergenceRows(sample, "twoYears", NO_FILTERS))).toEqual([
      "AAA",
      "BBB",
      "CCC",
    ]);
  });

  it("CEDEAR deja sólo las securities con programa vigente", () => {
    expect(
      ids(
        filterDivergenceRows(sample, "twoYears", {
          ...NO_FILTERS,
          cedearOnly: true,
        }),
      ),
    ).toEqual(["AAA"]);
  });

  it("un umbral de tamaño deja afuera a quien no tiene market cap", () => {
    const at = (floor: "10b" | "50b" | "200b") =>
      ids(
        filterDivergenceRows(sample, "twoYears", {
          ...NO_FILTERS,
          marketCapFloor: floor,
        }),
      );
    expect(at("10b")).toEqual(["AAA", "BBB"]);
    expect(at("50b")).toEqual(["AAA"]);
    expect(at("200b")).toEqual(["AAA"]);
  });

  it("el umbral es inclusivo en el borde", () => {
    const edge = [sized(rows[0]!, "50000000000", [true, true])];
    expect(
      ids(
        filterDivergenceRows(edge, "twoYears", {
          ...NO_FILTERS,
          marketCapFloor: "50b",
        }),
      ),
    ).toEqual(["AAA"]);
  });

  it("conciliado exige las dos puntas; un puente sin evaluar no concilia", () => {
    const pending = [...sample, sized(rows[0]!, "1", [null, true])];
    expect(
      ids(
        filterDivergenceRows(pending, "twoYears", {
          ...NO_FILTERS,
          reconciledOnly: true,
        }),
      ),
    ).toEqual(["AAA", "CCC"]);
  });

  it("los filtros se combinan con «y»", () => {
    expect(
      ids(
        filterDivergenceRows(sample, "twoYears", {
          cedearOnly: true,
          marketCapFloor: "10b",
          reconciledOnly: true,
        }),
      ),
    ).toEqual(["AAA"]);
  });
});

describe("withoutIsolatedExtremes", () => {
  it("drops a lone extreme that a robust domain cannot cut with four points", () => {
    // MU a +900 % y otros tres entre 20 y 50: el IQR se estira hasta el extremo.
    expect(withoutIsolatedExtremes([900, 20, 30, 50], [0])).toEqual([
      20, 30, 50,
    ]);
  });

  it("drops a lone extreme below zero too", () => {
    expect(withoutIsolatedExtremes([-500, 10, 20, 30], [0])).toEqual([
      10, 20, 30,
    ]);
  });

  it("keeps a spread without isolated extremes", () => {
    expect(withoutIsolatedExtremes([-10, 5, 20, 40, 60], [0])).toEqual([
      -10, 5, 20, 40, 60,
    ]);
  });

  it("measures the gap against what the domain always includes", () => {
    // 80 está a 70 del 10; con el cero adentro el resto mide 10: sale.
    expect(withoutIsolatedExtremes([8, 10, 9, 80], [0])).toEqual([8, 9, 10]);
    // 25 está a 15 del 10 y el resto, con el cero, mide 10: también sale.
    expect(withoutIsolatedExtremes([8, 10, 9, 25], [0])).toEqual([8, 9, 10]);
    // 18 está a 8 del 10 y el resto mide 10: se queda.
    expect(withoutIsolatedExtremes([8, 10, 9, 18], [0])).toEqual([
      8, 9, 10, 18,
    ]);
  });

  it("never drops more than one point in four, nor with fewer than three", () => {
    expect(withoutIsolatedExtremes([1, 1000], [0])).toEqual([1, 1000]);
    expect(withoutIsolatedExtremes([1, 2, 1000], [0])).toEqual([1, 2]);
    expect(
      withoutIsolatedExtremes([1, 2, 3, 4, 5, 6, 7, 8, 500, 5000], [0]),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("does not trim when every rest span is zero or the input is not finite", () => {
    expect(withoutIsolatedExtremes([5, 5, 5])).toEqual([5, 5, 5]);
    expect(withoutIsolatedExtremes([Number.NaN, 1, 2, 3], [0])).toEqual([
      1, 2, 3,
    ]);
    expect(withoutIsolatedExtremes([])).toEqual([]);
  });

  it("clips the outlier to the edge of a domain with round ticks", () => {
    const outlier = row(
      "MU",
      point("2023-12-31", "10", "0.1", "100"),
      point("2025-12-31", "100", "10", "100"),
    );
    const layout = layoutDivergence(
      [...rows.slice(0, 2), outlier],
      "twoYears",
      "fundamental",
    );
    const mu = layout.points.find((p) => p.id === "MU")!;

    expect(Number(mu.rawY)).toBeGreaterThan(800);
    expect(mu.clipY).toBe(1);
    expect(mu.y).toBe(layout.domainY[1]);
    expect(layout.domainY[1]).toBeLessThan(200);
    const step = layout.ticksY[1]! - layout.ticksY[0]!;
    expect([1, 2, 5, 10, 20, 25, 50, 100]).toContain(step);
  });
});
