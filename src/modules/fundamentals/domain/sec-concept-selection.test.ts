import { describe, expect, it } from "vitest";

import { stagedRecordSchema } from "@/modules/ingestion/domain/staged-record";

import {
  isSelectedSecConcept,
  listSelectedSecConcepts,
} from "./sec-concept-selection";

describe("sec concept selection", () => {
  it("selects by taxonomy and concept, not by name alone", () => {
    expect(isSelectedSecConcept("us-gaap", "Assets")).toBe(true);
    expect(isSelectedSecConcept("dei", "Assets")).toBe(false);
    expect(isSelectedSecConcept("us-gaap", "AccountsPayableCurrent")).toBe(
      false,
    );
  });

  it("does not repeat a concept", () => {
    const concepts = listSelectedSecConcepts();

    expect(new Set(concepts).size).toBe(concepts.length);
  });

  it("only selects concepts whose qualified name fits the staged record", () => {
    // `concept` y `metricId` del registro tienen techo de 128; un concepto que
    // no entra fallaría recién en staging, con el lote ya descargado.
    for (const concept of listSelectedSecConcepts()) {
      expect(stagedRecordSchema.shape.concept.safeParse(concept).success).toBe(
        true,
      );
      expect(stagedRecordSchema.shape.metricId.safeParse(concept).success).toBe(
        true,
      );
    }
  });
});
