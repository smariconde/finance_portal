import { describe, expect, it } from "vitest";

import { applyNewYorkOffsetTwice } from "../infrastructure/fixture-sec-filer";
import {
  buildAnnualReportUrl,
  locateLatestAnnualReport,
} from "./sec-annual-report";

const CIK = "0000320193";

function submissions(
  rows: ReadonlyArray<
    [form: string, accession: string, accepted: string, document: string]
  >,
) {
  return {
    filings: {
      recent: {
        form: rows.map((row) => row[0]),
        accessionNumber: rows.map((row) => row[1]),
        acceptanceDateTime: rows.map((row) => row[2]),
        primaryDocument: rows.map((row) => row[3]),
        reportDate: rows.map(() => "2025-09-27"),
      },
    },
  };
}

describe("locateLatestAnnualReport", () => {
  const payload = submissions([
    ["10-Q", "0000320193-26-000010", "2026-05-01T20:00:00.000Z", "q.htm"],
    ["10-K/A", "0000320193-26-000002", "2026-01-20T20:00:00.000Z", "ka.htm"],
    [
      "10-K",
      "0000320193-25-000079",
      "2025-10-31T20:01:00.000Z",
      "aapl-20250927.htm",
    ],
    [
      "10-K",
      "0000320193-24-000123",
      "2024-11-01T20:00:00.000Z",
      "aapl-20240928.htm",
    ],
  ]);

  it("takes the latest original 10-K accepted by the cutoff", () => {
    const result = locateLatestAnnualReport(
      payload,
      CIK,
      "2026-10-15T00:00:00.000Z",
    );

    expect(result).toEqual({
      status: "found",
      report: {
        cik: CIK,
        accessionNumber: "0000320193-25-000079",
        acceptedAt: "2025-10-31T20:01:00.000Z",
        reportDate: "2025-09-27",
        primaryDocument: "aapl-20250927.htm",
        url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
      },
    });
  });

  it("does not see a 10-K accepted after the cutoff", () => {
    const result = locateLatestAnnualReport(
      payload,
      CIK,
      "2025-10-31T20:00:59.000Z",
    );

    expect(result.status === "found" && result.report.accessionNumber).toBe(
      "0000320193-24-000123",
    );
  });

  it("refuses a primary document that could leave the filing directory", () => {
    const hostile = submissions([
      [
        "10-K",
        "0000320193-25-000079",
        "2025-10-31T20:01:00.000Z",
        "../../index.json",
      ],
      ["10-K", "0000320193-24-000123", "2024-11-01T20:00:00.000Z", "a/b.htm"],
    ]);

    expect(
      locateLatestAnnualReport(hostile, CIK, "2026-10-15T00:00:00.000Z"),
    ).toEqual({
      status: "not_found",
      reason: "no_annual_report_known",
    });
  });

  describe("acceptance clock (ADR 0036)", () => {
    // Form 4 a las 18:30 de Nueva York: la evidencia de que el archivo está
    // corrido cuando la SEC aplica el offset dos veces.
    const evenings = Array.from(
      { length: 8 },
      (_, index) =>
        [
          "4",
          `0000320193-26-00090${index}`,
          `2026-03-0${index + 1}T23:30:00.000Z`,
          "form4.xml",
        ] as [string, string, string, string],
    );
    // Aceptado a las 18:44:31 de Nueva York; la SEC lo publica a las 23:44:31.
    const annual: [string, string, string, string] = [
      "10-K",
      "0000320193-26-000004",
      "2026-02-05T23:44:31.000Z",
      "annual.htm",
    ];
    const shifted = (rows: (typeof annual)[]) =>
      submissions(
        rows.map(
          ([form, accession, accepted, document]) =>
            [form, accession, applyNewYorkOffsetTwice(accepted), document] as [
              string,
              string,
              string,
              string,
            ],
        ),
      );

    it("reads the true acceptance, so a cutoff between it and the shifted one already sees the 10-K", () => {
      const result = locateLatestAnnualReport(
        shifted([annual, ...evenings]),
        CIK,
        // Una hora después de la aceptación real, cuatro antes de la publicada.
        "2026-02-06T00:44:31.000Z",
      );

      expect(result).toMatchObject({
        status: "found",
        report: {
          accessionNumber: "0000320193-26-000004",
          acceptedAt: "2026-02-05T23:44:31.000Z",
        },
      });
    });

    it("locates nothing in a file whose clock it cannot decide", () => {
      const result = locateLatestAnnualReport(
        submissions([
          annual,
          ...evenings.map(
            ([form, accession, , document]) =>
              [form, accession, "2026-03-02T09:30:00.000Z", document] as [
                string,
                string,
                string,
                string,
              ],
          ),
        ]),
        CIK,
        "2026-10-15T00:00:00.000Z",
      );

      expect(result).toEqual({
        status: "not_found",
        reason: "acceptance_clock_undetermined",
      });
    });
  });

  it("names a payload without the columns it reads", () => {
    expect(
      locateLatestAnnualReport({}, CIK, "2026-10-15T00:00:00.000Z"),
    ).toEqual({
      status: "not_found",
      reason: "columns_missing",
    });
  });

  it("builds the archive URL without the accession dashes or CIK padding", () => {
    expect(
      buildAnnualReportUrl(
        "0000034088",
        "0000034088-26-000045",
        "xom-20251231.htm",
      ),
    ).toBe(
      "https://www.sec.gov/Archives/edgar/data/34088/000003408826000045/xom-20251231.htm",
    );
  });
});
