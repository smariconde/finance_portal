import { describe, expect, it } from "vitest";

import {
  earningsWeek,
  earningsWeekStarts,
  firstEarningsWeek,
  mondayOf,
} from "./earnings-week";

function report(
  symbol: string,
  date: string,
  time: "pre-market" | "post-market" | null,
  overrides: { estimate?: string | null; previousDate?: string | null } = {},
) {
  return {
    symbol,
    date,
    time,
    fiscalDateEnding: null,
    estimate: overrides.estimate ?? null,
    currency: "USD",
    previousDate: overrides.previousDate ?? null,
  };
}

const reports = [
  report("ZS", "2026-12-01", "post-market", { estimate: "0.78" }),
  report("AAPL", "2026-12-01", "post-market", {
    previousDate: "2026-11-30",
  }),
  report("CRM", "2026-12-01", "post-market", { previousDate: "2026-12-01" }),
  report("DG", "2026-12-02", "pre-market", { estimate: "-0.12" }),
  report("XYZ", "2026-12-03", null),
  report("LATE", "2027-01-14", "pre-market"),
];

describe("semanas", () => {
  it("el lunes de cualquier día de la semana", () => {
    expect(mondayOf("2026-12-03")).toBe("2026-11-30");
    expect(mondayOf("2026-11-30")).toBe("2026-11-30");
    expect(mondayOf("2026-12-06")).toBe("2026-11-30");
  });

  it("arranca en la semana de hoy, o en la siguiente un fin de semana", () => {
    expect(firstEarningsWeek("2026-11-27")).toBe("2026-11-23");
    expect(firstEarningsWeek("2026-11-28")).toBe("2026-11-30");
    expect(firstEarningsWeek("2026-11-29")).toBe("2026-11-30");
  });

  it("llega hasta la semana del último reporte, sin volver atrás", () => {
    const weeks = earningsWeekStarts(reports, "2026-11-27");
    expect(weeks[0]).toBe("2026-11-23");
    expect(weeks.at(-1)).toBe("2027-01-11");
    expect(weeks).toHaveLength(8);
    expect(earningsWeekStarts([], "2026-11-28")).toEqual(["2026-11-30"]);
    expect(
      earningsWeekStarts([report("OLD", "2026-11-02", null)], "2026-11-27"),
    ).toEqual(["2026-11-23"]);
  });
});

describe("earningsWeek", () => {
  const week = earningsWeek({
    reports,
    start: "2026-11-30",
    followed: ["CRM"],
    onlyFollowed: false,
  });

  it("reparte por día y por antes o después de la sesión", () => {
    expect(week.days.map((day) => day.date)).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
    ]);
    expect(week.days[2]!.sessions.before.map((e) => e.symbol)).toEqual(["DG"]);
    expect(week.days[3]!.sessions.unknown.map((e) => e.symbol)).toEqual([
      "XYZ",
    ]);
    expect(week.total).toBe(5);
    expect(week.hasUnknown).toBe(true);
  });

  it("pone primero las empresas seguidas y después por ticker", () => {
    expect(week.days[1]!.sessions.after.map((e) => e.symbol)).toEqual([
      "CRM",
      "AAPL",
      "ZS",
    ]);
  });

  it("nombra la fecha anterior sólo si cambió", () => {
    const after = week.days[1]!.sessions.after;
    expect(after.find((e) => e.symbol === "AAPL")!.previousDate).toBe(
      "2026-11-30",
    );
    expect(after.find((e) => e.symbol === "CRM")!.previousDate).toBe(null);
  });

  it("con «sólo mis empresas» deja sólo las seguidas", () => {
    const mine = earningsWeek({
      reports,
      start: "2026-11-30",
      followed: ["CRM"],
      onlyFollowed: true,
    });
    expect(mine.total).toBe(1);
    expect(mine.hasUnknown).toBe(false);
  });

  it("una semana sin reportes queda vacía, no inventa nada", () => {
    const empty = earningsWeek({
      reports,
      start: "2026-12-07",
      followed: [],
      onlyFollowed: false,
    });
    expect(empty.total).toBe(0);
    expect(empty.days.every((day) => day.sessions.after.length === 0)).toBe(
      true,
    );
  });
});
