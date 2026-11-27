import { describe, expect, it } from "vitest";

import {
  DEMO_IDENTITY_GRAPH,
  DEMO_IDENTITY_IDS,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import type { StoredValuationRun } from "@/modules/valuation/domain/stored-valuation-run";

import { resolvePositionIdentity, valuationOf } from "./position-context";

function at(instant: string) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: instant,
    revisionPolicy: "as_known",
    knownAt: instant,
    sourcePolicyVersion: "source-policy-1.0.0",
  });
}

const NOW = at("2026-11-13T15:00:00.000Z");

describe("resolvePositionIdentity", () => {
  it("resolves the current US ticker to its security and issuer", () => {
    expect(resolvePositionIdentity(DEMO_IDENTITY_GRAPH, "fxco", NOW)).toEqual({
      status: "resolved",
      securityId: DEMO_IDENTITY_IDS.fixtureCoClassA,
      legalEntityId: DEMO_IDENTITY_IDS.fixtureCoEntity,
    });
  });

  it("ignores a BYMA CEDEAR that shares the ticker", () => {
    // FIXA is FixtureCo's CEDEAR in pesos and, since 2025, Andes in dollars.
    expect(
      resolvePositionIdentity(DEMO_IDENTITY_GRAPH, "FIXA", NOW),
    ).toMatchObject({
      status: "resolved",
      securityId: DEMO_IDENTITY_IDS.andesCommon,
    });
  });

  it("reads the ticker at the cutoff, not today's holder", () => {
    expect(
      resolvePositionIdentity(
        DEMO_IDENTITY_GRAPH,
        "FIXA",
        at("2024-01-15T15:00:00.000Z"),
      ),
    ).toMatchObject({ securityId: DEMO_IDENTITY_IDS.fixtureCoClassA });
  });

  it("names a symbol outside the universe", () => {
    expect(resolvePositionIdentity(DEMO_IDENTITY_GRAPH, "NOPE", NOW)).toEqual({
      status: "unresolved",
      reason: "not_in_universe",
    });
  });
});

describe("valuationOf", () => {
  const fcff = {
    status: "computed",
    currency: "USD",
    asOf: "2026-11-02",
    result: { valuePerShare: "123.45" },
  } as unknown as StoredValuationRun;

  it("takes the value per share where each method keeps it", () => {
    expect(valuationOf(fcff, true)).toEqual({
      status: "valued",
      valuePerShare: "123.45",
      currency: "USD",
      asOf: "2026-11-02",
      runStatus: "computed",
    });
    const excess = {
      ...fcff,
      status: "requires_review",
      result: { base: { valuePerShare: "50" } },
    } as unknown as StoredValuationRun;
    expect(valuationOf(excess, true)).toMatchObject({
      valuePerShare: "50",
      runStatus: "requires_review",
    });
  });

  it.each([
    ["never asked", null, false, "not_requested"],
    ["asked without a run", null, true, "no_run"],
    [
      "rejected",
      { status: "rejected", result: null } as unknown as StoredValuationRun,
      true,
      "run_rejected",
    ],
    [
      "a REIT without value",
      {
        status: "computed",
        result: { base: { valuePerShare: null } },
      } as unknown as StoredValuationRun,
      true,
      "run_without_value",
    ],
  ])("is absent when %s", (_, run, requested, reason) => {
    expect(valuationOf(run, requested)).toEqual({ status: "absent", reason });
  });
});
