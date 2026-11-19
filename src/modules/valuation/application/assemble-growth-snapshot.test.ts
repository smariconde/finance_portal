import { describe, expect, it } from "vitest";

import { subtractCalendarYears } from "@/modules/temporal/domain/calendar-date";

import { fixtureGrowthValuation } from "../infrastructure/fixture-growth-valuation";
import { deriveGrowthTrajectory } from "../domain/derived-growth-trajectory";
import { runValuation } from "./run-valuation";
import { replayValuationRun } from "./replay-valuation-run";
import { assembleGrowthSnapshot } from "./assemble-growth-snapshot";
import { EMPLOYEE_OPTIONS_NOT_SUBTRACTED_VERSION } from "../domain/employee-equity-claim";
import { checkValuationInput } from "../domain/policy-checks";
import type { ValuationInput } from "../domain/valuation-input";

function assemble(
  profile: "high_growth" | "loss_making",
  mutate: (foundation: ValuationInput) => void = () => {},
) {
  const foundation = fixtureGrowthValuation(profile);
  mutate(foundation);
  const baseYear = foundation.baseRevenue.asOf;
  foundation.periods = Array.from({ length: 10 }, (_, index) => ({
    ...foundation.periods[Math.min(index, 4)]!,
    periodIndex: index + 1,
    periodEnd: subtractCalendarYears(baseYear, -(index + 1)),
  }));
  const trajectory = deriveGrowthTrajectory(
    [0, 1, 2, 3].map((offset) => ({
      fiscalYearEnd: subtractCalendarYears(baseYear, offset),
      value:
        offset === 0
          ? foundation.baseRevenue.value
          : String(100000000 / 1.2 ** offset),
    })),
    foundation.terminal.growth,
  );
  if (trajectory.status !== "ready") throw new Error(trajectory.status);
  return assembleGrowthSnapshot({
    foundation,
    evidence: foundation.revenueMargin!.profileEvidence,
    trajectory: trajectory.trajectory,
    margin: {
      datasetId: "damodaran.margins-us",
      releaseId: "d5ee9466-6666-4329-9732-b9809ca4f169",
      rowKey: foundation.costOfCapital.industryKey,
      field: "pretax_lease_rd_adjusted_margin",
      value: "0.2",
      publishedLabel: "January 2025",
      availableAt: "2025-01-01T00:00:00.000Z",
      recordedAt: "2025-01-01T00:00:00.000Z",
    },
    lossCarryforward: foundation.revenueMargin!.lossCarryforward!,
    lossOffsetLimit: "0.8",
    lossPolicyRationale: "Synthetic tax note: one usable pool and annual cap.",
    financingRationale:
      "Screening assumes funding to cover the peak cash need; terms are unknown.",
    employeeEquityAvailableAt:
      foundation.revenueMargin!.employeeEquityAvailableAt,
  });
}

describe("assembleGrowthSnapshot", () => {
  it("lowers rigor when options are not subtracted, as the engine recomputes (MELI)", () => {
    const output = assemble("high_growth", (foundation) => {
      foundation.employeeEquity.decision = {
        basis: "not_subtracted",
        version: EMPLOYEE_OPTIONS_NOT_SUBTRACTED_VERSION,
        fiscalYearEnd: foundation.baseRevenue.asOf,
        reason: "no_transcription_or_xbrl",
      };
    });
    expect(output?.assessment.rigor.degradedBy).toContain(
      "employee_options_not_subtracted",
    );
    expect(
      checkValuationInput(output!).find(
        (check) => check.id === "rigor_derived_from_completeness",
      )?.status,
    ).toBe("passed");
  });

  it.each(["high_growth", "loss_making"] as const)(
    "turns %s into a ten-year, replayable screening",
    (profile) => {
      const foundation = fixtureGrowthValuation(profile);
      const baseYear = foundation.baseRevenue.asOf;
      foundation.periods = Array.from({ length: 10 }, (_, index) => ({
        ...foundation.periods[Math.min(index, 4)]!,
        periodIndex: index + 1,
        periodEnd: subtractCalendarYears(baseYear, -(index + 1)),
      }));
      const revenueHistory = [0, 1, 2, 3].map((offset) => ({
        fiscalYearEnd: subtractCalendarYears(baseYear, offset),
        value:
          offset === 0
            ? foundation.baseRevenue.value
            : String(100000000 / 1.2 ** offset),
      }));
      const trajectory = deriveGrowthTrajectory(
        revenueHistory,
        foundation.terminal.growth,
      );
      expect(trajectory.status).toBe("ready");
      if (trajectory.status !== "ready") return;
      const output = assembleGrowthSnapshot({
        foundation,
        evidence: foundation.revenueMargin!.profileEvidence,
        trajectory: trajectory.trajectory,
        margin: {
          datasetId: "damodaran.margins-us",
          releaseId: "d5ee9466-6666-4329-9732-b9809ca4f169",
          rowKey: foundation.costOfCapital.industryKey,
          field: "pretax_lease_rd_adjusted_margin",
          value: "0.2",
          publishedLabel: "January 2025",
          availableAt: "2025-01-01T00:00:00.000Z",
          recordedAt: "2025-01-01T00:00:00.000Z",
        },
        lossCarryforward: foundation.revenueMargin!.lossCarryforward!,
        lossOffsetLimit: "0.8",
        lossPolicyRationale:
          "Synthetic tax note: one usable pool and annual cap.",
        financingRationale:
          "Screening assumes funding to cover the peak cash need; terms are unknown.",
        employeeEquityAvailableAt:
          foundation.revenueMargin!.employeeEquityAvailableAt,
      });
      expect(output?.method).toBe(
        profile === "high_growth"
          ? "fcff_three_stage"
          : "revenue_margin_survival",
      );
      expect(output?.periods).toHaveLength(10);
      if (output === null) return;
      const run = runValuation(output, {
        now: () => "2025-07-01T00:00:00.000Z",
        newValuationRunId: () => "11111111-1111-4111-8111-111111111111",
      });
      expect(run.status).toBe("requires_review");
      expect(replayValuationRun(run).outcome).toBe("reproduced");
    },
  );
});
