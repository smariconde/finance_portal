import { describe, expect, it } from "vitest";

import { listSplitSensitiveConcepts } from "@/modules/corporate-actions/domain/share-basis";

import {
  planSecHistoryPrune,
  SEC_HISTORY_PRUNE_RULE_VERSION,
} from "./plan-sec-history-prune";
import { SEC_CONCEPT_SELECTION_VERSION } from "./sec-concept-selection";
import { buildSecHistoryWindow } from "./sec-history-window";

const SUBJECT = {
  sourceId: "sec-edgar",
  datasetId: "sec.companyfacts",
  subjectType: "legal_entity" as const,
  subjectId: "11111111-1111-4111-8111-111111111111",
};

const ANCHOR = {
  runId: "22222222-2222-4222-8222-222222222222",
  selectionVersion: SEC_CONCEPT_SELECTION_VERSION,
  // Cierre fiscal real de Apple, medido el 2026-09-17.
  selectionAnchorOn: "2025-09-27",
};

describe("planSecHistoryPrune", () => {
  it("corta donde corta la ventana de la ingesta, sin recalcular nada", () => {
    const decision = planSecHistoryPrune(SUBJECT, ANCHOR);
    const window = buildSecHistoryWindow(
      ANCHOR.selectionAnchorOn,
      "annual_report",
    );

    expect(decision.status).toBe("planned");

    if (decision.status !== "planned") {
      return;
    }

    // La invariante del incremento: lo que la poda borra es exactamente el
    // complemento de lo que la ventana conserva. Un día de diferencia acá es un
    // ejercicio entero de más o de menos.
    expect(decision.plan.periodsEndingBefore).toBe(window.periodsEndingFrom);
    expect(decision.plan.evidencePeriodsEndingBefore).toBe(
      window.evidencePeriodsEndingFrom,
    );
    expect(decision.ruleVersion).toBe(SEC_HISTORY_PRUNE_RULE_VERSION);
  });

  it("conserva el ejercicio extra de los seis conceptos sensibles a splits", () => {
    const decision = planSecHistoryPrune(SUBJECT, ANCHOR);

    expect(decision.status).toBe("planned");

    if (decision.status !== "planned") {
      return;
    }

    expect([...decision.plan.evidenceConcepts].sort()).toEqual(
      [...listSplitSensitiveConcepts()].sort(),
    );
  });

  it("se niega sin ancla registrada: el corte no se adivina de las filas", () => {
    const decision = planSecHistoryPrune(SUBJECT, null);

    expect(decision).toMatchObject({
      status: "rejected",
      code: "anchor_unknown",
    });
  });

  it("se niega con un ancla de otra selección, que describe otra ventana", () => {
    const decision = planSecHistoryPrune(SUBJECT, {
      ...ANCHOR,
      selectionVersion: "sec-core-concepts-1.0.0",
    });

    expect(decision).toMatchObject({
      status: "rejected",
      code: "selection_superseded",
    });
  });
});
