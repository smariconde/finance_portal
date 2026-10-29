import { z } from "zod";

import type {
  ReferenceRow,
  ReferenceRelease,
} from "@/modules/reference-data/domain/reference-release";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import { engineDecimalSchema, parseDecimal, ONE, ZERO } from "./decimal-policy";

/** La columna es antes de impuestos y comparte la base ajustada de EBIT. */
export const GROWTH_MARGIN_DATASET = "damodaran.margins-us";
export const GROWTH_MARGIN_FIELD = "pretax_lease_rd_adjusted_margin";

export const growthMarginReferenceSchema = z.object({
  datasetId: z.literal(GROWTH_MARGIN_DATASET),
  releaseId: z.uuid(),
  rowKey: z.string().min(1).max(128),
  field: z.literal(GROWTH_MARGIN_FIELD),
  value: engineDecimalSchema,
  publishedLabel: z.string().max(64).nullable(),
  availableAt: utcTimestampSchema,
  recordedAt: utcTimestampSchema,
});

export type GrowthMarginReference = z.infer<typeof growthMarginReferenceSchema>;

export type GrowthMarginReading =
  | { readonly status: "ready"; readonly reference: GrowthMarginReference }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "release_missing"
        | "industry_missing"
        | "margin_missing"
        | "margin_invalid";
    };

/** Select the exact industry row visible at the valuation cutoff. */
export function growthMarginAt(
  reading: {
    readonly release: ReferenceRelease;
    readonly rows: readonly ReferenceRow[];
  } | null,
  industryKey: string | null,
  query: PointInTimeQuery,
): GrowthMarginReading {
  if (
    reading === null ||
    reading.release.datasetId !== GROWTH_MARGIN_DATASET ||
    reading.release.sourceId !== "damodaran-current-data" ||
    !isEffectiveAt(reading.release, query.effectiveAt) ||
    !isKnownAt(reading.release, query)
  )
    return { status: "unavailable", reason: "release_missing" };
  if (industryKey === null)
    return { status: "unavailable", reason: "industry_missing" };

  const rows = reading.rows.filter((row) => row.key === industryKey);
  if (rows.length !== 1)
    return { status: "unavailable", reason: "margin_missing" };
  const value = rows[0]!.values[GROWTH_MARGIN_FIELD];
  if (value === null || value === undefined)
    return { status: "unavailable", reason: "margin_missing" };
  if (!engineDecimalSchema.safeParse(value).success)
    return { status: "unavailable", reason: "margin_invalid" };
  const margin = parseDecimal(value, GROWTH_MARGIN_FIELD);
  if (margin.lte(ZERO) || margin.gt(ONE))
    return { status: "unavailable", reason: "margin_invalid" };

  return {
    status: "ready",
    reference: growthMarginReferenceSchema.parse({
      datasetId: GROWTH_MARGIN_DATASET,
      releaseId: reading.release.releaseId,
      rowKey: industryKey,
      field: GROWTH_MARGIN_FIELD,
      value,
      publishedLabel: reading.release.publishedLabel,
      availableAt: reading.release.availableAt,
      recordedAt: reading.release.recordedAt,
    }),
  };
}
