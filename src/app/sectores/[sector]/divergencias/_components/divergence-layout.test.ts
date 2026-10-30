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
