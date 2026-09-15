import { describe, expect, it } from "vitest";

import {
  declaredSuccessionSchema,
  legalEntityRelationshipSchema,
  startOfNewYorkDay,
} from "./reporting-succession";

const ENTITY_A = "00000000-0000-4000-8000-00000000000a";
const ENTITY_B = "00000000-0000-4000-8000-00000000000b";

function relationship(overrides: Record<string, unknown> = {}) {
  return {
    relationshipId: "00000000-0000-4000-8000-0000000000e1",
    relationshipType: "reporting_successor",
    predecessorLegalEntityId: ENTITY_A,
    successorLegalEntityId: ENTITY_B,
    corporateActionId: "00000000-0000-4000-8000-0000000000c1",
    effectiveOn: "2025-07-01",
    decidedBy: "owner",
    decisionRuleVersion: "sec-succession-evidence-1.0.0",
    validFrom: "2025-07-01T04:00:00.000Z",
    validTo: null,
    availableAt: "2025-07-01T15:10:00.000Z",
    supersededAt: null,
    sourceId: "sec-edgar",
    sourceDocumentId: "0000000900-25-000001",
    contentHash: "a".repeat(64),
    recordedAt: "2025-09-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("startOfNewYorkDay", () => {
  it.each([
    ["un día de horario de verano", "2026-07-01", "2026-07-01T04:00:00.000Z"],
    ["un día de horario estándar", "2026-01-15", "2026-01-15T05:00:00.000Z"],
    // El cambio ocurre a las 2:00 locales: la medianoche todavía es EST.
    [
      "el domingo que empieza el verano",
      "2026-03-08",
      "2026-03-08T05:00:00.000Z",
    ],
    // Y a la medianoche del domingo que termina todavía rige EDT.
    [
      "el domingo que termina el verano",
      "2026-11-01",
      "2026-11-01T04:00:00.000Z",
    ],
    // Antes de 2007 el verano empezaba en abril: la regla sale de la base de zonas.
    ["la regla anterior a 2007", "2006-04-02", "2006-04-02T05:00:00.000Z"],
  ])("resuelve %s", (_label, date, expected) => {
    expect(startOfNewYorkDay(date)).toBe(expected);
  });

  it("nunca devuelve medianoche UTC", () => {
    expect(startOfNewYorkDay("2025-07-01")).not.toBe(
      "2025-07-01T00:00:00.000Z",
    );
  });

  it("rechaza una fecha que el calendario no tiene", () => {
    expect(() => startOfNewYorkDay("2025-02-30")).toThrow();
  });
});

describe("declaredSuccessionSchema", () => {
  const declaration = {
    predecessorCik: "34088",
    successorCik: "2115436",
    successionAccession: "0001193125-26-291990",
    decidedBy: "owner",
    decidedOn: "2026-09-14",
    rationale: "Reorganización en holding.",
  };

  it("normaliza los CIK a diez dígitos como el grafo", () => {
    expect(declaredSuccessionSchema.parse(declaration)).toMatchObject({
      predecessorCik: "0000034088",
      successorCik: "0002115436",
    });
  });

  it("rechaza un filer que se sucede a sí mismo aunque se escriba distinto", () => {
    expect(
      declaredSuccessionSchema.safeParse({
        ...declaration,
        successorCik: "0000034088",
      }).success,
    ).toBe(false);
  });

  it("sólo acepta decisiones del owner", () => {
    expect(
      declaredSuccessionSchema.safeParse({ ...declaration, decidedBy: "rule" })
        .success,
    ).toBe(false);
  });

  it("rechaza un accession con otra forma", () => {
    expect(
      declaredSuccessionSchema.safeParse({
        ...declaration,
        successionAccession: "000119312526291990",
      }).success,
    ).toBe(false);
  });
});

describe("legalEntityRelationshipSchema", () => {
  it("acepta la vigencia al inicio del día en Nueva York", () => {
    expect(
      legalEntityRelationshipSchema.safeParse(relationship()).success,
    ).toBe(true);
  });

  it("rechaza la fecha leída como medianoche UTC", () => {
    expect(
      legalEntityRelationshipSchema.safeParse(
        relationship({ validFrom: "2025-07-01T00:00:00.000Z" }),
      ).success,
    ).toBe(false);
  });

  it("rechaza una entidad que se sucede a sí misma", () => {
    expect(
      legalEntityRelationshipSchema.safeParse(
        relationship({ successorLegalEntityId: ENTITY_A }),
      ).success,
    ).toBe(false);
  });
});
