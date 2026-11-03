import { z } from "zod";

import {
  canonicalDecimalFromJsonNumber,
  ExactJsonNumber,
  parseJsonPreservingNumbers,
} from "@/modules/fundamentals/domain/exact-json";

import type { ArgentinaIndicator } from "./argentina-indicator";

export const ARGENTINA_SERIES_PARSER_VERSION = "argentina-series-api-1.0.0";
export const ARGENTINA_SERIES_PAGE_LIMIT = 1000;
export const ARGENTINA_SERIES_MAX_PAGES = 20;

const wireSchema = z
  .object({
    data: z.array(
      z.tuple([
        z.iso.date(),
        z.union([z.instanceof(ExactJsonNumber), z.null()]),
      ]),
    ),
    count: z.instanceof(ExactJsonNumber),
    meta: z.tuple([
      z
        .object({
          frequency: z.string(),
          start_date: z.iso.date(),
          end_date: z.iso.date(),
        })
        .passthrough(),
      z
        .object({
          dataset: z.object({ source: z.string().min(1) }).passthrough(),
          field: z.object({ id: z.string(), units: z.string() }).passthrough(),
        })
        .passthrough(),
    ]),
    params: z.object({ ids: z.string() }).passthrough(),
  })
  .passthrough();

export type ArgentinaSeriesPage = {
  readonly total: number;
  readonly points: readonly {
    readonly periodOn: string;
    readonly value: string | null;
  }[];
  readonly sourceName: string;
};

export type ArgentinaSeriesParseResult =
  | { readonly ok: true; readonly page: ArgentinaSeriesPage }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid_json"
        | "schema_changed"
        | "metadata_mismatch"
        | "invalid_value"
        | "unexpected_order"
        | "page_limit";
    };

export function parseArgentinaSeriesPage(
  text: string,
  indicator: ArgentinaIndicator,
): ArgentinaSeriesParseResult {
  let parsed: unknown;
  try {
    parsed = parseJsonPreservingNumbers(text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  const wire = wireSchema.safeParse(parsed);
  if (!wire.success) return { ok: false, reason: "schema_changed" };
  const body = wire.data;
  const frequency =
    indicator.frequency === "monthly"
      ? "month"
      : indicator.frequency === "annual"
        ? "year"
        : "quarter";
  if (
    body.params.ids !== indicator.externalId ||
    body.meta[1].field.id !== indicator.externalId ||
    body.meta[1].field.units !== indicator.unit ||
    body.meta[0].frequency !== frequency
  )
    return { ok: false, reason: "metadata_mismatch" };
  const total = Number(body.count.source);
  if (!Number.isSafeInteger(total) || total < body.data.length || total < 0) {
    return { ok: false, reason: "schema_changed" };
  }
  if (body.data.length > ARGENTINA_SERIES_PAGE_LIMIT) {
    return { ok: false, reason: "page_limit" };
  }
  const points: { periodOn: string; value: string | null }[] = [];
  let previous: string | null = null;
  for (const [periodOn, raw] of body.data) {
    if (previous !== null && periodOn <= previous) {
      return { ok: false, reason: "unexpected_order" };
    }
    previous = periodOn;
    const value =
      raw === null ? null : canonicalDecimalFromJsonNumber(raw.source);
    if (raw !== null && value === null)
      return { ok: false, reason: "invalid_value" };
    points.push({ periodOn, value });
  }
  return {
    ok: true,
    page: { total, points, sourceName: body.meta[1].dataset.source },
  };
}

export function argentinaSeriesPageUrl(
  externalId: string,
  start: number,
): string {
  if (
    !/^[A-Za-z0-9_.]+$/u.test(externalId) ||
    !Number.isSafeInteger(start) ||
    start < 0
  ) {
    throw new Error("invalid_series_request");
  }
  const params = new URLSearchParams({
    ids: externalId,
    start: String(start),
    limit: String(ARGENTINA_SERIES_PAGE_LIMIT),
  });
  return `https://apis.datos.gob.ar/series/api/series/?${params.toString()}`;
}
