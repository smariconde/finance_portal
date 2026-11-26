import { z } from "zod";

import {
  failure,
  issuePath,
  readExactJson,
  type SchwabParseResult,
} from "./schwab-exact";

/**
 * Parser cerrado de `/marketdata/v1/markets/equity?date=` (`F12-01`, ADR 0088
 * decisión 2).
 *
 * Sin medir todavía con la cuenta del owner: la forma sale del esquema de un
 * cliente de terceros (`{ equity: { <producto>: { date, marketType, isOpen,
 * sessionHours: { preMarket, regularMarket, postMarket: [{ start, end }] } } } }`,
 * horas ISO con desplazamiento). Por eso es cerrado: una clave que no está acá
 * rechaza la lectura nombrando su camino, sin valores, y con ese camino se
 * ajusta. La respuesta se muestra y no se guarda.
 */
export const SCHWAB_MARKET_HOURS_PARSER_VERSION = "schwab-market-hours-1.0.0";

const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

const intervalSchema = z
  .object({
    start: z.string().regex(ISO_WITH_OFFSET),
    end: z.string().regex(ISO_WITH_OFFSET),
  })
  .strict();

const intervalsSchema = z.array(intervalSchema).max(4);

const productSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .optional(),
    marketType: z.string().max(32),
    exchange: z.string().max(64).optional(),
    category: z.string().max(64).optional(),
    product: z.string().max(32).optional(),
    productName: z.string().max(64).optional(),
    isOpen: z.boolean(),
    sessionHours: z
      .object({
        preMarket: intervalsSchema.optional(),
        regularMarket: intervalsSchema.optional(),
        postMarket: intervalsSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const responseSchema = z
  .object({
    equity: z.record(z.string().max(32), productSchema),
  })
  .strict();

export type SchwabSession = {
  readonly start: string;
  readonly end: string;
};

export type SchwabMarketDay = {
  readonly date: string;
  readonly isOpen: boolean;
  /** El producto que se leyó (`EQ`), como lo nombra Schwab. */
  readonly product: string;
  readonly preMarket: SchwabSession | null;
  readonly regularMarket: SchwabSession | null;
  readonly postMarket: SchwabSession | null;
};

function sessionOf(
  intervals: readonly { start: string; end: string }[] | undefined,
): SchwabSession | null | "invalid" {
  if (intervals === undefined || intervals.length === 0) return null;
  const starts = intervals.map((interval) => Date.parse(interval.start));
  const ends = intervals.map((interval) => Date.parse(interval.end));
  if ([...starts, ...ends].some(Number.isNaN)) return "invalid";
  const start = Math.min(...starts);
  const end = Math.max(...ends);
  if (end <= start) return "invalid";
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
}

/** Las acciones (`EQ`); si Schwab nombra un solo producto, ése. */
function pickProduct<T>(products: Record<string, T>): [string, T] | null {
  const entries = Object.entries(products);
  const equity = entries.find(([key]) => key === "EQ");
  if (equity !== undefined) return equity;
  return entries.length === 1 ? entries[0]! : null;
}

export function parseSchwabMarketHours(
  body: Uint8Array,
  requestedDate: string,
): SchwabParseResult<SchwabMarketDay> {
  const json = readExactJson(body);
  if (json === null) return failure("invalid_json");

  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    return failure("market_hours_schema_changed", issuePath(parsed.error));
  }

  if (Object.keys(parsed.data.equity).length === 0) {
    return failure("market_hours_product_missing", "equity");
  }
  const picked = pickProduct(parsed.data.equity);
  if (picked === null) {
    return failure("market_hours_product_ambiguous", "equity");
  }
  const [product, entry] = picked;

  if (entry.date !== undefined && entry.date !== requestedDate) {
    return failure("market_hours_date_mismatch", `equity.${product}.date`);
  }

  const sessions = {
    preMarket: sessionOf(entry.sessionHours?.preMarket),
    regularMarket: sessionOf(entry.sessionHours?.regularMarket),
    postMarket: sessionOf(entry.sessionHours?.postMarket),
  };
  for (const [name, session] of Object.entries(sessions)) {
    if (session === "invalid") {
      return failure(
        "market_hours_interval_invalid",
        `equity.${product}.sessionHours.${name}`,
      );
    }
  }

  return {
    ok: true,
    value: {
      date: requestedDate,
      isOpen: entry.isOpen,
      product,
      preMarket: sessions.preMarket as SchwabSession | null,
      regularMarket: sessions.regularMarket as SchwabSession | null,
      postMarket: sessions.postMarket as SchwabSession | null,
    },
  };
}
