import { describe, expect, it } from "vitest";

import type { SecFiling } from "@/modules/fundamentals/domain/parse-sec-submissions";

import {
  judgeAnnualReports,
  resolveFollowedTicker,
} from "./followed-filer-eligibility";
import type { CompanyTickerAssignment } from "./universe-source-records";

const ASSIGNMENTS: readonly CompanyTickerAssignment[] = [
  {
    cik: "1099590",
    name: "MERCADOLIBRE INC",
    ticker: "MELI",
    exchange: "Nasdaq",
  },
  { cik: "1640147", name: "Snowflake Inc.", ticker: "SNOW", exchange: "NYSE" },
  {
    cik: "1046179",
    name: "TAIWAN SEMICONDUCTOR",
    ticker: "TSM",
    exchange: "NYSE",
  },
  { cik: "1000001", name: "Otc Corp", ticker: "OTCX", exchange: "OTC" },
  { cik: "1000002", name: "Alpha Corp", ticker: "DUP", exchange: "NYSE" },
  { cik: "1000003", name: "Beta Corp", ticker: "DUP", exchange: "Nasdaq" },
];

function filing(
  form: string,
  filingDate: string,
  accession = `0000000000-${filingDate.slice(2, 4)}-000001`,
): SecFiling {
  return {
    accessionNumber: accession,
    form,
    filingDate,
    reportDate: null,
    acceptedAt: `${filingDate}T21:00:00.000Z`,
  };
}

describe("followed-filer-eligibility-1.0.0", () => {
  it("asigna el ticker con las mismas reglas que el S&P 500", () => {
    const reading = resolveFollowedTicker("MELI", ASSIGNMENTS);

    expect(reading.status).toBe("assigned");
    expect(reading.status === "assigned" && reading.constituent).toMatchObject({
      normalizedCik: "0001099590",
      legalName: "MERCADOLIBRE INC",
      venue: { mic: "XNAS", country: "US", quoteCurrency: "USD" },
    });
  });

  it("niega por nombre lo que la tabla no asigna o no resuelve", () => {
    expect(resolveFollowedTicker("NOPE", ASSIGNMENTS)).toEqual({
      status: "refused",
      reason: "issuer_not_assigned",
    });
    expect(resolveFollowedTicker("OTCX", ASSIGNMENTS)).toEqual({
      status: "refused",
      reason: "unmapped_venue",
    });
    expect(resolveFollowedTicker("DUP", ASSIGNMENTS)).toEqual({
      status: "refused",
      reason: "ambiguous_issuer",
    });
  });

  it("acepta un 10-K reciente y nombra el informe", () => {
    expect(
      judgeAnnualReports(
        [
          filing("10-Q", "2026-10-30"),
          filing("10-K", "2026-02-20"),
          filing("10-K/A", "2026-04-01"),
        ],
        "2026-11-18",
      ),
    ).toEqual({
      status: "eligible",
      accessionNumber: "0000000000-26-000001",
      form: "10-K",
      filingDate: "2026-02-20",
    });
  });

  it("niega a un emisor privado extranjero por su último anual", () => {
    expect(
      judgeAnnualReports(
        [filing("10-K", "2023-03-01"), filing("20-F", "2026-04-10")],
        "2026-11-18",
      ),
    ).toEqual({ status: "refused", reason: "foreign_private_issuer" });
    expect(
      judgeAnnualReports([filing("40-F", "2026-03-10")], "2026-11-18"),
    ).toEqual({ status: "refused", reason: "foreign_private_issuer" });
  });

  it("acepta el 20-F sólo de un CIK que el owner declaró (F6-55)", () => {
    const spotify = "0001639920";
    expect(
      judgeAnnualReports(
        [filing("20-F", "2026-02-10"), filing("6-K", "2026-10-21")],
        "2026-11-25",
        spotify,
      ),
    ).toMatchObject({ status: "eligible", form: "20-F" });
    expect(
      judgeAnnualReports(
        [filing("20-F", "2026-02-10")],
        "2026-11-25",
        "0000000042",
      ),
    ).toEqual({ status: "refused", reason: "foreign_private_issuer" });
    // Declarar un 20-F no admite un 40-F, ni un 20-F viejo.
    expect(
      judgeAnnualReports([filing("40-F", "2026-02-10")], "2026-11-25", spotify),
    ).toEqual({ status: "refused", reason: "foreign_private_issuer" });
    expect(
      judgeAnnualReports([filing("20-F", "2024-02-10")], "2026-11-25", spotify),
    ).toEqual({ status: "refused", reason: "annual_report_stale" });
  });

  it("acepta a quien pasó de 20-F a 10-K", () => {
    expect(
      judgeAnnualReports(
        [filing("40-F", "2024-02-13"), filing("10-K", "2026-02-12")],
        "2026-11-18",
      ).status,
    ).toBe("eligible");
  });

  it("niega sin anual o con un anual de hace más de 18 meses", () => {
    expect(
      judgeAnnualReports([filing("8-K", "2026-11-01")], "2026-11-18"),
    ).toEqual({ status: "refused", reason: "no_annual_report" });
    expect(
      judgeAnnualReports([filing("10-K", "2025-05-01")], "2026-11-18"),
    ).toEqual({ status: "refused", reason: "annual_report_stale" });
    expect(
      judgeAnnualReports([filing("10-K", "2025-05-20")], "2026-11-18").status,
    ).toBe("eligible");
  });
});
