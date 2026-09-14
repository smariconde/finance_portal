import { describe, expect, it } from "vitest";

import {
  normalizeCik,
  parseSecFilingColumns,
  parseSecSubmissions,
} from "./parse-sec-submissions";

/**
 * Payload sintético con la forma del cable real: columnas paralelas, `cik` como
 * string con ceros y un archivo histórico. Ningún valor proviene de una descarga.
 */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    cik: "0000000042",
    name: "Filer sintético",
    filings: {
      recent: {
        accessionNumber: ["0000000042-25-000003", "0000000042-25-000002"],
        filingDate: ["2025-05-02", "2025-02-21"],
        reportDate: ["2025-03-31", "2024-12-31"],
        acceptanceDateTime: [
          "2025-05-01T22:03:34.000Z",
          "2025-02-21T11:01:27.000Z",
        ],
        act: ["34", "34"],
        form: ["10-Q", "10-K"],
        size: [1, 2],
      },
      files: [
        {
          name: "CIK0000000042-submissions-001.json",
          filingCount: 3,
          filingFrom: "2009-01-02",
          filingTo: "2015-07-22",
        },
      ],
    },
    ...overrides,
  };
}

describe("parseSecSubmissions", () => {
  it("reads parallel columns into filings with their acceptance instant", () => {
    const result = parseSecSubmissions(payload());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cik).toBe("0000000042");
    expect(result.filings).toStrictEqual([
      {
        accessionNumber: "0000000042-25-000003",
        form: "10-Q",
        filingDate: "2025-05-02",
        reportDate: "2025-03-31",
        acceptedAt: "2025-05-01T22:03:34.000Z",
      },
      {
        accessionNumber: "0000000042-25-000002",
        form: "10-K",
        filingDate: "2025-02-21",
        reportDate: "2024-12-31",
        acceptedAt: "2025-02-21T11:01:27.000Z",
      },
    ]);
    expect(result.historyFiles).toStrictEqual([
      {
        name: "CIK0000000042-submissions-001.json",
        filingFrom: "2009-01-02",
        filingTo: "2015-07-22",
      },
    ]);
  });

  it("keeps the acceptance as UTC instead of reinterpreting it as New York time", () => {
    const result = parseSecSubmissions(payload());

    // 22:03Z es 18:03 en Nueva York: presentado después de las 17:30, fechado al
    // día hábil siguiente. Leerlo como hora local lo adelantaría cuatro horas.
    expect(result.ok && result.filings[0]?.acceptedAt).toBe(
      "2025-05-01T22:03:34.000Z",
    );
  });

  it("rejects a row naming its position and field, never its value", () => {
    const base = payload();
    const result = parseSecSubmissions({
      ...base,
      filings: {
        ...base.filings,
        recent: {
          ...base.filings.recent,
          acceptanceDateTime: [
            "2025-05-01 22:03:34",
            "2025-02-21T11:01:27.000Z",
          ],
        },
      },
    });

    expect(result.ok && result.rejections).toStrictEqual([
      {
        row: 0,
        field: "acceptanceDateTime",
        accessionNumber: "0000000042-25-000003",
      },
    ]);
    expect(result.ok && result.filings).toHaveLength(1);
  });

  it("keeps an empty report date and a missing acceptance as null", () => {
    const result = parseSecFilingColumns({
      accessionNumber: ["0000000042-25-000009"],
      form: ["8-K"],
      filingDate: ["2025-06-02"],
      reportDate: [""],
      acceptanceDateTime: [""],
    });

    expect(result.ok && result.filings[0]).toMatchObject({
      reportDate: null,
      acceptedAt: null,
    });
  });

  it("quarantines columns of different lengths instead of aligning them", () => {
    const base = payload();
    const result = parseSecSubmissions({
      ...base,
      filings: {
        ...base.filings,
        recent: { ...base.filings.recent, form: ["10-Q"] },
      },
    });

    expect(result).toMatchObject({ ok: false, code: "column_length_mismatch" });
  });

  it("quarantines a payload without the filings index", () => {
    expect(parseSecSubmissions({ cik: "0000000042" })).toMatchObject({
      ok: false,
      code: "filings_missing",
    });
    expect(parseSecSubmissions([])).toMatchObject({
      ok: false,
      code: "payload_not_object",
    });
  });

  it("refuses a history file that belongs to another filer", () => {
    const base = payload();
    const result = parseSecSubmissions({
      ...base,
      filings: {
        ...base.filings,
        files: [
          {
            name: "CIK0000000043-submissions-001.json",
            filingFrom: "2009-01-02",
            filingTo: "2015-07-22",
          },
        ],
      },
    });

    expect(result).toMatchObject({ ok: false, code: "history_files_invalid" });
  });

  it("refuses a history file name that is not the declared shape", () => {
    const base = payload();
    const result = parseSecSubmissions({
      ...base,
      filings: {
        ...base.filings,
        files: [
          {
            name: "../files/company_tickers.json",
            filingFrom: "2009-01-02",
            filingTo: "2015-07-22",
          },
        ],
      },
    });

    expect(result).toMatchObject({ ok: false, code: "history_files_invalid" });
  });
});

describe("normalizeCik", () => {
  it.each([
    [320193, "0000320193"],
    ["0000320193", "0000320193"],
    ["42", "0000000042"],
  ])("normalizes %j", (value, expected) => {
    expect(normalizeCik(value)).toBe(expected);
  });

  it.each([0, -1, 1.5, "", "12345678901", "abc", null])(
    "refuses %j",
    (value) => {
      expect(normalizeCik(value)).toBeNull();
    },
  );
});
