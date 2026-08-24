import { describe, expect, it } from "vitest";

import {
  DEMO_VALUATION_INPUT,
  DEMO_VALUATION_INPUT_BEFORE_AMENDMENT,
} from "../infrastructure/demo-valuation-fixtures";
import { isValuationPolicyError } from "./valuation-error";
import {
  assertMethodSupported,
  computeValuationInputHash,
  valuationInputSchema,
  type ValuationInput,
} from "./valuation-input";

function candidate(mutate: (input: ValuationInput) => void) {
  const draft = structuredClone(DEMO_VALUATION_INPUT);
  mutate(draft);

  return draft;
}

describe("valuation input snapshot", () => {
  it("hashes the same snapshot to the same value", () => {
    expect(computeValuationInputHash(DEMO_VALUATION_INPUT)).toBe(
      "fb0277d045ff984530436950619bee955b0ccf263466062643e0d2812bce8c25",
    );
  });

  it("does not depend on key order", () => {
    // La serialización canónica ordena claves: el mismo contenido lógico
    // escrito en otro orden es el mismo snapshot.
    const reordered = valuationInputSchema.parse({
      ...(Object.fromEntries(
        Object.entries(DEMO_VALUATION_INPUT).reverse(),
      ) as ValuationInput),
      bridge: Object.fromEntries(
        Object.entries(DEMO_VALUATION_INPUT.bridge).reverse(),
      ) as ValuationInput["bridge"],
    });

    expect(computeValuationInputHash(reordered)).toBe(
      computeValuationInputHash(DEMO_VALUATION_INPUT),
    );
  });

  it("gives a different hash to a different knowledge cutoff", () => {
    // Mismo modelo, otro corte: en marzo de 2025 el revenue defendible era el
    // original, no el enmendado (`TM-06`).
    expect(
      computeValuationInputHash(DEMO_VALUATION_INPUT_BEFORE_AMENDMENT),
    ).not.toBe(computeValuationInputHash(DEMO_VALUATION_INPUT));
    expect(DEMO_VALUATION_INPUT_BEFORE_AMENDMENT.baseRevenue.value).toBe(
      "100000000",
    );
    expect(DEMO_VALUATION_INPUT.baseRevenue.value).toBe("96000000");
  });

  it("gives a different hash to a changed assumption", () => {
    const changed = valuationInputSchema.parse(
      candidate((draft) => {
        draft.terminal.growth = "0.021";
      }),
    );

    expect(computeValuationInputHash(changed)).not.toBe(
      computeValuationInputHash(DEMO_VALUATION_INPUT),
    );
  });

  it("keeps identity levels separate and free of tickers", () => {
    const subject = DEMO_VALUATION_INPUT.subject;

    expect(subject.legalEntityId).not.toBe(subject.securityId);
    expect(subject.securityId).not.toBe(subject.listingId);
    expect(JSON.stringify(DEMO_VALUATION_INPUT)).not.toContain("FXCO");
  });

  it("requires provenance on every fact", () => {
    expect(DEMO_VALUATION_INPUT.baseRevenue).toMatchObject({
      asOf: "2024-12-31",
      availableAt: "2025-05-01T14:00:00.000Z",
      sourceId: "fixture-demo-fundamentals",
      qualityFlags: ["restated_by_source"],
    });
    // Las acciones diluidas no salen del dataset que las restringe por
    // licencia: vienen de otro documento y lo dicen.
    expect(DEMO_VALUATION_INPUT.dilutedShares.sourceDocumentId).toBe(
      "fixtureco-2025-share-register",
    );
  });

  it("refuses a claim amount without a reported status", () => {
    const result = valuationInputSchema.safeParse(
      candidate((draft) => {
        draft.bridge.minorityInterest = {
          status: "declared_absent",
          amount: draft.bridge.debt.amount,
          rationale: "Contradictorio a propósito.",
        };
      }),
    );

    expect(result.success).toBe(false);
  });

  it("refuses to declare a claim absent without a rationale", () => {
    const result = valuationInputSchema.safeParse(
      candidate((draft) => {
        draft.bridge.otherClaims = {
          status: "declared_absent",
          amount: null,
          rationale: null,
        };
      }),
    );

    expect(result.success).toBe(false);
  });

  it("refuses periods that are not consecutive or ordered", () => {
    const unordered = valuationInputSchema.safeParse(
      candidate((draft) => {
        draft.periods[2]!.periodEnd = "2024-12-31";
      }),
    );
    const renumbered = valuationInputSchema.safeParse(
      candidate((draft) => {
        draft.periods[1]!.periodIndex = 4;
      }),
    );

    expect(unordered.success).toBe(false);
    expect(renumbered.success).toBe(false);
  });

  it("refuses a base year that does not close before the first period", () => {
    const result = valuationInputSchema.safeParse(
      candidate((draft) => {
        draft.baseRevenue.asOf = "2026-12-31";
      }),
    );

    expect(result.success).toBe(false);
  });

  it("refuses a value that is not a canonical decimal", () => {
    const result = valuationInputSchema.safeParse(
      candidate((draft) => {
        draft.baseRevenue.value = "96,000,000";
      }),
    );

    expect(result.success).toBe(false);
  });

  it("refuses to value a profile it does not implement", () => {
    const bank = valuationInputSchema.parse(
      candidate((draft) => {
        draft.assetProfile = "bank";
      }),
    );

    expect(() =>
      assertMethodSupported(DEMO_VALUATION_INPUT),
    ).not.toThrowError();

    try {
      assertMethodSupported(bank);
      throw new Error("Expected the unsupported profile to stop the run.");
    } catch (error) {
      expect(isValuationPolicyError(error, "unsupported_method")).toBe(true);
      expect((error as Error).message).toContain("not a fallback");
    }
  });
});
