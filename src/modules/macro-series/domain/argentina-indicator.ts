import { z } from "zod";

import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

/** Contract for the declared activity, fiscal and external series (F9-04). */
/**
 * `1.1.0` adds the year-over-year change of an original series (`F9-06`); the
 * three earlier readings are unchanged.
 */
export const ARGENTINA_INDICATOR_VERSION = "argentina-indicator-1.1.0";

const finiteDecimalSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u);

/**
 * INDEC's conventional signs (Catálogo API-INDEC, «Razón de nulo y signos
 * convencionales»). A sign travels with its point: it says why a value is
 * missing or how firm a published one is.
 */
export const INDEC_CONVENTIONAL_SIGNS = [
  "*",
  "**",
  "e",
  "i",
  "u",
  "-",
  ".",
  "...",
  "///",
  "s",
] as const;

export const indecConventionalSignSchema = z.enum(INDEC_CONVENTIONAL_SIGNS);

export type IndecConventionalSign = z.infer<typeof indecConventionalSignSchema>;

export const argentinaIndicatorSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/u),
  externalId: z.string().min(1),
  /** `agro` and `daily` carry the soy series (ADR 0071). */
  block: z.enum([
    "activity",
    "fiscal",
    "external",
    "agro",
    "prices",
    "living_cost",
    "wages",
  ]),
  frequency: z.enum(["daily", "monthly", "quarterly", "annual"]),
  /** The unit as the source prints it; the parser checks it on every page. */
  unit: z.string().min(1),
  /** Magnitude behind the unit, so two sources' wordings compare. */
  scale: z.enum(["unit", "thousand", "million"]).nullable(),
  /** The unit's numerator currency: «US cents/bushel» is `USD`, «ARS/USD» is `ARS`. */
  currency: z.enum(["ARS", "USD", "index", "percent", "physical"]),
  seasonalAdjustment: z.enum([
    "original",
    "seasonally_adjusted",
    "trend_cycle",
  ]),
  priceBasis: z.enum(["current", "constant", "not_applicable"]),
  indexBase: z.string().nullable(),
  reportingScope: z.string().min(1),
  sourceId: z.string().min(1),
  /**
   * Column values that pick this series out of a multi-series service. Each
   * is sent as a filter and checked on every row; empty for a single series.
   */
  filters: z.record(z.string().min(1), z.string().min(1)),
  sourceUrl: z.url(),
  /** A new basis or methodology opens another segment. */
  segment: z.string().min(1),
  methodology: z.string().min(1),
});

export type ArgentinaIndicator = z.infer<typeof argentinaIndicatorSchema>;

export const argentinaIndicatorVintageSchema = z
  .object({
    indicatorId: z.string().min(1),
    periodOn: z.iso.date(),
    value: finiteDecimalSchema.nullable(),
    missingReason: z.enum(["source_null", "withdrawn"]).nullable(),
    /** The source's conventional sign for this point, if it printed one. */
    sourceNote: indecConventionalSignSchema.nullable().default(null),
    /** Publication time if supplied; otherwise the observed fetch time. */
    availableAt: z.iso.datetime({ offset: true }),
    recordedAt: z.iso.datetime({ offset: true }),
    revision: z.number().int().nonnegative(),
    segment: z.string().min(1),
    sourceRunId: z.string().min(1),
  })
  .superRefine((vintage, context) => {
    if ((vintage.value === null) !== (vintage.missingReason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["missingReason"],
        message: "missing reason must match a missing value",
      });
    }
  });

export type ArgentinaIndicatorVintage = z.infer<
  typeof argentinaIndicatorVintageSchema
>;

export type IndicatorQuery = {
  readonly effectiveOn: string;
  readonly knownAt: string;
  readonly knowledgeBasis: "public_availability" | "system_recorded";
};

/** Select one visible vintage per date without letting a later revision leak back. */
export function readIndicatorVintages(
  indicator: ArgentinaIndicator,
  vintages: readonly ArgentinaIndicatorVintage[],
  query: IndicatorQuery,
): readonly ArgentinaIndicatorVintage[] {
  z.iso.date().parse(query.effectiveOn);
  z.iso.datetime({ offset: true }).parse(query.knownAt);
  const knownMs = Date.parse(query.knownAt);
  const visible = new Map<string, ArgentinaIndicatorVintage>();
  for (const vintage of vintages) {
    argentinaIndicatorVintageSchema.parse(vintage);
    if (vintage.indicatorId !== indicator.id) {
      throw new Error("indicator_mismatch");
    }
    if (
      vintage.periodOn > query.effectiveOn ||
      Date.parse(vintage.availableAt) > knownMs ||
      (query.knowledgeBasis === "system_recorded" &&
        Date.parse(vintage.recordedAt) > knownMs)
    ) {
      continue;
    }
    const previous = visible.get(vintage.periodOn);
    if (
      previous &&
      (previous.revision === vintage.revision ||
        (Date.parse(previous.availableAt) > Date.parse(vintage.availableAt) &&
          previous.revision < vintage.revision))
    ) {
      throw new Error("revision_chain_conflict");
    }
    if (!previous || vintage.revision > previous.revision) {
      visible.set(vintage.periodOn, vintage);
    }
  }
  return [...visible.values()].sort((a, b) =>
    a.periodOn.localeCompare(b.periodOn),
  );
}

export type Comparison =
  | {
      readonly status: "computed";
      readonly value: string;
      readonly version: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "missing_value"
        | "incompatible_period"
        | "incompatible_basis"
        | "incompatible_currency"
        | "zero_denominator"
        | "non_finite";
    };

const unavailable = (
  reason: Extract<Comparison, { status: "unavailable" }>["reason"],
): Comparison => ({
  status: "unavailable",
  reason,
});

/** Fiscal balance as a share of nominal GDP in the same calendar year. */
export function fiscalShareOfGdp(input: {
  readonly fiscal: ArgentinaIndicator;
  readonly monthlyFiscal: readonly ArgentinaIndicatorVintage[];
  readonly gdp: ArgentinaIndicator;
  readonly annualGdp: ArgentinaIndicatorVintage | null;
  readonly year: number;
}): Comparison {
  const { fiscal, monthlyFiscal, gdp, annualGdp, year } = input;
  if (fiscal.currency !== gdp.currency)
    return unavailable("incompatible_currency");
  if (fiscal.currency !== "ARS") return unavailable("incompatible_basis");
  if (
    fiscal.frequency !== "monthly" ||
    gdp.frequency !== "annual" ||
    fiscal.priceBasis !== "current" ||
    gdp.priceBasis !== "current" ||
    fiscal.seasonalAdjustment !== "original" ||
    gdp.seasonalAdjustment !== "original" ||
    fiscal.scale === null ||
    fiscal.scale !== gdp.scale
  )
    return unavailable("incompatible_basis");
  if (
    annualGdp === null ||
    annualGdp.indicatorId !== gdp.id ||
    annualGdp.segment !== gdp.segment ||
    annualGdp.periodOn.slice(0, 4) !== String(year) ||
    monthlyFiscal.length !== 12 ||
    new Set(monthlyFiscal.map((point) => point.periodOn.slice(0, 7))).size !==
      12 ||
    monthlyFiscal.some(
      (point) =>
        point.indicatorId !== fiscal.id ||
        point.periodOn.slice(0, 4) !== String(year) ||
        point.segment !== fiscal.segment,
    )
  )
    return unavailable("incompatible_period");
  if (
    annualGdp.value === null ||
    monthlyFiscal.some((point) => point.value === null)
  )
    return unavailable("missing_value");
  const d = createDecimalOperations((code) => new Error(code));
  try {
    const denominator = d.parseDecimal(annualGdp.value, "annualGdp");
    if (denominator.isZero()) return unavailable("zero_denominator");
    const numerator = monthlyFiscal.reduce(
      (total, point) =>
        total.plus(d.parseDecimal(point.value!, "monthlyFiscal")),
      d.parseDecimal("0", "total"),
    );
    const value = d.divide(numerator, denominator, "share").mul(100);
    return {
      status: "computed",
      value: d.formatDecimal(value, "share"),
      version: ARGENTINA_INDICATOR_VERSION,
    };
  } catch {
    return unavailable("non_finite");
  }
}

/** Only the source's own adjusted series may support a monthly activity change. */
export function seasonallyAdjustedMonthlyChange(input: {
  readonly indicator: ArgentinaIndicator;
  readonly previous: ArgentinaIndicatorVintage | null;
  readonly current: ArgentinaIndicatorVintage | null;
}): Comparison {
  const { indicator, previous, current } = input;
  if (
    indicator.frequency !== "monthly" ||
    indicator.seasonalAdjustment !== "seasonally_adjusted"
  )
    return unavailable("incompatible_basis");
  if (!previous || !current) return unavailable("incompatible_period");
  const next = new Date(`${previous.periodOn.slice(0, 7)}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  if (
    current.periodOn.slice(0, 7) !== next.toISOString().slice(0, 7) ||
    previous.segment !== current.segment ||
    previous.indicatorId !== indicator.id ||
    current.indicatorId !== indicator.id
  )
    return unavailable("incompatible_period");
  if (previous.value === null || current.value === null)
    return unavailable("missing_value");
  const d = createDecimalOperations((code) => new Error(code));
  try {
    const base = d.parseDecimal(previous.value, "previous");
    if (base.isZero()) return unavailable("zero_denominator");
    const value = d
      .divide(d.parseDecimal(current.value, "current"), base, "change")
      .minus(1)
      .mul(100);
    return {
      status: "computed",
      value: d.formatDecimal(value, "change"),
      version: ARGENTINA_INDICATOR_VERSION,
    };
  } catch {
    return unavailable("non_finite");
  }
}

/**
 * Change against the same month a year earlier, on the source's original
 * series: seasonality cancels by construction, so no adjusted series is
 * needed. Both points must share the segment, so a rebasing never compares.
 */
export function yearOverYearChange(input: {
  readonly indicator: ArgentinaIndicator;
  readonly yearEarlier: ArgentinaIndicatorVintage | null;
  readonly current: ArgentinaIndicatorVintage | null;
}): Comparison {
  const { indicator, yearEarlier, current } = input;
  if (
    indicator.frequency !== "monthly" ||
    indicator.seasonalAdjustment !== "original"
  )
    return unavailable("incompatible_basis");
  if (!yearEarlier || !current) return unavailable("incompatible_period");
  const expected = `${Number(current.periodOn.slice(0, 4)) - 1}${current.periodOn.slice(4, 7)}`;
  if (
    yearEarlier.periodOn.slice(0, 7) !== expected ||
    yearEarlier.segment !== current.segment ||
    yearEarlier.indicatorId !== indicator.id ||
    current.indicatorId !== indicator.id
  )
    return unavailable("incompatible_period");
  if (yearEarlier.value === null || current.value === null)
    return unavailable("missing_value");
  const d = createDecimalOperations((code) => new Error(code));
  try {
    const base = d.parseDecimal(yearEarlier.value, "yearEarlier");
    if (base.isZero()) return unavailable("zero_denominator");
    const value = d
      .divide(d.parseDecimal(current.value, "current"), base, "change")
      .minus(1)
      .mul(100);
    return {
      status: "computed",
      value: d.formatDecimal(value, "change"),
      version: ARGENTINA_INDICATOR_VERSION,
    };
  } catch {
    return unavailable("non_finite");
  }
}

/** Trade balance from exports and imports reported for the same month. */
export function tradeBalance(input: {
  readonly exports: ArgentinaIndicator;
  readonly imports: ArgentinaIndicator;
  readonly exportPoint: ArgentinaIndicatorVintage | null;
  readonly importPoint: ArgentinaIndicatorVintage | null;
}): Comparison {
  const { exports, imports, exportPoint, importPoint } = input;
  if (exports.currency !== imports.currency)
    return unavailable("incompatible_currency");
  if (
    exports.frequency !== "monthly" ||
    imports.frequency !== "monthly" ||
    exports.unit !== imports.unit ||
    exports.priceBasis !== imports.priceBasis ||
    exports.seasonalAdjustment !== imports.seasonalAdjustment ||
    exports.segment !== imports.segment
  )
    return unavailable("incompatible_basis");
  if (
    !exportPoint ||
    !importPoint ||
    exportPoint.indicatorId !== exports.id ||
    importPoint.indicatorId !== imports.id ||
    exportPoint.periodOn.slice(0, 7) !== importPoint.periodOn.slice(0, 7) ||
    exportPoint.segment !== exports.segment ||
    importPoint.segment !== imports.segment
  )
    return unavailable("incompatible_period");
  if (exportPoint.value === null || importPoint.value === null)
    return unavailable("missing_value");
  const d = createDecimalOperations((code) => new Error(code));
  try {
    const value = d
      .parseDecimal(exportPoint.value, "exports")
      .minus(d.parseDecimal(importPoint.value, "imports"));
    return {
      status: "computed",
      value: d.formatDecimal(value, "balance"),
      version: ARGENTINA_INDICATOR_VERSION,
    };
  } catch {
    return unavailable("non_finite");
  }
}
