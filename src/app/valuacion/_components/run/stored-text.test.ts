import { describe, expect, it } from "vitest";

import {
  deriveAssumptions,
  DERIVED_ASSUMPTIONS_V3_VERSION,
  selectConsensusRevenue,
} from "@/modules/valuation/domain/derived-assumptions";
import { DEMO_VALUATION_INPUT } from "@/modules/valuation/infrastructure/demo-valuation-fixtures";

import {
  NONCONTROLLING_INTEREST_EVIDENCE_VERSION,
  noncontrollingInterestRationale,
} from "@/modules/valuation/domain/noncontrolling-interest-evidence";

import { storedTextEs } from "./stored-text";

describe("storedTextEs", () => {
  it("translates a stored thesis by exact body", () => {
    expect(
      storedTextEs(
        "Growth at the weakest measured rate and no excess returns after year 10.",
      ),
    ).toBe(
      "Crecimiento a la tasa más baja medida en su historia y sin retornos extraordinarios después del año 10.",
    );
  });

  it("keeps the rule version that wrote the text at the end", () => {
    expect(
      storedTextEs(
        "derived-assumptions-2.0.0: no recipe separates non-operating assets; valued at zero and named.",
      ),
    ).toBe(
      "Ninguna receta separa activos no operativos; se valúan en cero y se dice. (derived-assumptions-2.0.0)",
    );
  });

  it("translates the noncontrolling-interest evidence the rule writes", () => {
    expect(
      storedTextEs(
        noncontrollingInterestRationale({
          status: "zero",
          version: NONCONTROLLING_INTEREST_EVIDENCE_VERSION,
          accessionNumber: "0001403161-26-000134",
          asOf: "2026-09-30",
          total: "36111000000",
          components: 5,
        }),
      ),
    ).toBe(
      "El estado de patrimonio del filing 0001403161-26-000134 al 2026-09-30 suma 5 componentes hasta el total, sin participaciones no controlantes; se valúan en cero y se dice. (noncontrolling-interest-evidence-1.0.0)",
    );
  });

  it("carries variable parts into the translation", () => {
    expect(
      storedTextEs(
        "zero-debt-evidence-1.0.0: no borrowing or scheduled debt maturity in the last 5 fiscal years, and interest is absent or within the top rating band; valued at zero and named.",
      ),
    ).toContain("en los últimos 5 ejercicios");
  });

  it("translates every text the consensus scenarios store (F6-39)", () => {
    const result = deriveAssumptions({
      derivation: {
        version: DERIVED_ASSUMPTIONS_V3_VERSION,
        revenueHistory: [
          { fiscalYearEnd: "2024-12-31", value: "96000000" },
          { fiscalYearEnd: "2023-12-31", value: "90000000" },
          { fiscalYearEnd: "2022-12-31", value: "80000000" },
        ],
        industryReturn: null,
        consensus: selectConsensusRevenue({
          years: [
            {
              periodEnd: "2025-12-31",
              revenueAverage: "105600000",
              revenueLow: "100800000",
              revenueHigh: "110400000",
              analystCount: 12,
              availableAt: "2025-06-29T12:00:00.000Z",
            },
            {
              periodEnd: "2026-12-31",
              revenueAverage: "116160000",
              revenueLow: "105840000",
              revenueHigh: "126960000",
              analystCount: 11,
              availableAt: "2025-06-29T12:00:00.000Z",
            },
          ],
          capturedAt: "2025-06-29T12:00:00.000Z",
          historyEnd: "2024-12-31",
          baseAsOf: "2024-12-31",
          asOf: "2025-06-30",
          currency: "USD",
        }),
      },
      baseFiscalYearEnd: "2024-12-31",
      normalization: DEMO_VALUATION_INPUT.normalization,
      costOfCapital: DEMO_VALUATION_INPUT.costOfCapital,
    });
    if (result.status !== "derived" || result.scenarios === null) {
      throw new Error("scenarios expected");
    }

    const texts = [result.scenarios.bear, result.scenarios.bull].flatMap(
      (scenario) => [
        scenario.thesis,
        ...scenario.drivers.map((driver) => driver.rationale),
      ],
    );

    for (const text of texts) expect(storedTextEs(text), text).not.toBe(text);
  });

  it("shows an unknown text as it was stored", () => {
    expect(storedTextEs("rule-1.0.0: something new.")).toBe(
      "rule-1.0.0: something new.",
    );
    expect(storedTextEs("Importe reportado por la fuente.")).toBe(
      "Importe reportado por la fuente.",
    );
  });
});
