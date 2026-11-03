import { describe, expect, it } from "vitest";

import {
  argentinaIndicatorSchema,
  fiscalShareOfGdp,
  readIndicatorVintages,
  seasonallyAdjustedMonthlyChange,
  tradeBalance,
  type ArgentinaIndicator,
  type ArgentinaIndicatorVintage,
} from "./argentina-indicator";

function indicator(
  overrides: Partial<ArgentinaIndicator> = {},
): ArgentinaIndicator {
  return argentinaIndicatorSchema.parse({
    id: "fiscal_primary",
    externalId: "synthetic-primary",
    block: "fiscal",
    frequency: "monthly",
    unit: "millions",
    currency: "ARS",
    seasonalAdjustment: "original",
    priceBasis: "current",
    indexBase: null,
    reportingScope: "national",
    sourceId: "synthetic",
    sourceUrl: "https://example.org/series",
    segment: "base-1",
    methodology: "Synthetic test series",
    ...overrides,
  });
}

function point(
  indicatorId: string,
  periodOn: string,
  value: string | null,
  overrides: Partial<ArgentinaIndicatorVintage> = {},
): ArgentinaIndicatorVintage {
  return {
    indicatorId,
    periodOn,
    value,
    availableAt: "2026-02-01T12:00:00Z",
    recordedAt: "2026-02-02T12:00:00Z",
    revision: 0,
    segment: "base-1",
    sourceRunId: "run-1",
    ...overrides,
  };
}

describe("Argentina indicator vintages", () => {
  it("keeps a later revision out of an earlier public and system reading", () => {
    const series = indicator();
    const first = point(series.id, "2026-01-01", "10");
    const revised = point(series.id, "2026-01-01", "12", {
      availableAt: "2026-03-01T12:00:00Z",
      recordedAt: "2026-03-02T12:00:00Z",
      revision: 1,
      sourceRunId: "run-2",
    });
    const query = {
      effectiveOn: "2026-01-31",
      knownAt: "2026-03-01T12:00:00Z",
      knowledgeBasis: "system_recorded" as const,
    };
    expect(readIndicatorVintages(series, [revised, first], query)).toEqual([
      first,
    ]);
    expect(
      readIndicatorVintages(series, [revised, first], {
        ...query,
        knowledgeBasis: "public_availability",
      }),
    ).toEqual([revised]);
  });

  it("rejects two vintages with the same revision", () => {
    const series = indicator();
    const first = point(series.id, "2026-01-01", "10");
    expect(() =>
      readIndicatorVintages(series, [first, first], {
        effectiveOn: "2026-01-31",
        knownAt: "2026-04-01T00:00:00Z",
        knowledgeBasis: "public_availability",
      }),
    ).toThrow("revision_chain_conflict");
  });
});

describe("compatible macro calculations", () => {
  it("sums a complete fiscal year against nominal GDP of that year", () => {
    const fiscal = indicator();
    const gdp = indicator({ id: "gdp", frequency: "annual" });
    const monthlyFiscal = Array.from({ length: 12 }, (_, index) =>
      point(fiscal.id, `2025-${String(index + 1).padStart(2, "0")}-01`, "-1"),
    );
    const input = {
      fiscal,
      monthlyFiscal,
      gdp,
      annualGdp: point(gdp.id, "2025-01-01", "120"),
      year: 2025,
    };
    expect(fiscalShareOfGdp(input)).toMatchObject({
      status: "computed",
      value: "-10",
    });
    expect(
      fiscalShareOfGdp({ ...input, monthlyFiscal: monthlyFiscal.slice(1) }),
    ).toEqual({ status: "unavailable", reason: "incompatible_period" });
    expect(
      fiscalShareOfGdp({
        ...input,
        annualGdp: point(gdp.id, "2024-01-01", "120"),
      }),
    ).toEqual({ status: "unavailable", reason: "incompatible_period" });
    expect(
      fiscalShareOfGdp({
        ...input,
        gdp: indicator({ ...gdp, currency: "USD" }),
      }),
    ).toEqual({ status: "unavailable", reason: "incompatible_currency" });
    expect(
      fiscalShareOfGdp({
        ...input,
        gdp: indicator({ ...gdp, priceBasis: "constant" }),
      }),
    ).toEqual({ status: "unavailable", reason: "incompatible_basis" });
    expect(
      fiscalShareOfGdp({
        ...input,
        fiscal: indicator({ ...fiscal, currency: "index" }),
        gdp: indicator({ ...gdp, currency: "index" }),
      }),
    ).toEqual({ status: "unavailable", reason: "incompatible_basis" });
    expect(
      fiscalShareOfGdp({
        ...input,
        annualGdp: point(gdp.id, "2025-01-01", "0"),
      }),
    ).toEqual({ status: "unavailable", reason: "zero_denominator" });
    expect(
      fiscalShareOfGdp({
        ...input,
        annualGdp: point(gdp.id, "2025-01-01", "NaN"),
      }),
    ).toEqual({ status: "unavailable", reason: "non_finite" });
    expect(fiscalShareOfGdp({ ...input, annualGdp: null })).toEqual({
      status: "unavailable",
      reason: "incompatible_period",
    });
  });

  it("keeps source-adjusted activity separate across gaps and base breaks", () => {
    const activity = indicator({
      id: "emae_sa",
      block: "activity",
      seasonalAdjustment: "seasonally_adjusted",
      priceBasis: "constant",
      currency: "index",
      indexBase: "2004=100",
    });
    const previous = point(activity.id, "2025-12-01", "100");
    const current = point(activity.id, "2026-01-01", "105");
    expect(
      seasonallyAdjustedMonthlyChange({
        indicator: activity,
        previous,
        current,
      }),
    ).toMatchObject({ status: "computed", value: "5" });
    expect(
      seasonallyAdjustedMonthlyChange({
        indicator: { ...activity, seasonalAdjustment: "original" },
        previous,
        current,
      }),
    ).toEqual({ status: "unavailable", reason: "incompatible_basis" });
    expect(
      seasonallyAdjustedMonthlyChange({
        indicator: activity,
        previous: { ...previous, segment: "old-base" },
        current,
      }),
    ).toEqual({ status: "unavailable", reason: "incompatible_period" });
    expect(
      seasonallyAdjustedMonthlyChange({
        indicator: activity,
        previous: { ...previous, value: "0" },
        current,
      }),
    ).toEqual({ status: "unavailable", reason: "zero_denominator" });
    expect(
      seasonallyAdjustedMonthlyChange({
        indicator: activity,
        previous: { ...previous, value: null },
        current,
      }),
    ).toEqual({ status: "unavailable", reason: "missing_value" });
  });

  it("subtracts only matching trade flows and retains negative balances", () => {
    const exports = indicator({
      id: "exports",
      block: "external",
      currency: "USD",
    });
    const imports = indicator({
      id: "imports",
      block: "external",
      currency: "USD",
    });
    const exportPoint = point(exports.id, "2026-01-01", "8");
    const importPoint = point(imports.id, "2026-01-01", "10");
    const input = { exports, imports, exportPoint, importPoint };
    expect(tradeBalance(input)).toMatchObject({
      status: "computed",
      value: "-2",
    });
    expect(
      tradeBalance({ ...input, imports: { ...imports, currency: "ARS" } }),
    ).toEqual({ status: "unavailable", reason: "incompatible_currency" });
    expect(
      tradeBalance({
        ...input,
        importPoint: { ...importPoint, periodOn: "2026-02-01" },
      }),
    ).toEqual({ status: "unavailable", reason: "incompatible_period" });
    expect(
      tradeBalance({ ...input, importPoint: { ...importPoint, value: null } }),
    ).toEqual({ status: "unavailable", reason: "missing_value" });
    expect(
      tradeBalance({
        ...input,
        imports: { ...imports, seasonalAdjustment: "seasonally_adjusted" },
      }),
    ).toEqual({ status: "unavailable", reason: "incompatible_basis" });
  });
});
