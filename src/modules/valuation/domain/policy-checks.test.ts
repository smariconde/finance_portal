import { describe, expect, it } from "vitest";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { zeroDebtEvidenceFixture } from "../infrastructure/zero-debt-evidence-fixtures";
import { computeFcff } from "./fcff";
import {
  assertNoRejections,
  checkValuationInput,
  checkValuationOutput,
  failedChecks,
  hasValidTerminalSpread,
  isGrowthWithinRiskFree,
  TERMINAL_SPREAD_BUFFER,
} from "./policy-checks";
import { marginalTaxRateOf } from "./cost-of-capital";
import { parseDecimal } from "./decimal-policy";
import { buildNormalization, type NormalizationFacts } from "./normalization";
import { isValuationPolicyError } from "./valuation-error";
import { valuationInputSchema, type ValuationInput } from "./valuation-input";

function draft(mutate: (input: ValuationInput) => void): ValuationInput {
  const candidate = structuredClone(DEMO_VALUATION_INPUT);
  mutate(candidate);

  return valuationInputSchema.parse(candidate);
}

function failed(input: ValuationInput, id: string) {
  return checkValuationInput(input).find((check) => check.id === id);
}

describe("valuation policy checks", () => {
  it("passes every check on the demo snapshot", () => {
    const checks = checkValuationInput(DEMO_VALUATION_INPUT);

    expect(checks.every((check) => check.status === "passed")).toBe(true);
    expect(() => assertNoRejections(checks)).not.toThrowError();
  });

  it("rejects a rigor level written by hand instead of derived", () => {
    const input = draft((candidate) => {
      candidate.assessment.rigor = {
        ...candidate.assessment.rigor,
        level: "full",
        degradedBy: [],
        declarations: [],
      };
    });

    expect(failed(input, "rigor_derived_from_completeness")).toMatchObject({
      status: "failed",
      subjects: ["assessment.rigor"],
    });
  });

  it("rejects a run whose profile or method the selector did not choose", () => {
    const input = draft((candidate) => {
      candidate.assessment.selection.assetProfile = "cyclical";
    });

    expect(failed(input, "method_selection_admits_run")?.status).toBe("failed");
  });

  it("rejects an unsupported rigor level, even when it is correctly derived", () => {
    const input = draft((candidate) => {
      candidate.assessment.completeness.checks[0] = {
        check: "structural_inputs",
        status: "partial",
        missing: ["income_tax"],
        measures: { present: 3, required: 4 },
      };
      candidate.assessment.rigor = {
        version: "rigor-level-1.0.0",
        level: "unsupported",
        degradedBy: ["structural_inputs"],
        declarations: [],
      };
    });

    expect(failed(input, "rigor_derived_from_completeness")?.status).toBe(
      "passed",
    );
    expect(failed(input, "rigor_admits_valuation")?.status).toBe("failed");
  });

  it("rejects a raw WACC that the dated cost of capital does not derive", () => {
    const input = draft((candidate) => {
      for (const period of candidate.periods) period.wacc = "0.1";
    });

    const check = failed(input, "wacc_built_from_components");
    expect(check?.status).toBe("failed");
    // El primer período no arranca en el WACC construido y ninguno queda en el
    // camino entre ese WACC y el terminal.
    expect(check?.subjects).toEqual([
      "periods.0.wacc",
      ...input.periods.map(
        (period) => `periods.${period.periodIndex - 1}.wacc`,
      ),
    ]);
  });

  it("rejects a derived WACC edited without its components", () => {
    const input = draft((candidate) => {
      candidate.costOfCapital.derived.wacc = "0.08";
    });

    expect(failed(input, "wacc_built_from_components")?.subjects).toContain(
      "costOfCapital.derived",
    );
  });

  it("rejects an operations mix added to the snapshot without rebuilding the premium", () => {
    const input = draft((candidate) => {
      candidate.costOfCapital.operationsExposure = {
        source: "ai_proposal",
        proposalId: "00000000-0000-4000-8000-0000000000a1",
        weightsVersion: "operations-mix-weights-1.0.0",
        exposures: [
          {
            exposureKeys: ["argentina"],
            weight: "1",
            components: [
              {
                datasetId: "damodaran.country-risk",
                releaseId: "00000000-0000-4000-8000-0000000000c1",
                rowKey: "argentina",
                countryRiskPremium: "0.0928",
                gdpMillions: "638365",
              },
            ],
          },
        ],
      };
    });

    expect(failed(input, "wacc_built_from_components")?.subjects).toContain(
      "costOfCapital.derived",
    );
  });

  it("rejects a cost of capital in another currency than the valuation", () => {
    const input = draft((candidate) => {
      candidate.currency = "EUR";
      for (const key of [
        "excessCash",
        "nonOperatingAssets",
        "debt",
        "minorityInterest",
        "otherClaims",
      ] as const) {
        const amount = candidate.bridge[key].amount;
        if (amount !== null) amount.currency = "EUR";
      }
      candidate.baseRevenue.currency = "EUR";
    });

    expect(failed(input, "wacc_built_from_components")?.subjects).toContain(
      "costOfCapital.currency",
    );
  });

  it("rejects a claim denominated in another currency", () => {
    const input = draft((candidate) => {
      candidate.bridge.debt.amount!.currency = "ARS";
    });

    expect(failed(input, "currency_and_unit_consistency")).toMatchObject({
      mode: "reject",
      status: "failed",
      subjects: ["bridge.debt.amount"],
    });
  });

  it("rejects a missing claim rather than reading it as zero", () => {
    const input = draft((candidate) => {
      candidate.bridge.otherClaims = {
        status: "missing",
        amount: null,
        rationale: null,
      };
    });

    expect(failed(input, "required_inputs_present")).toMatchObject({
      mode: "reject",
      status: "failed",
      subjects: ["bridge.otherClaims"],
    });
  });

  it.each(["0", "-1"])("rejects a share count of %s", (shares) => {
    const input = draft((candidate) => {
      candidate.employeeEquity.derived.shareCount = shares;
    });

    // Escrito a mano no coincide con lo derivado, y además no es positivo.
    expect(failed(input, "employee_equity_recomputed")?.status).toBe("failed");
    expect(failed(input, "share_count_positive")?.status).toBe("failed");
  });

  it("rejects a terminal wacc that does not clear growth by the buffer", () => {
    const atBuffer = draft((candidate) => {
      candidate.terminal.growth = "0.02";
      candidate.terminal.wacc = "0.025";
    });
    const overBuffer = draft((candidate) => {
      candidate.terminal.growth = "0.02";
      candidate.terminal.wacc = "0.0251";
    });

    // El borde es estricto: exactamente `g + buffer` no alcanza.
    expect(failed(atBuffer, "terminal_growth_versus_wacc")?.status).toBe(
      "failed",
    );
    expect(failed(overBuffer, "terminal_growth_versus_wacc")?.status).toBe(
      "passed",
    );
    expect(TERMINAL_SPREAD_BUFFER).toBe("0.005");
  });

  it("exposes the same spread rule the sensitivity grid uses", () => {
    expect(
      hasValidTerminalSpread(
        parseDecimal("0.03", "w"),
        parseDecimal("0.02", "g"),
      ),
    ).toBe(true);
    expect(
      hasValidTerminalSpread(
        parseDecimal("0.03", "w"),
        parseDecimal("0.03", "g"),
      ),
    ).toBe(false);
  });

  it("rejects a terminal growth above the risk-free rate of the run", () => {
    // La libre de riesgo de FixtureCo es 0,04: el bono a 0,04 sin default
    // spread del soberano. El WACC terminal (0,09) sigue despejando el buffer,
    // así que lo único que falla es la regla económica.
    expect(DEMO_VALUATION_INPUT.costOfCapital.derived.riskFree).toBe("0.04");

    const atRiskFree = draft((candidate) => {
      candidate.terminal.growth = "0.04";
    });
    const aboveRiskFree = draft((candidate) => {
      candidate.terminal.growth = "0.0401";
    });

    // El borde es inclusivo: crecer exactamente a la libre de riesgo se admite.
    expect(
      failed(atRiskFree, "terminal_growth_versus_risk_free"),
    ).toMatchObject({ mode: "reject", status: "passed" });
    expect(
      failed(aboveRiskFree, "terminal_growth_versus_risk_free"),
    ).toMatchObject({
      mode: "reject",
      status: "failed",
      subjects: ["terminal.growth", "costOfCapital.derived.riskFree"],
    });
    expect(failed(aboveRiskFree, "terminal_growth_versus_wacc")?.status).toBe(
      "passed",
    );
  });

  it("binds growth even when the buffer against the wacc would allow it", () => {
    // WACC terminal muy alto: el buffer no ve nada raro en g = 0,06, pero
    // ninguna empresa crece a perpetuidad por encima de su economía.
    const input = draft((candidate) => {
      candidate.terminal.growth = "0.06";
      candidate.terminal.wacc = "0.2";
    });

    expect(failed(input, "terminal_growth_versus_wacc")?.status).toBe("passed");
    expect(failed(input, "terminal_growth_versus_risk_free")?.status).toBe(
      "failed",
    );
    expect(() => assertNoRejections(checkValuationInput(input))).toThrowError(
      /terminal_growth_versus_risk_free/,
    );
  });

  it("reads the ceiling from the cost of capital, not from a constant", () => {
    // Una libre de riesgo editada a mano también rompe el WACC recalculado;
    // acá sólo importa que el techo de `g` se mueva con ella.
    const input = draft((candidate) => {
      candidate.costOfCapital.derived.riskFree = "0.015";
    });

    expect(failed(input, "terminal_growth_versus_risk_free")?.status).toBe(
      "failed",
    );
    expect(failed(input, "wacc_built_from_components")?.status).toBe("failed");
  });

  it("holds a negative risk-free rate to the same ceiling", () => {
    const riskFree = parseDecimal("-0.005", "rf");

    expect(isGrowthWithinRiskFree(parseDecimal("0", "g"), riskFree)).toBe(
      false,
    );
    expect(isGrowthWithinRiskFree(parseDecimal("-0.005", "g"), riskFree)).toBe(
      true,
    );
    expect(isGrowthWithinRiskFree(parseDecimal("-0.01", "g"), riskFree)).toBe(
      true,
    );
  });

  it("rejects a bridge debt or cash that the normalized facts do not derive", () => {
    const debt = draft((candidate) => {
      candidate.bridge.debt.amount!.value = "31000000";
    });
    const cash = draft((candidate) => {
      candidate.bridge.excessCash.amount!.value = "9000000";
    });

    expect(failed(debt, "normalization_recomputed")).toMatchObject({
      mode: "reject",
      status: "failed",
      subjects: ["bridge.debt"],
    });
    expect(failed(cash, "normalization_recomputed")?.subjects).toStrictEqual([
      "bridge.excessCash",
    ]);
  });

  it("rejects a normalized base edited without its facts", () => {
    const input = draft((candidate) => {
      candidate.normalization.investedCapital = {
        ...candidate.normalization.investedCapital,
        reported: "1",
      } as typeof candidate.normalization.investedCapital;
    });

    expect(failed(input, "normalization_recomputed")?.subjects).toStrictEqual([
      "normalization.investedCapital",
    ]);
  });

  it("does not let an unresolved debt reach the bridge as reported", () => {
    // Sin receta de deuda, la claim no puede llevar un monto: queda `missing`
    // —que se rechaza aparte— o declarada ausente por el owner.
    const withoutDebt = (
      claim: ValuationInput["bridge"]["debt"],
    ): ValuationInput =>
      draft((candidate) => {
        const facts: NormalizationFacts = structuredClone(
          candidate.normalization.facts,
        );
        facts.balance.debt.longTermTotal = null;
        candidate.normalization = buildNormalization(facts, {
          baseRevenue: candidate.baseRevenue.value,
          marginalTaxRate: marginalTaxRateOf(candidate.costOfCapital),
          capitalization: candidate.capitalization,
        });
        candidate.bridge.debt = claim;
      });

    const reported = withoutDebt(DEMO_VALUATION_INPUT.bridge.debt);
    const missing = withoutDebt({
      status: "missing",
      amount: null,
      rationale: null,
    });
    const declared = withoutDebt({
      status: "declared_absent",
      amount: null,
      rationale: "El owner verificó en el 10-K que no hay deuda financiera.",
    });

    expect(reported.normalization.debt.status).toBe("unresolved");
    expect(
      failed(reported, "normalization_recomputed")?.subjects,
    ).toStrictEqual(["bridge.debt"]);
    expect(failed(missing, "normalization_recomputed")?.status).toBe("passed");
    expect(failed(missing, "required_inputs_present")?.status).toBe("failed");
    expect(failed(declared, "normalization_recomputed")?.status).toBe("passed");
    expect(failed(declared, "required_inputs_present")?.status).toBe("passed");
  });

  describe("zero-debt evidence", () => {
    const band = DEMO_VALUATION_INPUT.costOfCapital.parameters.find(
      (parameter) => parameter.name === "company_default_spread",
    )!;
    const floor = {
      value: "8.5",
      datasetId: band.datasetId,
      releaseId: band.releaseId,
      rowKey: band.rowKey,
      availableAt: band.availableAt,
    };

    const withEvidence = (
      mutate: (candidate: ValuationInput) => void = () => {},
      options: { interest?: string; floor?: typeof floor } = {},
    ): ValuationInput =>
      draft((candidate) => {
        const facts: NormalizationFacts = structuredClone(
          candidate.normalization.facts,
        );
        for (const key of Object.keys(
          facts.balance.debt,
        ) as (keyof NormalizationFacts["balance"]["debt"])[]) {
          facts.balance.debt[key] = null;
        }
        facts.zeroDebtEvidence = zeroDebtEvidenceFixture(
          facts.baseFiscalYearEnd,
          { floor: options.floor ?? floor, interest: options.interest },
        );
        candidate.normalization = buildNormalization(facts, {
          baseRevenue: candidate.baseRevenue.value,
          marginalTaxRate: marginalTaxRateOf(candidate.costOfCapital),
          capitalization: candidate.capitalization,
        });
        candidate.bridge.debt = {
          status: "declared_absent",
          amount: null,
          rationale:
            "zero-debt-evidence-1.0.0: no borrowing in five fiscal years.",
        };
        mutate(candidate);
      });

    it("values debt at zero, declared, against the run's own top band", () => {
      const input = withEvidence();

      expect(input.normalization.debt.status).toBe("zero_with_evidence");
      expect(failed(input, "zero_debt_evidence_consistent")?.status).toBe(
        "passed",
      );
      expect(failed(input, "normalization_recomputed")?.status).toBe("passed");
      expect(failed(input, "required_inputs_present")?.status).toBe("passed");
    });

    it("never reports an amount nobody published", () => {
      const input = withEvidence((candidate) => {
        candidate.bridge.debt = DEMO_VALUATION_INPUT.bridge.debt;
      });

      expect(failed(input, "normalization_recomputed")?.subjects).toEqual([
        "bridge.debt",
      ]);
    });

    it("rejects a floor from a band the run did not use", () => {
      const input = withEvidence(() => {}, {
        floor: { ...floor, rowKey: "large-nonfinancial-aa" },
      });

      expect(failed(input, "zero_debt_evidence_consistent")?.subjects).toEqual([
        "normalization.facts.zeroDebtEvidence.coverageFloor",
      ]);
    });

    it("admits a no-interest coverage only with evidence that has no interest", () => {
      const noInterest = (candidate: ValuationInput) => {
        candidate.costOfCapital.coverage = {
          ...candidate.costOfCapital.coverage,
          value: floor.value,
          fiscalYearEnd: candidate.normalization.facts.baseFiscalYearEnd,
          fromLatestFiscalYear: true,
          interestBasis: "no_interest_expense",
        };
      };
      const consistent = withEvidence(noInterest);
      const charged = withEvidence(noInterest, { interest: "2.5" });
      const unsupported = draft(noInterest);

      expect(failed(consistent, "zero_debt_evidence_consistent")?.status).toBe(
        "passed",
      );
      expect(
        failed(charged, "zero_debt_evidence_consistent")?.subjects,
      ).toEqual(["costOfCapital.coverage"]);
      expect(
        failed(unsupported, "zero_debt_evidence_consistent")?.subjects,
      ).toEqual(["normalization.facts.zeroDebtEvidence"]);
    });

    it("adds no check to a run without evidence", () => {
      expect(
        failed(DEMO_VALUATION_INPUT, "zero_debt_evidence_consistent"),
      ).toBeUndefined();
    });
  });

  it("rejects a terminal reinvestment the growth cannot sustain", () => {
    const impossible = draft((candidate) => {
      candidate.terminal.growth = "0.10";
      candidate.terminal.wacc = "0.12";
      candidate.terminal.returnOnCapital = "0.05";
    });
    const undefinedRate = draft((candidate) => {
      candidate.terminal.returnOnCapital = "0";
    });

    // 0,10 / 0,05 = 2: reinvertir el doble del NOPAT no es un supuesto.
    expect(failed(impossible, "terminal_reinvestment_coherence")?.status).toBe(
      "failed",
    );
    // Un ROIC terminal de cero no produce Infinity: produce un rechazo.
    expect(
      failed(undefinedRate, "terminal_reinvestment_coherence")?.status,
    ).toBe("failed");
  });

  it("rejects a non positive sales-to-capital", () => {
    const input = draft((candidate) => {
      candidate.periods[2]!.reinvestment = {
        convention: "sales_to_capital",
        salesToCapital: "0",
      };
    });

    expect(failed(input, "sales_to_capital_positive")).toMatchObject({
      status: "failed",
      subjects: ["periods.2.reinvestment"],
    });
  });

  it("rejects a wacc that leaves the discount factor undefined", () => {
    const input = draft((candidate) => {
      candidate.periods[0]!.wacc = "-1";
    });

    expect(failed(input, "discount_factor_defined")).toMatchObject({
      status: "failed",
      subjects: ["periods.0.wacc"],
    });
  });

  it("rejects mixed reinvestment conventions unless a bridge is recorded", () => {
    const unbridged = draft((candidate) => {
      candidate.periods[4]!.reinvestment = {
        convention: "return_on_capital",
        returnOnCapital: "0.14",
      };
      candidate.reinvestmentConventionBridge = null;
    });
    const bridged = draft((candidate) => {
      candidate.periods[4]!.reinvestment = {
        convention: "return_on_capital",
        returnOnCapital: "0.14",
      };
      candidate.reinvestmentConventionBridge =
        "El último período pasa a growth/ROIC porque converge al estado estable.";
    });

    expect(failed(unbridged, "reinvestment_convention_bridge")?.status).toBe(
      "failed",
    );
    expect(failed(bridged, "reinvestment_convention_bridge")?.status).toBe(
      "passed",
    );
  });

  it("asks for review instead of rejecting an out of range tax rate", () => {
    const input = draft((candidate) => {
      candidate.periods[1]!.taxRate = "0.7";
    });
    const check = failed(input, "tax_rate_range");

    expect(check).toMatchObject({
      mode: "require_review",
      status: "failed",
      subjects: ["periods.1.taxRate"],
    });
    expect(() =>
      assertNoRejections(checkValuationInput(input)),
    ).not.toThrowError();
  });

  it("asks for review on a terminal margin without sector evidence", () => {
    const input = draft((candidate) => {
      candidate.terminal.ebitMargin = "0.9";
    });

    expect(failed(input, "terminal_margin_range")).toMatchObject({
      mode: "require_review",
      status: "failed",
    });
  });

  it("flags a terminal value that carries most of the answer", () => {
    const heavy = draft((candidate) => {
      candidate.terminal.growth = "0.045";
      candidate.terminal.wacc = "0.055";
    });
    const checks = checkValuationOutput(computeFcff(heavy));

    expect(
      checks.find((check) => check.id === "terminal_value_share"),
    ).toMatchObject({ mode: "require_review", status: "failed" });
  });

  it("flags a non positive equity value instead of hiding it", () => {
    const indebted = draft((candidate) => {
      candidate.bridge.debt.amount!.value = "500000000";
    });
    const checks = checkValuationOutput(computeFcff(indebted));

    expect(
      checks.find((check) => check.id === "equity_value_positive"),
    ).toMatchObject({ mode: "require_review", status: "failed" });
  });

  it("stops the run naming the failed checks and their field paths", () => {
    const input = draft((candidate) => {
      candidate.employeeEquity.derived.shareCount = "0";
      candidate.bridge.debt.amount!.currency = "ARS";
    });
    const checks = checkValuationInput(input);

    expect(failedChecks(checks, "reject")).toHaveLength(3);

    try {
      assertNoRejections(checks);
      throw new Error("Expected the rejections to stop the run.");
    } catch (error) {
      expect(isValuationPolicyError(error, "policy_check_failed")).toBe(true);
      expect((error as Error).message).toContain("share_count_positive");
      expect((error as { subjects: string[] }).subjects).toStrictEqual([
        "employeeEquity.derived",
        "bridge.debt.amount",
        "employeeEquity.derived.shareCount",
      ]);
    }
  });
});
