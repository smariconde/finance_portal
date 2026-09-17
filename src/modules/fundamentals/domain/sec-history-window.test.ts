import { describe, expect, it } from "vitest";

import type { SecReportedFact } from "./parse-sec-company-facts";
import {
  applySecHistoryWindow,
  buildSecHistoryWindow,
  resolveSecHistoryAnchor,
  SEC_HISTORY_WINDOW_VERSION,
  subtractCalendarYears,
  subtractDays,
} from "./sec-history-window";

function fact(
  overrides: Partial<SecReportedFact> & Pick<SecReportedFact, "end">,
): SecReportedFact {
  return {
    taxonomy: "us-gaap",
    concept: "NetIncomeLoss",
    unit: "USD",
    start: null,
    value: "1",
    accessionNumber: "0000320193-25-000079",
    form: "10-K",
    filed: "2025-10-31",
    fiscalYear: 2025,
    fiscalPeriod: "FY",
    ...overrides,
  };
}

const noEvidence = () => false;
const epsIsEvidence = (_taxonomy: string, concept: string) =>
  concept === "EarningsPerShareDiluted";

describe("calendar arithmetic", () => {
  it("moves whole years and clamps the 29th of February", () => {
    expect(subtractCalendarYears("2025-09-27", 5)).toBe("2020-09-27");
    expect(subtractCalendarYears("2024-02-29", 5)).toBe("2019-02-28");
    expect(subtractCalendarYears("2028-02-29", 4)).toBe("2024-02-29");
    expect(subtractCalendarYears("2025-12-31", 6)).toBe("2019-12-31");
  });

  it("moves days across months and leap days", () => {
    expect(subtractDays("2020-09-27", 14)).toBe("2020-09-13");
    expect(subtractDays("2020-03-10", 14)).toBe("2020-02-25");
    expect(subtractDays("2021-01-11", 14)).toBe("2020-12-28");
  });

  it("refuses text that is not a calendar date", () => {
    expect(() => subtractCalendarYears("2025-02-30", 5)).toThrow(TypeError);
    expect(() => subtractDays("20250101", 1)).toThrow(TypeError);
  });
});

describe("resolveSecHistoryAnchor", () => {
  it("anchors on the latest annual duration of an annual report", () => {
    expect(
      resolveSecHistoryAnchor([
        fact({ start: "2023-10-01", end: "2024-09-28" }),
        fact({ start: "2024-09-29", end: "2025-09-27" }),
        // Un saldo posterior no mueve el ancla.
        fact({ concept: "Assets", end: "2025-12-27", fiscalPeriod: "Q1" }),
      ]),
    ).toEqual({ anchorOn: "2025-09-27", anchorBasis: "annual_report" });
  });

  it("ignores annual durations outside an annual report", () => {
    // Amazon publica flujos de doce meses (TTM) en sus 10-Q.
    expect(
      resolveSecHistoryAnchor([
        fact({ start: "2025-01-01", end: "2025-12-31" }),
        fact({
          start: "2025-07-01",
          end: "2026-06-30",
          form: "10-Q",
          fiscalYear: 2026,
          fiscalPeriod: "Q2",
        }),
      ]),
    ).toEqual({ anchorOn: "2025-12-31", anchorBasis: "annual_report" });
  });

  it("ignores durations of an annual report that are not a year", () => {
    expect(
      resolveSecHistoryAnchor([
        fact({ start: "2024-01-01", end: "2024-12-31" }),
        // Un cuarto trimestre, o un período de transición, con foco FY.
        fact({ start: "2025-10-01", end: "2025-12-31" }),
      ]),
    ).toEqual({ anchorOn: "2024-12-31", anchorBasis: "annual_report" });
  });

  it("falls back to the latest period of a filer without an annual report", () => {
    expect(
      resolveSecHistoryAnchor([
        fact({
          start: "2026-01-01",
          end: "2026-06-30",
          form: "10-Q",
          fiscalPeriod: "Q2",
        }),
        fact({
          concept: "Assets",
          end: "2026-06-30",
          form: "10-Q",
          fiscalPeriod: "Q2",
        }),
        fact({
          start: "2025-04-01",
          end: "2025-06-30",
          form: "10-Q",
          fiscalPeriod: "Q2",
        }),
      ]),
    ).toEqual({ anchorOn: "2026-06-30", anchorBasis: "latest_period" });
  });

  it("has no anchor without facts", () => {
    expect(resolveSecHistoryAnchor([])).toBeNull();
  });
});

describe("buildSecHistoryWindow", () => {
  it("keeps five fiscal years and the base close, plus one for split evidence", () => {
    expect(buildSecHistoryWindow("2025-12-31", "annual_report")).toEqual({
      version: SEC_HISTORY_WINDOW_VERSION,
      anchorOn: "2025-12-31",
      anchorBasis: "annual_report",
      periodsEndingFrom: "2020-12-17",
      evidencePeriodsEndingFrom: "2019-12-17",
    });
  });

  it("anchors a leap-day close on the 28th of February", () => {
    const window = buildSecHistoryWindow("2024-02-29", "annual_report");

    expect(window.periodsEndingFrom).toBe("2019-02-14");
    expect(window.evidencePeriodsEndingFrom).toBe("2018-02-14");
  });
});

describe("applySecHistoryWindow", () => {
  it("keeps the base fiscal year and its close, and nothing before", () => {
    // Calendario: el ancla es el cierre 2025 y la base, el cierre 2020.
    const facts = [
      fact({ start: "2025-01-01", end: "2025-12-31" }),
      fact({ start: "2020-01-01", end: "2020-12-31", filed: "2021-02-01" }),
      fact({ start: "2020-10-01", end: "2020-12-31", filed: "2021-02-01" }),
      fact({ start: "2020-01-01", end: "2020-09-30", fiscalPeriod: "Q3" }),
      fact({ start: "2019-01-01", end: "2019-12-31" }),
      fact({ concept: "Assets", end: "2020-12-31" }),
      fact({ concept: "Assets", end: "2020-09-30", fiscalPeriod: "Q3" }),
      fact({ start: "2021-01-01", end: "2021-03-31", fiscalPeriod: "Q1" }),
    ];
    const selection = applySecHistoryWindow(facts, noEvidence);

    expect(selection.window?.periodsEndingFrom).toBe("2020-12-17");
    expect(selection.facts.map((kept) => kept.start ?? kept.end)).toEqual([
      "2025-01-01",
      "2020-01-01",
      "2020-10-01",
      "2020-12-31",
      "2021-01-01",
    ]);
    expect(selection.counts).toEqual({ points: 8, kept: 5, outside: 3 });
  });

  it("absorbs a 52/53-week base close that lands before or after the anchor date", () => {
    // Deere: el ejercicio 2025 cierra el 2025-11-02 y el 2020, el 2020-11-01.
    const deere = applySecHistoryWindow(
      [
        fact({ start: "2024-10-28", end: "2025-11-02" }),
        fact({ start: "2019-11-04", end: "2020-11-01" }),
        fact({ concept: "Assets", end: "2020-11-01" }),
        fact({ start: "2020-05-04", end: "2020-08-02", fiscalPeriod: "Q3" }),
      ],
      noEvidence,
    );

    expect(deere.facts.map((kept) => kept.end)).toEqual([
      "2025-11-02",
      "2020-11-01",
      "2020-11-01",
    ]);

    // NVIDIA: el ejercicio 2026 cierra el 2026-01-25 y el 2021, el 2021-01-31,
    // seis días después de la fecha del ancla.
    const nvidia = applySecHistoryWindow(
      [
        fact({ start: "2025-01-27", end: "2026-01-25" }),
        fact({ start: "2020-01-27", end: "2021-01-31" }),
        fact({ start: "2019-01-28", end: "2020-01-26" }),
        fact({ start: "2020-07-27", end: "2020-10-25", fiscalPeriod: "Q3" }),
      ],
      noEvidence,
    );

    expect(nvidia.facts.map((kept) => kept.end)).toEqual([
      "2026-01-25",
      "2021-01-31",
    ]);
  });

  it("keeps one more fiscal year of the concepts that prove a split", () => {
    const facts = [
      fact({ start: "2025-01-01", end: "2025-12-31" }),
      fact({
        concept: "EarningsPerShareDiluted",
        unit: "USD/shares",
        start: "2020-04-01",
        end: "2020-06-30",
        fiscalPeriod: "Q2",
      }),
      fact({
        concept: "EarningsPerShareDiluted",
        unit: "USD/shares",
        start: "2019-01-01",
        end: "2019-12-31",
      }),
      fact({
        concept: "EarningsPerShareDiluted",
        unit: "USD/shares",
        start: "2019-01-01",
        end: "2019-09-30",
        fiscalPeriod: "Q3",
      }),
      fact({
        concept: "NetIncomeLoss",
        start: "2020-04-01",
        end: "2020-06-30",
        fiscalPeriod: "Q2",
      }),
    ];
    const selection = applySecHistoryWindow(facts, epsIsEvidence);

    expect(selection.window?.evidencePeriodsEndingFrom).toBe("2019-12-17");
    expect(
      selection.facts.map((kept) => `${kept.concept}:${kept.end}`),
    ).toEqual([
      "NetIncomeLoss:2025-12-31",
      "EarningsPerShareDiluted:2020-06-30",
      "EarningsPerShareDiluted:2019-12-31",
    ]);
  });

  it("does not use the clock: the same download is cut the same way", () => {
    // Un filer con cierre en junio sin 10-K nuevo conserva su ancla anterior.
    const facts = [
      fact({ start: "2024-07-01", end: "2025-06-30" }),
      fact({
        start: "2026-01-01",
        end: "2026-03-31",
        form: "10-Q",
        fiscalPeriod: "Q3",
      }),
      fact({ start: "2019-07-01", end: "2020-06-30" }),
    ];

    const selection = applySecHistoryWindow(facts, noEvidence);

    expect(selection).toEqual({
      window: buildSecHistoryWindow("2025-06-30", "annual_report"),
      facts,
      counts: { points: 3, kept: 3, outside: 0 },
    });
    expect(
      applySecHistoryWindow([...facts].reverse(), noEvidence).window,
    ).toEqual(selection.window);
  });

  it("returns no window and no facts for an empty selection", () => {
    expect(applySecHistoryWindow([], noEvidence)).toEqual({
      window: null,
      facts: [],
      counts: { points: 0, kept: 0, outside: 0 },
    });
  });
});
