import { z } from "zod";

export const EARNINGS_CALENDAR_DATASET = "alpha-vantage.earnings-calendar";
export const EARNINGS_CALENDAR_PARSER = "av-earnings-calendar-1.0.0";
export const EARNINGS_CALENDAR_URL =
  "https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month";

export const earningsTimeSchema = z.enum(["pre-market", "post-market"]);
export const earningsReportSchema = z.strictObject({
  symbol: z.string().regex(/^[A-Z0-9][A-Z0-9./^-]{0,31}$/u),
  fiscalDateEnding: z.iso.date().nullable(),
  date: z.iso.date(),
  time: earningsTimeSchema.nullable(),
  estimate: z
    .string()
    .regex(/^-?\d{1,18}(?:\.\d{1,18})?$/u)
    .nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/u)
    .nullable(),
});
export type EarningsReport = z.infer<typeof earningsReportSchema>;

const HEADER =
  "symbol,name,reportDate,fiscalDateEnding,estimate,currency,timeOfTheDay";
const FIELD = /(?:"((?:[^"]|"")*)"|([^",]*))(,|$)/uy;

function fieldsOf(line: string): string[] {
  const fields: string[] = [];
  FIELD.lastIndex = 0;
  while (fields.length <= 7) {
    const field = FIELD.exec(line);
    if (field === null) return [];
    fields.push(field[1]?.replaceAll('""', '"') ?? field[2]!);
    if (field[3] === "") return fields;
  }
  return [];
}

function decimalText(text: string): string {
  const [whole, fraction] = text.split(".");
  const integral = whole!.replace(/^(-?)0+(?=\d)/u, "$1");
  const decimals = fraction?.replace(/0+$/u, "") ?? "";
  return decimals.length > 0
    ? `${integral}.${decimals}`
    : integral === "-0"
      ? "0"
      : integral;
}

export function parseEarningsCalendar(text: string): readonly EarningsReport[] {
  const [header, ...lines] = text.trimEnd().split(/\r?\n/u);
  if (header !== HEADER) throw new Error("earnings_header_changed");
  if (lines.length === 0) throw new Error("earnings_calendar_empty");

  const keys = new Set<string>();
  return lines.map((line) => {
    const fields = fieldsOf(line);
    if (fields.length !== 7) throw new Error("earnings_row_shape");
    const [symbol, , date, fiscalDateEnding, estimate, currency, time] = fields;
    const parsed = earningsReportSchema.safeParse({
      symbol,
      date,
      fiscalDateEnding: fiscalDateEnding || null,
      estimate: estimate || null,
      currency: currency || null,
      time: time || null,
    });
    if (!parsed.success) throw new Error("earnings_invalid_row");
    const row = parsed.data;
    const key = earningsReportKey(row);
    if (keys.has(key)) throw new Error("earnings_duplicate_event");
    keys.add(key);
    return {
      ...row,
      estimate: row.estimate === null ? null : decimalText(row.estimate),
    };
  });
}

/** The provider's fiscal period keeps a moved report in the same chain. */
export function earningsReportKey(row: EarningsReport): string {
  return `${row.symbol}/${row.fiscalDateEnding ?? "undated"}`;
}
