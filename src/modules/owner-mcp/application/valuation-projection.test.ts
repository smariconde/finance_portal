import { describe, expect, it } from "vitest";

import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";

import { fixtureValuationReading } from "../infrastructure/fixture-valuation-reading";
import { projectValuationResult } from "./valuation-projection";

function restricting(sourceId: string) {
  return DEMO_SOURCE_REGISTRY.map((entry) =>
    entry.sourceId === sourceId
      ? {
          ...entry,
          rights: { ...entry.rights, ownerAssistant: "restricted" as const },
        }
      : entry,
  );
}

describe("projectValuationResult", () => {
  it("una corrida FCFF lleva valor, escenarios, rigor y su corte", async () => {
    const { reading } = await fixtureValuationReading("fcff");
    if (reading.state !== "run") throw new Error("expected an FCFF run");
    const { run } = reading;
    const projected = projectValuationResult(reading, DEMO_SOURCE_REGISTRY);

    expect(projected).toMatchObject({
      catalogVersion: "portal-mcp-tools-1.2.0",
      state: "run",
      run: {
        withheld: null,
        method: "fcff_base",
        asOf: run.asOf,
        valuePerShare: run.result?.valuePerShare,
        inputHash: run.inputHash,
        scenarios: {
          bearValuePerShare: run.result?.scenarios?.bear.valuePerShare,
        },
      },
    });
  });

  it("un control que sólo falló en bull se nombra con su caso (GOOGL, `F6-51`)", async () => {
    const { reading } = await fixtureValuationReading("fcff");
    if (reading.state !== "run") throw new Error("expected an FCFF run");
    const result = reading.run.result;
    if (result?.scenarios == null) throw new Error("expected scenarios");
    const terminal = {
      id: "terminal_value_share",
      mode: "require_review" as const,
      status: "failed" as const,
      message: "Terminal value share above the review threshold.",
      subjects: ["terminal"],
    };
    const projected = projectValuationResult(
      {
        ...reading,
        run: {
          ...reading.run,
          status: "requires_review",
          result: {
            ...result,
            scenarios: {
              ...result.scenarios,
              bull: {
                ...result.scenarios.bull,
                checks: [...result.scenarios.bull.checks, terminal],
              },
            },
          },
        },
      },
      DEMO_SOURCE_REGISTRY,
    );

    expect(projected).toMatchObject({
      run: {
        status: "requires_review",
        review: {
          version: "run-review-1.0.0",
          marks: ["requires_review"],
          reviewChecks: [{ id: "terminal_value_share", origins: ["bull"] }],
        },
        failedChecks: [
          {
            id: "terminal_value_share",
            mode: "require_review",
            origins: ["bull"],
          },
        ],
      },
    });
  });

  it("un rechazo nombra sus reglas y campos, y una corrida calculada no trae falla", async () => {
    const { reading } = await fixtureValuationReading("fcff");
    if (reading.state !== "run") throw new Error("expected an FCFF run");
    const failure = {
      code: "policy_check_failed" as const,
      message:
        "Valuation rejected by policy checks: failure_risk_recomputed, required_inputs_present.",
      subjects: ["normalization.investedCapital", "bridge.debt"],
    };
    const rejected = projectValuationResult(
      {
        ...reading,
        run: {
          ...reading.run,
          status: "rejected",
          result: null,
          resultHash: null,
          failure,
        },
      },
      DEMO_SOURCE_REGISTRY,
    );

    expect(rejected).toMatchObject({
      run: { status: "rejected", valuePerShare: null, failure },
    });
    expect(projectValuationResult(reading, DEMO_SOURCE_REGISTRY)).toMatchObject(
      { run: { failure: null } },
    );
  });

  it("una corrida financiera lee su valor de `result.base`", async () => {
    const { reading, run } = await fixtureValuationReading("financial");
    const projected = projectValuationResult(reading, DEMO_SOURCE_REGISTRY);

    expect(reading.state).toBe("financial_run");
    expect(run.result).not.toBeNull();
    expect(projected).toMatchObject({
      state: "financial_run",
      run: {
        withheld: null,
        method: "excess_return",
        rigor: "screening",
        modelStatus: "experimental",
      },
    });
    expect(
      "run" in projected &&
        projected.run.withheld === null &&
        projected.run.valuePerShare,
    ).toMatch(/^-?[0-9]+(\.[0-9]+)?$/u);
  });

  it("una fuente sin derecho saca sólo su sección, con el motivo", async () => {
    const { reading } = await fixtureValuationReading("fcff");
    const projected = projectValuationResult(
      reading,
      restricting("yahoo-finance"),
    );

    expect(projected).toMatchObject({
      run: { withheld: null },
      market: {
        withheld: [
          {
            sourceId: "yahoo-finance",
            reason: "rights.ownerAssistant:restricted",
          },
        ],
      },
      cedear: { withheld: null },
    });
  });
});
