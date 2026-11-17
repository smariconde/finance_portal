import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

/**
 * Reader of Ámbito's country risk history (ADR 0080): a JSON array whose
 * first row is the header `["Fecha", "Puntos"]` and every other row a close
 * as `["dd-mm-aaaa", "1234,56"]`, newest first.
 *
 * Measured on 2026-11-17 (7,206 closes since 1998-12-11): values carry a
 * decimal comma and no thousands separator; two dates come twice —one as an
 * identical copy, which is one point, and 2021-02-22 with 1,509 and 1,501,
 * which is left out by name instead of picking one—; four rows fall on a
 * weekend and are kept as published.
 */
export const AMBITO_COUNTRY_RISK_PARSER_VERSION = "ambito-riesgo-pais-1.0.0";

const HEADER = ["Fecha", "Puntos"] as const;
const DATE_PATTERN = /^(\d{2})-(\d{2})-(\d{4})$/u;
const VALUE_PATTERN = /^(\d+),(\d{2})$/u;

export type AmbitoCountryRiskPoint = {
  readonly periodOn: string;
  /** Basis points as the source printed them, with a decimal point. */
  readonly value: string;
};

export type AmbitoCountryRiskParseResult =
  | {
      readonly ok: true;
      /** Oldest first. */
      readonly points: readonly AmbitoCountryRiskPoint[];
      /** Days published twice with different values: left out. */
      readonly conflictingDays: readonly string[];
      /** Saturdays and Sundays the source published, kept as they came. */
      readonly weekendRows: number;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid_json"
        | "layout_changed"
        | "invalid_date"
        | "invalid_value"
        | "unexpected_order"
        | "empty";
    };

const decimal = createDecimalOperations((code) => new Error(code));

function isoDateOf(text: string): string | null {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
}

function valueOf(text: string): string | null {
  const match = VALUE_PATTERN.exec(text);
  if (match === null) return null;
  const value = decimal.parseDecimal(`${match[1]}.${match[2]}`, "puntos");
  return value.greaterThan(0) ? decimal.formatDecimal(value, "puntos") : null;
}

export function parseAmbitoCountryRisk(
  body: string,
): AmbitoCountryRiskParseResult {
  let rows: unknown;
  try {
    rows = JSON.parse(body);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!Array.isArray(rows)) return { ok: false, reason: "layout_changed" };
  const [header, ...data] = rows as unknown[];
  if (
    !Array.isArray(header) ||
    header.length !== HEADER.length ||
    header.some((cell, index) => cell !== HEADER[index])
  ) {
    return { ok: false, reason: "layout_changed" };
  }
  if (data.length === 0) return { ok: false, reason: "empty" };

  const byDay = new Map<string, string | "conflict">();
  let previousOn: string | null = null;
  for (const row of data) {
    if (
      !Array.isArray(row) ||
      row.length !== 2 ||
      typeof row[0] !== "string" ||
      typeof row[1] !== "string"
    ) {
      return { ok: false, reason: "layout_changed" };
    }
    const periodOn = isoDateOf(row[0]);
    if (periodOn === null) return { ok: false, reason: "invalid_date" };
    const value = valueOf(row[1]);
    if (value === null) return { ok: false, reason: "invalid_value" };
    // Newest first; a repeated day sits next to its copy.
    if (previousOn !== null && periodOn > previousOn) {
      return { ok: false, reason: "unexpected_order" };
    }
    if (periodOn === previousOn) {
      const seen = byDay.get(periodOn);
      if (seen !== value) byDay.set(periodOn, "conflict");
    } else {
      byDay.set(periodOn, value);
    }
    previousOn = periodOn;
  }

  const points: AmbitoCountryRiskPoint[] = [];
  const conflictingDays: string[] = [];
  let weekendRows = 0;
  for (const [periodOn, value] of [...byDay].reverse()) {
    if (value === "conflict") {
      conflictingDays.push(periodOn);
      continue;
    }
    const weekday = new Date(`${periodOn}T00:00:00.000Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) weekendRows += 1;
    points.push({ periodOn, value });
  }
  return { ok: true, points, conflictingDays, weekendRows };
}

/** The whole history up to `untilOn`, in one request. */
export function ambitoCountryRiskUrl(untilOn: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(untilOn)) {
    throw new Error("invalid_country_risk_request");
  }
  return `https://mercados.ambito.com/riesgopais/historico-general/1990-01-01/${untilOn}`;
}
