import { describe, expect, it } from "vitest";

import {
  magypAnnualFixture,
  magypEstimacionesFixture,
} from "../infrastructure/fixture-soy-payloads";

import {
  magypEstimacionesBody,
  parseMagypAnnual,
  parseMagypEstimaciones,
  reconcileMagypEstimates,
  type MagypCampaign,
} from "./magyp-estimaciones-parser";

const estimates = magypEstimacionesFixture([
  ["2023/24", "1000000", "990000", "3000000", "3030"],
  ["2024/25", "1100000", "1080000", "3300000", "3056"],
  ["2025/26", "1050000", "1040000", "3200000", "3077"],
]);

const licensed = new TextDecoder().decode(
  magypAnnualFixture([
    ["2023", "1000000", "990000", "3000009", "3030.30"],
    ["2024", "1100000", "1080000", "3300000", "3055.56"],
  ]),
);

function campaigns(result: ReturnType<typeof parseMagypEstimaciones>) {
  if (!result.ok) throw new Error(result.reason);
  return result.campaigns;
}

describe("magyp-estimaciones-1.0.0", () => {
  it("reads latin-1 campaigns dated July 1st of their first year", () => {
    const parsed = campaigns(parseMagypEstimaciones(estimates, "Soja total"));
    expect(parsed.at(-1)).toEqual({
      firstYear: 2025,
      periodOn: "2025-07-01",
      values: {
        sown_ha: "1050000",
        harvested_ha: "1040000",
        production_t: "3200000",
        yield_kg_ha: "3077",
      },
    });
  });

  it.each([
    [
      "another crop",
      magypEstimacionesFixture([["2025/26", "1", "1", "1", "1"]], "Soja 1ra"),
      "crop_mismatch",
    ],
    [
      "a campaign that skips a year",
      magypEstimacionesFixture([
        ["2023/24", "1", "1", "1", "1"],
        ["2025/26", "1", "1", "1", "1"],
      ]),
      "unexpected_order",
    ],
    [
      "a campaign whose years do not follow",
      magypEstimacionesFixture([["2025/27", "1", "1", "1", "1"]]),
      "invalid_campaign",
    ],
    [
      "a decimal where integers come",
      magypEstimacionesFixture([["2025/26", "1", "1", "1.5", "1"]]),
      "invalid_value",
    ],
    [
      "an empty cell",
      magypEstimacionesFixture([["2025/26", "1", "", "1", "1"]]),
      "invalid_value",
    ],
    ["no rows", magypEstimacionesFixture([]), "empty"],
    [
      "an HTML page",
      new TextEncoder().encode("<!DOCTYPE html>"),
      "header_changed",
    ],
  ] as const)("refuses %s by name", (_, bytes, reason) => {
    expect(parseMagypEstimaciones(bytes, "Soja total")).toEqual({
      ok: false,
      reason,
    });
  });

  it("asks for every variable of one crop, the whole history", () => {
    const body = new URLSearchParams(magypEstimacionesBody("25"));
    expect(body.getAll("cultivo[]")).toEqual(["25"]);
    expect(body.getAll("variable[]")).toEqual([
      "Sup. Sembrada",
      "Sup. Cosechada",
      "Producción",
      "Rendimiento",
    ]);
    expect([body.get("desde"), body.get("hasta")]).toEqual(["1", "999"]);
    expect(body.get("agregacion")).toBe("Total País");
  });
});

describe("magyp-reconciliation-1.0.0", () => {
  const ours = campaigns(parseMagypEstimaciones(estimates, "Soja total"));
  const theirs = campaigns(parseMagypAnnual(licensed));

  it("accepts rounding and a few tonnes, counting the campaigns compared", () => {
    expect(reconcileMagypEstimates(ours, theirs)).toEqual({
      ok: true,
      compared: 2,
    });
  });

  it("names the campaign and variable that do not reconcile", () => {
    const moved: MagypCampaign[] = theirs.map((item) =>
      item.firstYear === 2024
        ? { ...item, values: { ...item.values, harvested_ha: "1070000" } }
        : item,
    );
    expect(reconcileMagypEstimates(ours, moved)).toEqual({
      ok: false,
      reason: "reconciliation_failed",
      campaign: "2024/25",
      variable: "harvested_ha",
    });
    const yieldOff: MagypCampaign[] = theirs.map((item) =>
      item.firstYear === 2023
        ? { ...item, values: { ...item.values, yield_kg_ha: "3029.4" } }
        : item,
    );
    expect(reconcileMagypEstimates(ours, yieldOff)).toMatchObject({
      ok: false,
      campaign: "2023/24",
      variable: "yield_kg_ha",
    });
  });

  it("refuses to call it reconciled when no campaign is shared", () => {
    expect(reconcileMagypEstimates(ours.slice(2), theirs)).toEqual({
      ok: false,
      reason: "nothing_to_reconcile",
      campaign: null,
      variable: null,
    });
  });

  it("reads the CC BY file with CRLF lines and checks its header", () => {
    expect(parseMagypAnnual(licensed.replace(/\n/gu, "\r\n")).ok).toBe(true);
    expect(parseMagypAnnual("anio,valor\n2024,1\n")).toEqual({
      ok: false,
      reason: "header_changed",
    });
  });
});
