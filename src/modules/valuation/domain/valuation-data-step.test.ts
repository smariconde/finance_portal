import { describe, expect, it } from "vitest";

import {
  auditStepFromReport,
  dataStepBlock,
  dataStepIngested,
  valuationDataStepSchema,
  VALUATION_DATA_RULE_VERSION,
  type ValuationDataStep,
} from "./valuation-data-step";

const PASSED = {
  status: "passed",
  chains: 12,
  notExercised: [],
} as const;

function step(overrides: Partial<ValuationDataStep> = {}): ValuationDataStep {
  return valuationDataStepSchema.parse({
    ruleVersion: VALUATION_DATA_RULE_VERSION,
    fundamentals: { status: "present" },
    sic: { status: "present" },
    prices: { status: "current", latestClose: "2026-10-20" },
    audit: PASSED,
    ...overrides,
  });
}

const VERDICTS = [
  "provenance_resolves",
  "availability_precedes_fetch",
  "revision_chain_ordered",
  "as_known_excludes_later_revision",
  "restatement_changes_content",
] as const;

describe("valuation-data-1.0.0", () => {
  it("bajó algo sólo si una parte dice ingested u observed", () => {
    expect(dataStepIngested(step())).toBe(false);
    expect(
      dataStepIngested(
        step({ fundamentals: { status: "ingested", filers: 2 } }),
      ),
    ).toBe(true);
    expect(
      dataStepIngested(step({ sic: { status: "observed", code: "3571" } })),
    ).toBe(true);
    expect(dataStepIngested(step({ prices: { status: "ingested" } }))).toBe(
      true,
    );
    // Un SIC que la SEC no publica no es algo bajado.
    expect(dataStepIngested(step({ sic: { status: "not_published" } }))).toBe(
      false,
    );
  });

  it("los precios nunca bloquean; fundamentals y SIC sí", () => {
    const pending = {
      status: "pending",
      reason: "source_busy",
      resumesAt: null,
    } as const;

    expect(dataStepBlock(step({ prices: pending }))).toBeNull();
    expect(
      dataStepBlock(
        step({ prices: { status: "failed", code: "provider_error" } }),
      ),
    ).toBeNull();
    expect(dataStepBlock(step({ fundamentals: pending }))).toBe(
      "ingestion_pending",
    );
    expect(dataStepBlock(step({ sic: pending }))).toBe("ingestion_pending");
    expect(
      dataStepBlock(
        step({ fundamentals: { status: "failed", code: "provider_error" } }),
      ),
    ).toBe("ingestion_failed");
  });

  it("rechaza códigos que no son códigos y fechas que no son fechas", () => {
    expect(() =>
      step({
        fundamentals: { status: "failed", code: "connect ECONNREFUSED" },
      }),
    ).toThrow();
    expect(() =>
      step({ prices: { status: "current", latestClose: "20/10/2026" } }),
    ).toThrow();
    expect(() => step({ sic: { status: "observed", code: "35" } })).toThrow();
  });

  it("una afirmación sin ejercer pasa, pero se nombra", () => {
    const audit = auditStepFromReport({
      chains: 30,
      verdicts: VERDICTS.map((claim) => ({
        claim,
        status:
          claim === "as_known_excludes_later_revision"
            ? "not_exercised"
            : "pass",
        failed: 0,
      })),
      findings: [],
    });

    expect(audit).toEqual({
      status: "passed",
      chains: 30,
      notExercised: ["as_known_excludes_later_revision"],
    });
  });

  it("una falla bloquea con el primer hallazgo y el total", () => {
    const audit = auditStepFromReport({
      chains: 30,
      verdicts: VERDICTS.map((claim) => ({
        claim,
        status: claim === "availability_precedes_fetch" ? "fail" : "pass",
        failed: claim === "availability_precedes_fetch" ? 91 : 0,
      })),
      findings: [
        {
          claim: "availability_precedes_fetch",
          metricId: "Revenues",
          asOf: "2025-12-31",
        },
      ],
    });

    expect(audit).toEqual({
      status: "failed",
      chains: 30,
      failures: 91,
      claim: "availability_precedes_fetch",
      metricId: "Revenues",
      asOf: "2025-12-31",
    });
  });

  it("una sola cadena vacía no es una falla", () => {
    expect(
      auditStepFromReport({
        chains: 0,
        verdicts: VERDICTS.map((claim) => ({
          claim,
          status: "not_exercised",
          failed: 0,
        })),
        findings: [],
      }),
    ).toMatchObject({ status: "passed", chains: 0 });
  });
});

describe("valuation-data-1.1.0 (F6-44)", () => {
  it("still reads a stored 1.0.0 step without filings", () => {
    const stored = valuationDataStepSchema.parse({
      ruleVersion: "valuation-data-1.0.0",
      fundamentals: { status: "present" },
      sic: { status: "present" },
      prices: { status: "current", latestClose: "2026-10-20" },
      audit: PASSED,
    });

    expect(stored.filings).toBeUndefined();
  });

  it("a refresh is something downloaded; filings never block", () => {
    const latest = {
      form: "10-Q",
      acceptedAt: "2026-10-29T20:05:00.000Z",
      accessionNumber: "0001652044-26-000090",
    } as const;

    expect(
      dataStepIngested(
        step({
          filings: { status: "refreshed", reason: "never_probed", latest },
        }),
      ),
    ).toBe(true);
    expect(
      dataStepIngested(step({ filings: { status: "current", latest } })),
    ).toBe(false);
    expect(
      dataStepBlock(
        step({
          filings: {
            status: "pending",
            reason: "source_busy",
            resumesAt: null,
          },
        }),
      ),
    ).toBeNull();
  });

  it("rejects a periodic filing with a form outside the periodic reports", () => {
    expect(() =>
      step({
        filings: {
          status: "not_in_companyfacts",
          latest: {
            // @ts-expect-error: an 8-K is not a periodic report
            form: "8-K",
            acceptedAt: "2026-10-29T20:05:00.000Z",
            accessionNumber: "0001652044-26-000090",
          },
        },
      }),
    ).toThrow();
  });
});
