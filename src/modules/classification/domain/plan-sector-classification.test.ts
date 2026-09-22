import { describe, expect, it } from "vitest";

import {
  planSectorClassification,
  SECTOR_CLASSIFICATION_RULE_VERSION,
  type PlanSectorClassificationInput,
  type SectorSourcePin,
} from "./plan-sector-classification";
import { SP500_SECTOR_TAXONOMY_ID } from "./sector-taxonomy";
import {
  subjectClassificationSchema,
  type SubjectClassification,
} from "./subject-classification";

const APPLE = "11111111-1111-4111-8111-111111111111";
const EXXON = "22222222-2222-4222-8222-222222222222";

const PIN_A: SectorSourcePin = {
  commit: "a".repeat(40),
  committedAt: "2026-06-01T00:00:00.000Z",
};

const PIN_B: SectorSourcePin = {
  commit: "b".repeat(40),
  committedAt: "2026-09-05T01:39:10.000Z",
};

let counter = 0;

function makeInput(
  overrides: Partial<PlanSectorClassificationInput> = {},
): PlanSectorClassificationInput {
  return {
    claims: [],
    stored: [],
    pin: PIN_A,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    recordedAt: "2026-09-21T12:00:00.000Z",
    newId: () => {
      counter += 1;
      return `33333333-3333-4333-8333-${String(counter).padStart(12, "0")}`;
    },
    hashContent: (value) =>
      // Hash determinista y del largo que el schema exige; el contenido real no
      // importa acá, sólo que dos contenidos distintos difieran.
      [...value]
        .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 16 ** 8, 7)
        .toString(16)
        .padStart(64, "0"),
    ...overrides,
  };
}

function storedClassification(
  subjectId: string,
  code: string,
  pin: SectorSourcePin,
): SubjectClassification {
  return subjectClassificationSchema.parse({
    classificationAssignmentId: "44444444-4444-4444-8444-444444444444",
    subjectType: "legal_entity",
    subjectId,
    taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    taxonomyVersion: pin.commit,
    code,
    label: "Stored",
    validFrom: pin.committedAt,
    validTo: null,
    availableAt: pin.committedAt,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "a".repeat(64),
    recordedAt: pin.committedAt,
  });
}

describe("planSectorClassification", () => {
  it("opens an assertion dated by the pin, not by the run", () => {
    const plan = planSectorClassification(
      makeInput({
        claims: [
          {
            subjectId: APPLE,
            rawSector: "Information Technology",
            claimSymbol: "AAPL",
          },
        ],
      }),
    );

    expect(plan.ruleVersion).toBe(SECTOR_CLASSIFICATION_RULE_VERSION);
    expect(plan.opened).toHaveLength(1);

    const opened = plan.opened[0]!;

    expect(opened.code).toBe("information-technology");
    expect(opened.taxonomyVersion).toBe(PIN_A.commit);
    // `available_at` es el commit y no el instante de la corrida: de eso depende
    // que un `as_known` anterior al commit no vea la clasificación (`TM-06`).
    expect(opened.availableAt).toBe(PIN_A.committedAt);
    expect(opened.validFrom).toBe(PIN_A.committedAt);
    expect(opened.recordedAt).not.toBe(opened.availableAt);
  });

  it("writes nothing when the same pin is constituted twice", () => {
    const stored = storedClassification(APPLE, "information-technology", PIN_A);

    const plan = planSectorClassification(
      makeInput({
        claims: [
          {
            subjectId: APPLE,
            rawSector: "Information Technology",
            claimSymbol: "AAPL",
          },
        ],
        stored: [stored],
      }),
    );

    expect(plan.opened).toHaveLength(0);
    expect(plan.supersessions).toHaveLength(0);
    expect(plan.counts.unchanged).toBe(1);
  });

  it("confirms an unchanged sector under a new pin without rewriting the row", () => {
    // El pin nuevo confirma lo mismo: nada cambió, así que no hay fila nueva. Si
    // la versión entrara en el contenido, cada rebalanceo reescribiría las 500
    // filas y el historial dejaría de distinguir un cambio de sector de un
    // cambio de pin.
    const stored = storedClassification(APPLE, "information-technology", PIN_A);

    const plan = planSectorClassification(
      makeInput({
        pin: PIN_B,
        claims: [
          {
            subjectId: APPLE,
            rawSector: "Information Technology",
            claimSymbol: "AAPL",
          },
        ],
        stored: [stored],
      }),
    );

    expect(plan.opened).toHaveLength(0);
    expect(plan.counts.unchanged).toBe(1);
  });

  it("supersedes rather than closing in a date the source never published", () => {
    const stored = storedClassification(EXXON, "energy", PIN_A);

    const plan = planSectorClassification(
      makeInput({
        pin: PIN_B,
        claims: [
          { subjectId: EXXON, rawSector: "Utilities", claimSymbol: "XOM" },
        ],
        stored: [stored],
      }),
    );

    expect(plan.supersessions).toEqual([
      {
        subjectId: EXXON,
        validFrom: PIN_A.committedAt,
        supersededAt: PIN_B.committedAt,
        previousCode: "energy",
        nextCode: "utilities",
      },
    ]);
    expect(plan.opened).toHaveLength(1);
    // La aserción vieja se supersede, no se cierra: `validTo` sigue nulo porque
    // la fuente nunca dijo desde cuándo dejó de valer.
    expect(plan.supersessions[0]).not.toHaveProperty("validTo");
  });

  it("does not close an assertion the source simply stopped listing", () => {
    // La lista es autoritativa sobre quién está en el índice, no sobre de qué
    // sector es una empresa: dejar de listarla no dice que cambió de sector.
    const stored = storedClassification(EXXON, "energy", PIN_A);

    const plan = planSectorClassification(
      makeInput({ pin: PIN_B, claims: [], stored: [stored] }),
    );

    expect(plan.opened).toHaveLength(0);
    expect(plan.supersessions).toHaveLength(0);
    expect(plan.counts.notReasserted).toBe(1);
  });

  it("names an unknown label and classifies nothing for that subject", () => {
    const plan = planSectorClassification(
      makeInput({
        claims: [
          {
            subjectId: APPLE,
            rawSector: "Semiconductors",
            claimSymbol: "AAPL",
          },
        ],
      }),
    );

    expect(plan.opened).toHaveLength(0);
    expect(plan.rejections).toEqual([
      {
        claimSymbol: "AAPL",
        subjectId: APPLE,
        code: "sector_label_unknown",
      },
    ]);
  });

  it("names an absent sector without inventing a default", () => {
    const plan = planSectorClassification(
      makeInput({
        claims: [{ subjectId: APPLE, rawSector: null, claimSymbol: "AAPL" }],
      }),
    );

    expect(plan.opened).toHaveLength(0);
    expect(plan.rejections[0]!.code).toBe("sector_absent_in_source");
  });

  it("does not treat a rejected claim as a re-assertion", () => {
    // Si un rechazo contara como re-afirmación, una etiqueta rota haría
    // desaparecer al sujeto de `notReasserted` y nadie vería que quedó viejo.
    const stored = storedClassification(APPLE, "information-technology", PIN_A);

    const plan = planSectorClassification(
      makeInput({
        pin: PIN_B,
        claims: [
          {
            subjectId: APPLE,
            rawSector: "Semiconductors",
            claimSymbol: "AAPL",
          },
        ],
        stored: [stored],
      }),
    );

    expect(plan.counts.rejected).toBe(1);
    expect(plan.counts.notReasserted).toBe(1);
    expect(plan.supersessions).toHaveLength(0);
  });

  it("ignores stored assertions of another taxonomy", () => {
    // La tabla es compartida: el arquetipo de `F3-01` y la industria de `F3-05`
    // van a vivir ahí. Un planner que las mirara superseder-ía la respuesta de
    // otra pregunta.
    const other = subjectClassificationSchema.parse({
      ...storedClassification(APPLE, "growth", PIN_A),
      taxonomyId: "valuation-archetype",
    });

    const plan = planSectorClassification(
      makeInput({
        claims: [
          {
            subjectId: APPLE,
            rawSector: "Information Technology",
            claimSymbol: "AAPL",
          },
        ],
        stored: [other],
      }),
    );

    expect(plan.supersessions).toHaveLength(0);
    expect(plan.opened).toHaveLength(1);
  });
});
