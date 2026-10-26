import { describe, expect, it } from "vitest";

import { VALUATION_QUALITATIVE_RULE_VERSION } from "@/modules/valuation/domain/valuation-qualitative-step";

import { describeJobGap, describeQualitativeStep } from "./job-copy";

describe("describeJobGap", () => {
  it("explains why a cyclical ticker cannot yet be valued from the page", () => {
    expect(
      describeJobGap(
        "unsupported_method",
        "cyclical",
        "missing_required_input",
      ),
    ).toContain("Esta página todavía no permite cargarlos.");
  });

  it("keeps the generic reason when the missing input belongs to another profile", () => {
    expect(
      describeJobGap("unsupported_method", "bank", "missing_required_input"),
    ).toBe("El método que le corresponde no está admitido.");
  });
});

const base = {
  ruleVersion: VALUATION_QUALITATIVE_RULE_VERSION,
  industry: { status: "present" },
  employeeEquity: { status: "present" },
  operationsMix: { status: "present" },
  chargedNanoUsd: 0,
} as const;

describe("describeQualitativeStep", () => {
  it("says nothing when nothing was asked or everything was accepted", () => {
    expect(describeQualitativeStep(null)).toBeNull();
    expect(
      describeQualitativeStep({
        ...base,
        industry: { status: "accepted", rung: 1 },
      }),
    ).toBeNull();
  });

  it("names each task the AI did not resolve, in plain words and without codes", () => {
    const sentence = describeQualitativeStep({
      ...base,
      employeeEquity: { status: "abstained", reason: "ladder_exhausted" },
      operationsMix: { status: "abstained", reason: "ai_budget_exhausted" },
    });

    expect(sentence).toBe(
      "La IA no resolvió las opciones de empleados: ninguna respuesta pasó la policy; el mix geográfico de ingresos: el tope de gasto en IA del día está gastado.",
    );
    expect(sentence).not.toContain("ladder_exhausted");
  });

  it("explains a stop and what it left untried", () => {
    expect(
      describeQualitativeStep({
        ...base,
        industry: { status: "stopped", code: "breaker_open" },
        employeeEquity: { status: "not_run" },
      }),
    ).toContain("no se intentó porque la capa IA frenó antes");
  });
});
