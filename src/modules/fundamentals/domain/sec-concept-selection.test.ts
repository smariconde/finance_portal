import { describe, expect, it } from "vitest";

import { listSplitSensitiveConcepts } from "@/modules/corporate-actions/domain/share-basis";
import { stagedRecordSchema } from "@/modules/ingestion/domain/staged-record";

import {
  isSelectedSecConcept,
  isSplitEvidenceConcept,
  listSelectedSecConcepts,
  SEC_CONCEPT_SELECTION,
} from "./sec-concept-selection";

describe("sec concept selection", () => {
  it("pins what the selection version decides", () => {
    // Cambiar la lista, la ventana o los conceptos de evidencia sin subir la
    // versión rompe este test: la corrida diría haber ingerido otra cosa.
    expect(SEC_CONCEPT_SELECTION).toEqual({
      version: "sec-core-concepts-3.0.0",
      components: { historyWindow: "sec-history-5fy-1.0.0" },
    });
    expect(listSelectedSecConcepts()).toHaveLength(62);
    expect(
      listSelectedSecConcepts().filter((qualified) => {
        const [taxonomy, concept] = qualified.split(":") as [string, string];
        return isSplitEvidenceConcept(taxonomy, concept);
      }),
    ).toEqual([
      "us-gaap:EarningsPerShareBasic",
      "us-gaap:EarningsPerShareDiluted",
      "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
      "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding",
      "us-gaap:CommonStockSharesOutstanding",
      "dei:EntityCommonStockSharesOutstanding",
    ]);
  });

  it("selects every concept the split rule reads, so its evidence is stored", () => {
    for (const qualified of listSplitSensitiveConcepts()) {
      const [taxonomy, concept] = qualified.split(":") as [string, string];

      expect(isSelectedSecConcept(taxonomy, concept)).toBe(true);
      expect(isSplitEvidenceConcept(taxonomy, concept)).toBe(true);
    }

    expect(isSplitEvidenceConcept("us-gaap", "NetIncomeLoss")).toBe(false);
    expect(isSplitEvidenceConcept("dei", "EarningsPerShareBasic")).toBe(false);
  });

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
