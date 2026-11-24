import { describe, expect, it } from "vitest";

import {
  VALUATION_DATA_RULE_VERSION,
  type ValuationDataStep,
} from "@/modules/valuation/domain/valuation-data-step";
import { VALUATION_QUALITATIVE_RULE_VERSION } from "@/modules/valuation/domain/valuation-qualitative-step";

import {
  describeDataStep,
  describeJobGap,
  describeQualitativeStep,
} from "./job-copy";

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

describe("describeDataStep: filings (F6-44)", () => {
  const latest = {
    form: "10-K",
    acceptedAt: "2026-11-03T21:00:00.000Z",
    accessionNumber: "0000320193-26-000100",
  } as const;
  const dataStep = (
    filings: ValuationDataStep["filings"],
  ): ValuationDataStep => ({
    ruleVersion: VALUATION_DATA_RULE_VERSION,
    fundamentals: { status: "present" },
    filings,
    sic: { status: "present" },
    prices: { status: "current", latestClose: "2026-11-20" },
    audit: { status: "passed", chains: 4, notExercised: [] },
  });

  it("says nothing when nothing new was filed or nothing was probed", () => {
    expect(
      describeDataStep(dataStep({ status: "current", latest })),
    ).toBeNull();
    expect(describeDataStep(dataStep(undefined))).toBeNull();
  });

  it("names the filing by its New York date", () => {
    expect(
      describeDataStep(
        dataStep({ status: "refreshed", reason: "new_filing", latest }),
      ),
    ).toContain("10-K aceptado el 3 nov 2026");
    expect(
      describeDataStep(dataStep({ status: "not_in_companyfacts", latest })),
    ).toContain("companyfacts todavía no lo trae");
  });

  it("a probe that did not answer says the stored window was used", () => {
    expect(
      describeDataStep(
        dataStep({
          status: "pending",
          reason: "daily_budget_exhausted",
          resumesAt: null,
        }),
      ),
    ).toBe(
      "No se pudo ver si hay un 10-K o 10-Q nuevo: la cuota del día de la fuente está gastada; se valúa con lo guardado.",
    );
  });
});
