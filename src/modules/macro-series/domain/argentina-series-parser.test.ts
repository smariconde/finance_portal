import { describe, expect, it } from "vitest";

import { DECLARED_ARGENTINA_INDICATORS } from "./declared-argentina-indicators";
import {
  argentinaSeriesPageUrl,
  parseArgentinaSeriesPage,
} from "./argentina-series-parser";

const indicator = DECLARED_ARGENTINA_INDICATORS.find(
  (item) => item.sourceId === "argentina-series-tiempo",
)!;

function payload(data: unknown, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    data,
    count: 2,
    meta: [
      { frequency: "month", start_date: "2025-01-01", end_date: "2025-02-01" },
      {
        dataset: { source: "Synthetic INDEC" },
        field: { id: indicator.externalId, units: indicator.unit },
      },
    ],
    params: { ids: indicator.externalId },
    ...overrides,
  });
}

describe("Argentina Series API parser", () => {
  it("keeps decimal text exact, including a value past double precision", () => {
    const body = payload([
      ["2025-01-01", 1.25],
      ["2025-02-01", 2],
    ]).replace("1.25", "12345678901234567890.125");
    expect(parseArgentinaSeriesPage(body, indicator)).toEqual({
      ok: true,
      page: {
        total: 2,
        sourceName: "Synthetic INDEC",
        points: [
          { periodOn: "2025-01-01", value: "12345678901234567890.125" },
          { periodOn: "2025-02-01", value: "2" },
        ],
      },
    });
  });

  it("preserves a reported null and rejects a changed basis", () => {
    expect(
      parseArgentinaSeriesPage(payload([["2025-01-01", null]]), indicator),
    ).toMatchObject({
      ok: true,
      page: { points: [{ value: null }] },
    });
    const changed = payload([["2025-01-01", 1]], {
      meta: [
        {
          frequency: "month",
          start_date: "2025-01-01",
          end_date: "2025-01-01",
        },
        {
          dataset: { source: "Synthetic INDEC" },
          field: { id: indicator.externalId, units: "new base" },
        },
      ],
    });
    expect(parseArgentinaSeriesPage(changed, indicator)).toEqual({
      ok: false,
      reason: "metadata_mismatch",
    });
  });

  it("rejects a broken envelope and reordered periods", () => {
    expect(parseArgentinaSeriesPage("{", indicator)).toEqual({
      ok: false,
      reason: "invalid_json",
    });
    expect(
      parseArgentinaSeriesPage(payload([["2025-01-01", "1"]]), indicator),
    ).toEqual({ ok: false, reason: "schema_changed" });
    expect(
      parseArgentinaSeriesPage(
        payload([
          ["2025-02-01", 2],
          ["2025-01-01", 1],
        ]),
        indicator,
      ),
    ).toEqual({ ok: false, reason: "unexpected_order" });
    expect(
      parseArgentinaSeriesPage(
        payload([["2025-01-01", 1]], { params: { ids: "another" } }),
        indicator,
      ),
    ).toEqual({ ok: false, reason: "metadata_mismatch" });
  });

  it("builds only bounded URLs for a declared identifier", () => {
    expect(argentinaSeriesPageUrl(indicator.externalId, 0)).toContain(
      "limit=1000",
    );
    expect(() => argentinaSeriesPageUrl("../other", 0)).toThrow(
      "invalid_series_request",
    );
    expect(() => argentinaSeriesPageUrl(indicator.externalId, -1)).toThrow(
      "invalid_series_request",
    );
  });
});
