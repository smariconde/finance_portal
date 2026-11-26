import { describe, expect, it } from "vitest";

import {
  assessRiskFreeFreshness,
  DECLARED_RISK_FREE_CURVES,
  ECB_PARSER_VERSION,
  ecbSeriesUrl,
  parseEcbSeriesCsv,
  riskFreeCurveOf,
} from "./risk-free-curves";

const curve = riskFreeCurveOf("EUR")!;
const HEADER =
  "KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE";
const KEY = "YC.B.U2.EUR.4F.G_N_A.SV_C_YM.PY_10Y";
// Tasas inventadas: ninguna respuesta real entra al repositorio.
const line = (date: string, value: string, key = KEY) =>
  `${key},B,U2,EUR,4F,G_N_A,SV_C_YM,PY_10Y,${date},${value}`;

describe(ECB_PARSER_VERSION, () => {
  it("declares the euro's AAA par yield, netted with Germany", () => {
    expect(DECLARED_RISK_FREE_CURVES.map((item) => item.currency)).toEqual([
      "EUR",
    ]);
    expect(curve.sovereignCountryKey).toBe("germany");
    expect(ecbSeriesUrl(curve)).toBe(
      "https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.PY_10Y?lastNObservations=10&detail=dataonly&format=csvdata",
    );
    expect(riskFreeCurveOf("JPY")).toBeNull();
  });

  it("reads each day as a fraction keyed by its date", () => {
    const publication = parseEcbSeriesCsv(
      curve,
      [HEADER, line("2026-11-23", "3.1234"), line("2026-11-24", "3.05")].join(
        "\n",
      ) + "\n",
    );

    expect(publication).toEqual({
      ok: true,
      datasetId: "ecb.eur-aaa-par-10y",
      parserVersion: ECB_PARSER_VERSION,
      publishedLabel: "2026-11-24",
      rows: [
        {
          key: "2026-11-23",
          label: "2026-11-23",
          values: { yield: "0.031234" },
        },
        { key: "2026-11-24", label: "2026-11-24", values: { yield: "0.0305" } },
      ],
      rejections: [],
    });
  });

  it.each([
    [
      "a header that is not the data-only CSV",
      "TIME_PERIOD,OBS_VALUE",
      "ecb_header_unexpected",
    ],
    ["no observations", HEADER, "ecb_no_observations"],
    [
      "another series",
      `${HEADER}\n${line("2026-11-24", "3", "YC.B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y")}`,
      "ecb_series_mismatch",
    ],
    [
      "a quoted field",
      `${HEADER}\n${line("2026-11-24", '"3"')}`,
      "ecb_quoted_field",
    ],
    [
      "a monthly period on a daily curve",
      `${HEADER}\n${line("2026-11", "3")}`,
      "ecb_period_format",
    ],
    [
      "a value that is not a decimal",
      `${HEADER}\n${line("2026-11-24", "NaN")}`,
      "ecb_value_not_decimal",
    ],
    [
      "an implausible rate",
      `${HEADER}\n${line("2026-11-24", "31")}`,
      "ecb_value_implausible",
    ],
    [
      "dates out of order",
      `${HEADER}\n${line("2026-11-24", "3")}\n${line("2026-11-23", "3")}`,
      "ecb_periods_not_increasing",
    ],
  ])("refuses %s by name", (_label, body, code) => {
    expect(parseEcbSeriesCsv(curve, body)).toEqual({ ok: false, code });
  });
});

describe("risk-free-freshness-1.0.0", () => {
  // 2026-11-25 (miércoles) a las 23:00 UTC: la rueda del 25 ya se asentó.
  const now = "2026-11-25T23:00:00.000Z";

  it("is current with the previous business day, which the ECB publishes next noon", () => {
    expect(
      assessRiskFreeFreshness({
        curve,
        latestPeriod: "2026-11-24",
        lastCheckedAt: null,
        now,
      }),
    ).toBe("current");
    expect(
      assessRiskFreeFreshness({
        curve,
        latestPeriod: "2026-11-21",
        lastCheckedAt: null,
        now,
      }),
    ).toBe("stale");
  });

  it("is current after a check once the session settled, even with nothing new", () => {
    expect(
      assessRiskFreeFreshness({
        curve,
        latestPeriod: "2026-11-21",
        lastCheckedAt: "2026-11-25T22:30:00.000Z",
        now,
      }),
    ).toBe("current");
    expect(
      assessRiskFreeFreshness({
        curve,
        latestPeriod: null,
        lastCheckedAt: "2026-11-25T22:30:00.000Z",
        now,
      }),
    ).toBe("stale");
  });

  it("asks a monthly curve for last month, or once a day", () => {
    const monthly = { frequency: "monthly" as const };
    expect(
      assessRiskFreeFreshness({
        curve: monthly,
        latestPeriod: "2026-10",
        lastCheckedAt: null,
        now,
      }),
    ).toBe("current");
    expect(
      assessRiskFreeFreshness({
        curve: monthly,
        latestPeriod: "2026-09",
        lastCheckedAt: "2026-11-25T08:00:00.000Z",
        now,
      }),
    ).toBe("current");
    expect(
      assessRiskFreeFreshness({
        curve: monthly,
        latestPeriod: "2026-09",
        lastCheckedAt: "2026-11-24T08:00:00.000Z",
        now,
      }),
    ).toBe("stale");
  });
});
