import { describe, expect, it } from "vitest";

import {
  buildCapitalization,
  capitalizationMismatches,
} from "../domain/capitalization-bridge";
import { marginalTaxRateOf } from "../domain/cost-of-capital";
import { buildNormalization } from "../domain/normalization";
import type { MonetaryFact } from "../domain/valuation-facts";
import {
  valuationInputSchema,
  type ValuationInput,
} from "../domain/valuation-input";
import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { runValuation } from "./run-valuation";

/**
 * La capitalización en una corrida completa (`F4-01`, ADR 0037): FixtureCo con
 * arrendamientos y con I+D, sobre el snapshot demo.
 */
const RUN_ID = "11111111-2222-4333-8444-555555555555";
const run = (input: ValuationInput) =>
  runValuation(input, {
    now: () => "2026-10-19T12:00:00.000Z",
    newValuationRunId: () => RUN_ID,
  });

const fact = (value: string, asOf = "2024-12-31"): MonetaryFact => ({
  value,
  currency: "USD",
  unit: "monetary",
  asOf,
  availableAt: "2025-02-20T21:00:00.000Z",
  sourceId: DEMO_VALUATION_INPUT.baseRevenue.sourceId,
  sourceDocumentId: "fixtureco-fy2024-annual-report",
  observationId: null,
  qualityFlags: [],
});

const context = {
  baseRevenue: DEMO_VALUATION_INPUT.baseRevenue.value,
  industryKey: DEMO_VALUATION_INPUT.costOfCapital.industryKey,
  preTaxCostOfDebt: DEMO_VALUATION_INPUT.costOfCapital.derived.preTaxCostOfDebt,
};

/** Computers/peripherals: vida de 5 años, así que el base y cinco anteriores. */
const RD_YEARS = [
  "9600000",
  "9000000",
  "8400000",
  "7800000",
  "7200000",
  "6600000",
].map((value, index) => ({
  fiscalYearEnd: `${2024 - index}-12-31`,
  amount: fact(value, `${2024 - index}-12-31`),
}));

function withCapitalization(leaseDebt: string | null): ValuationInput {
  const input = structuredClone(DEMO_VALUATION_INPUT);

  input.capitalization = buildCapitalization(
    {
      baseFiscalYearEnd: "2024-12-31",
      reportedEbit: input.capitalization.reportedEbit,
      leases: {
        totalLiability: leaseDebt === null ? null : fact(leaseDebt),
        currentLiability: null,
        noncurrentLiability: null,
      },
      researchAndDevelopment: { fiscalYears: RD_YEARS },
    },
    context,
  );
  // La normalización toma sus ajustes de arrendamientos e I+D de la
  // capitalización (`F4-03`): cambiar una es reconstruir la otra.
  input.normalization = buildNormalization(input.normalization.facts, {
    baseRevenue: input.baseRevenue.value,
    marginalTaxRate: marginalTaxRateOf(input.costOfCapital),
    capitalization: input.capitalization,
  });

  if (leaseDebt !== null) {
    input.bridge.leaseDebt = {
      status: "reported",
      amount: fact(leaseDebt),
      rationale: null,
    };
  }

  return valuationInputSchema.parse(input);
}

describe("capitalization in a run", () => {
  it("builds the bridge over EBIT, invested capital and debt", () => {
    const { capitalization } = withCapitalization("8000000");

    expect(capitalization.leases.result).toMatchObject({
      status: "capitalized",
      leaseDebt: "8000000",
    });
    expect(capitalization.researchAndDevelopment.result).toMatchObject({
      status: "capitalized",
      life: { years: 5, lookupRow: "Computer & Peripherals" },
      // 9,6 + 9·4/5 + 8,4·3/5 + 7,8·2/5 + 7,2·1/5 millones.
      researchAsset: "26400000",
      // (9 + 8,4 + 7,8 + 7,2 + 6,6) / 5 millones.
      amortization: "7800000",
    });

    const interest =
      capitalization.leases.result.status === "capitalized"
        ? capitalization.leases.result.imputedInterest
        : null;

    expect(capitalization.ledger).toEqual({
      ebit: {
        reported: "17280000",
        leaseAdjustment: interest,
        rdAdjustment: "1800000",
        adjusted: String(17280000 + Number(interest) + 1800000),
        adjustedMargin: expect.any(String),
      },
      investedCapitalDelta: {
        leases: "8000000",
        researchAndDevelopment: "26400000",
        total: "34400000",
      },
      debtDelta: { leases: "8000000" },
    });
    expect(capitalizationMismatches(capitalization, context)).toEqual([]);
  });

  it("subtracts the lease debt in the EV-equity bridge", () => {
    const base = run(DEMO_VALUATION_INPUT);
    const leased = run(withCapitalization("8000000"));

    expect(leased.status).toBe("computed");
    expect(
      Number(base.result!.equityValue) - Number(leased.result!.equityValue),
    ).toBeCloseTo(8000000, 6);
    expect(
      leased.result!.bridgeComponents.find((item) => item.key === "leaseDebt"),
    ).toMatchObject({ status: "reported", sign: "subtract", value: "8000000" });
  });

  it("rejects capitalized leases that never reach the bridge", () => {
    const input = structuredClone(withCapitalization("8000000"));
    input.bridge.leaseDebt = {
      status: "declared_absent",
      amount: null,
      rationale: "Olvidada a mano.",
    };
    const outcome = run(valuationInputSchema.parse(input));

    expect(outcome.status).toBe("rejected");
    expect(outcome.failure?.message).toContain("capitalization_recomputed");
    expect(outcome.failure?.subjects).toEqual(["bridge.leaseDebt"]);
  });

  it("rejects a lease claim that differs from the capitalized liability", () => {
    const input = structuredClone(withCapitalization("8000000"));
    input.bridge.leaseDebt.amount!.value = "7000000";

    expect(run(valuationInputSchema.parse(input)).failure?.subjects).toEqual([
      "bridge.leaseDebt",
    ]);
  });

  it("rejects a research asset written by hand", () => {
    const input = structuredClone(withCapitalization(null));
    const rd = input.capitalization.researchAndDevelopment.result;

    if (rd.status === "capitalized") {
      rd.researchAsset = "1";
    }

    expect(run(valuationInputSchema.parse(input)).failure?.subjects).toEqual([
      "capitalization.researchAndDevelopment.result",
    ]);
  });

  it("rejects a lease liability from another close", () => {
    const input = structuredClone(withCapitalization("8000000"));
    input.capitalization.leases.totalLiability!.asOf = "2023-12-31";

    expect(run(valuationInputSchema.parse(input)).failure?.subjects).toContain(
      "capitalization.leases.totalLiability",
    );
  });

  it("recomputes with the run's industry: another life is another bridge", () => {
    const { capitalization } = withCapitalization(null);

    expect(
      capitalizationMismatches(capitalization, {
        ...context,
        industryKey: "software-system-and-application",
      }),
    ).toEqual([
      "capitalization.researchAndDevelopment.result",
      "capitalization.ledger",
    ]);
  });
});
