import { describe, expect, it } from "vitest";

import {
  judgeReitAffo,
  reitAffoOutputSchema,
  type ReitAffoInput,
  type ReitAffoOutput,
} from "./reit-affo-task";
import { reitAffoFromTranscription } from "./reit-affo-transcription";

const evidence = [
  "(In millions)",
  "Net income attributable to common shareholders 8",
  "Real estate depreciation 6",
  "Gains on sales of properties 2",
  "Real estate impairments 1",
  "Joint venture FFO adjustment 0",
  "Recurring capital expenditures including tenant improvements and leasing commissions 2",
  "Straight-line rent adjustment 1",
  "FFO attributable to common shareholders 13",
  "AFFO attributable to common shareholders 10",
].join("\n");

const input: ReitAffoInput = {
  companyName: "Fixture REIT",
  fiscalYearEnd: "2025-12-31",
  evidence: { sourceId: "sec-edgar", text: evidence },
  expectedCommonIncome: "8000000",
};

function proposed(): ReitAffoOutput {
  const line = (amount: string, quote: string) => ({ amount, quote });
  return {
    decision: "proposed",
    unit: "millions",
    unitQuote: "(In millions)",
    components: {
      commonNetIncome: line(
        "8",
        "Net income attributable to common shareholders 8",
      ),
      realEstateDepreciation: line("6", "Real estate depreciation 6"),
      propertySaleGains: line("2", "Gains on sales of properties 2"),
      realEstateImpairments: line("1", "Real estate impairments 1"),
      jointVentureAdjustment: line("0", "Joint venture FFO adjustment 0"),
      recurringCapex: line(
        "2",
        "Recurring capital expenditures including tenant improvements and leasing commissions 2",
      ),
      straightLineRent: line("1", "Straight-line rent adjustment 1"),
    },
    reportedFfo: line("13", "FFO attributable to common shareholders 13"),
    reportedAffo: line("10", "AFFO attributable to common shareholders 10"),
    rationale: "Every component is printed in the same annual reconciliation.",
    abstainReason: null,
  };
}

describe("REIT AFFO transcription policy", () => {
  it("accepts an evidenced reconciliation with the stated unit", () => {
    expect(judgeReitAffo(proposed(), input)).toEqual({ verdict: "accept" });
  });

  it("refuses invented zero, missing components and a quote outside the filing", () => {
    const missing = proposed();
    missing.components.jointVentureAdjustment = null;
    expect(judgeReitAffo(missing, input)).toEqual({
      verdict: "reject",
      code: "component_jointVentureAdjustment_unverified",
    });
    const fabricated = proposed();
    fabricated.components.jointVentureAdjustment = {
      amount: "0",
      quote: "JV adjustment 0",
    };
    expect(judgeReitAffo(fabricated, input).verdict).toBe("reject");
  });

  it("refuses a wrong scale or common income, even when the FFO arithmetic closes", () => {
    const wrongScale = proposed();
    wrongScale.unit = "thousands";
    expect(judgeReitAffo(wrongScale, input)).toEqual({
      verdict: "reject",
      code: "common_income_mismatch",
    });
    expect(
      judgeReitAffo(proposed(), { ...input, expectedCommonIncome: "-8000000" })
        .verdict,
    ).toBe("reject");
  });

  it("refuses nonreconciling FFO and AFFO", () => {
    const ffo = proposed();
    ffo.reportedFfo = {
      amount: "10",
      quote: "AFFO attributable to common shareholders 10",
    };
    expect(judgeReitAffo(ffo, input)).toEqual({
      verdict: "reject",
      code: "ffo_does_not_reconcile",
    });
    const affo = proposed();
    affo.reportedAffo = {
      amount: "13",
      quote: "FFO attributable to common shareholders 13",
    };
    expect(judgeReitAffo(affo, input)).toEqual({
      verdict: "reject",
      code: "affo_does_not_reconcile",
    });
  });

  it("requires a named abstention for a different issuer definition", () => {
    const other = proposed();
    other.decision = "abstain";
    other.abstainReason = "different_definition";
    expect(judgeReitAffo(other, input)).toEqual({
      verdict: "abstain",
      reason: "different_definition",
    });
    expect(reitAffoOutputSchema.safeParse(other).success).toBe(false);
  });

  it("freezes scaled, dated facts only after acceptance", () => {
    const request = {
      proposal: proposed(),
      evidence: input,
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      acceptedAt: "2026-02-13T20:00:00Z",
      accessionNumber: "0000000000-26-000001",
      currency: "USD",
    };
    const reconciled = reitAffoFromTranscription(request);
    expect(reconciled?.commonNetIncome?.value).toBe("8000000");
    expect(reconciled?.recurringCapex?.value).toBe("2000000");
    expect(reconciled?.commonNetIncome?.availableAt).toBe(request.acceptedAt);
    expect(reconciled?.commonNetIncome?.sourceDocumentId).toBe(
      request.accessionNumber,
    );
    expect(
      reitAffoFromTranscription({
        ...request,
        evidence: { ...input, expectedCommonIncome: "9000000" },
      }),
    ).toBeNull();
  });
});
