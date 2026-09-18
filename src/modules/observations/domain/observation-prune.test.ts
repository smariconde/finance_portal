import { describe, expect, it } from "vitest";

import {
  isPruned,
  observationPruneCountsSchema,
  observationPrunePlanSchema,
  observationPruneSchema,
  pruneCutFor,
} from "./observation-prune";

const EVIDENCE = "us-gaap:EarningsPerShareDiluted";

const PLAN = observationPrunePlanSchema.parse({
  sourceId: "sec-edgar",
  datasetId: "sec.companyfacts",
  subjectType: "legal_entity",
  subjectId: "11111111-1111-4111-8111-111111111111",
  periodsEndingBefore: "2020-09-13",
  evidencePeriodsEndingBefore: "2019-09-13",
  evidenceConcepts: [EVIDENCE],
});

const PRUNE = {
  pruneId: "22222222-2222-4222-8222-222222222222",
  ruleVersion: "sec-history-prune-1.0.0",
  sourceId: PLAN.sourceId,
  datasetId: PLAN.datasetId,
  subjectType: PLAN.subjectType,
  subjectId: PLAN.subjectId,
  selectionVersion: "sec-core-concepts-2.0.0",
  selectionAnchorOn: "2025-09-27",
  anchorRunId: "33333333-3333-4333-8333-333333333333",
  periodsEndingBefore: PLAN.periodsEndingBefore,
  evidencePeriodsEndingBefore: PLAN.evidencePeriodsEndingBefore,
  evidenceConcepts: [EVIDENCE],
  deletedCount: 2,
  keptCount: 5,
  deletedMinAsOf: "2016-12-31",
  deletedMaxAsOf: "2020-09-12",
  actor: "owner",
  reason: "ventana de cinco ejercicios",
  executedAt: "2026-09-17T21:00:00.000Z",
};

describe("plan de poda", () => {
  it("borra lo anterior al corte y conserva el corte mismo", () => {
    expect(
      isPruned(PLAN, { concept: "us-gaap:Assets", asOf: "2020-09-12" }),
    ).toBe(true);
    expect(
      isPruned(PLAN, { concept: "us-gaap:Assets", asOf: "2020-09-13" }),
    ).toBe(false);
  });

  it("le da a un concepto de evidencia su propio corte, un ejercicio más viejo", () => {
    expect(pruneCutFor(PLAN, EVIDENCE)).toBe("2019-09-13");
    expect(pruneCutFor(PLAN, "us-gaap:Assets")).toBe("2020-09-13");
    expect(isPruned(PLAN, { concept: EVIDENCE, asOf: "2019-09-13" })).toBe(
      false,
    );
    expect(isPruned(PLAN, { concept: EVIDENCE, asOf: "2019-09-12" })).toBe(
      true,
    );
  });

  it("rechaza un corte de evidencia más nuevo que el general", () => {
    expect(() =>
      observationPrunePlanSchema.parse({
        ...PLAN,
        evidencePeriodsEndingBefore: "2021-01-01",
      }),
    ).toThrow(/evidence keeps more history/u);
  });

  it("rechaza conceptos de evidencia repetidos", () => {
    expect(() =>
      observationPrunePlanSchema.parse({
        ...PLAN,
        evidenceConcepts: [EVIDENCE, EVIDENCE],
      }),
    ).toThrow(/must not repeat/u);
  });
});

describe("registro de poda", () => {
  it("acepta un registro consistente", () => {
    expect(observationPruneSchema.parse(PRUNE).deletedCount).toBe(2);
  });

  it("exige los extremos exactamente cuando se borró algo", () => {
    expect(() =>
      observationPruneSchema.parse({
        ...PRUNE,
        deletedCount: 0,
        keptCount: 7,
      }),
    ).toThrow();

    expect(
      observationPruneSchema.parse({
        ...PRUNE,
        deletedCount: 0,
        keptCount: 7,
        deletedMinAsOf: null,
        deletedMaxAsOf: null,
      }).deletedMaxAsOf,
    ).toBeNull();
  });

  it("rechaza haber borrado una fila que la ventana conserva", () => {
    expect(() =>
      observationPruneSchema.parse({ ...PRUNE, deletedMaxAsOf: "2020-09-13" }),
    ).toThrow(/must end before the general cut/u);
  });

  it("rechaza un corte posterior a su propia ancla", () => {
    expect(() =>
      observationPruneSchema.parse({
        ...PRUNE,
        selectionAnchorOn: "2020-09-12",
      }),
    ).toThrow(/newer than the anchor/u);
  });

  it("rechaza un actor con caracteres fuera del alfabeto auditable", () => {
    expect(() =>
      observationPruneSchema.parse({ ...PRUNE, actor: "owner; drop" }),
    ).toThrow();
  });

  it("rechaza extremos invertidos", () => {
    expect(() =>
      observationPruneCountsSchema.parse({
        deleted: 2,
        kept: 1,
        deletedMinAsOf: "2020-01-01",
        deletedMaxAsOf: "2019-01-01",
      }),
    ).toThrow(/must not precede/u);
  });
});
