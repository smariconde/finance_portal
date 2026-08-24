import { describe, expect, it } from "vitest";

import {
  computeObservationContentHash,
  computeRevisionGroupId,
  observationSchema,
  toLogicalKey,
  type Observation,
  type ObservationLogicalKey,
} from "@/modules/observations/domain/observation";

const SUBJECT_ID = "0a1b7c40-3f21-4d8e-9a01-000000000001";
const RUN_ID = "0a1b7c40-3f21-4d8e-9a01-0000000000f1";
const OBSERVATION_ID = "0a1b7c40-3f21-4d8e-9a01-0000000000a1";

const LOGICAL_KEY: ObservationLogicalKey = {
  subjectType: "legal_entity",
  subjectId: SUBJECT_ID,
  metricId: "revenue",
  concept: "Revenues",
  asOf: "2024-12-31",
  periodStart: "2024-01-01",
  periodEnd: "2024-12-31",
  periodType: "annual",
  unit: "monetary",
  currency: "USD",
  sourceId: "fixture-demo-fundamentals",
  datasetId: "demo.fundamentals.annual",
  valueBasis: "reported",
};

function observation(overrides: Record<string, unknown> = {}): Observation {
  return observationSchema.parse({
    observationId: OBSERVATION_ID,
    ...LOGICAL_KEY,
    parserVersion: "fixture-1.0.0",
    rawValue: "100000000",
    rawValueStatus: "stored",
    normalizedValue: null,
    transformationId: null,
    availableAt: "2025-02-20T21:00:00.000Z",
    supersededAt: null,
    fetchedAt: "2026-08-24T10:00:00.000Z",
    recordedAt: "2026-08-24T10:00:00.000Z",
    revisionGroupId: computeRevisionGroupId(LOGICAL_KEY),
    revisionNumber: 1,
    restatementOfId: null,
    contentHash: computeObservationContentHash({
      logicalKey: LOGICAL_KEY,
      parserVersion: "fixture-1.0.0",
      rawValue: "100000000",
      rawValueStatus: "stored",
      normalizedValue: null,
      availableAt: "2025-02-20T21:00:00.000Z",
      sourceDocumentId: "fixtureco-fy2024-annual-report",
      externalId: "fixtureco-2024-revenue",
      qualityFlags: [],
    }),
    qualityFlags: [],
    sourceDocumentId: "fixtureco-fy2024-annual-report",
    externalId: "fixtureco-2024-revenue",
    ingestionRunId: RUN_ID,
    ...overrides,
  });
}

describe("observationSchema", () => {
  it("accepts a complete reported observation", () => {
    expect(observation().revisionNumber).toBe(1);
  });

  it("keeps a missing value null with its reason instead of zero", () => {
    expect(
      observation({ rawValue: null, rawValueStatus: "not_provided" }).rawValue,
    ).toBeNull();
    // Un cero donde la fuente no publicó nada es un dato inventado.
    expect(() =>
      observation({ rawValue: "0", rawValueStatus: "not_provided" }),
    ).toThrow();
    expect(() =>
      observation({ rawValue: null, rawValueStatus: "stored" }),
    ).toThrow();
  });

  it("preserves a negative result without normalising its sign", () => {
    expect(observation({ rawValue: "-4200000" }).rawValue).toBe("-4200000");
  });

  it("requires a versioned transformation behind any normalized value", () => {
    expect(() => observation({ normalizedValue: "96000000" })).toThrow();
    expect(
      observation({
        normalizedValue: "96000000",
        transformationId: "usd-restated-1.0.0",
      }).normalizedValue,
    ).toBe("96000000");
  });

  it("links every revision after the first to the one it restates", () => {
    expect(() => observation({ revisionNumber: 2 })).toThrow();
    expect(() =>
      observation({ revisionNumber: 1, restatementOfId: OBSERVATION_ID }),
    ).toThrow();
    expect(
      observation({ revisionNumber: 2, restatementOfId: OBSERVATION_ID })
        .restatementOfId,
    ).toBe(OBSERVATION_ID);
  });

  it("rejects a supersession that precedes the publication it replaces", () => {
    expect(() =>
      observation({ supersededAt: "2025-01-01T00:00:00.000Z" }),
    ).toThrow();
    expect(
      observation({ supersededAt: "2025-05-01T14:00:00.000Z" }).supersededAt,
    ).toBe("2025-05-01T14:00:00.000Z");
  });

  it("rejects an instant observation that carries a period interval", () => {
    expect(() => observation({ periodType: "instant" })).toThrow();
    expect(
      observation({
        periodType: "instant",
        periodStart: null,
        periodEnd: null,
        unit: "shares",
        currency: null,
      }).periodType,
    ).toBe("instant");
  });

  it("rejects an inverted period", () => {
    expect(() =>
      observation({ periodStart: "2024-12-31", periodEnd: "2024-01-01" }),
    ).toThrow();
  });
});

describe("computeRevisionGroupId", () => {
  it("is stable regardless of key order", () => {
    const reordered = Object.fromEntries(
      Object.entries(LOGICAL_KEY).reverse(),
    ) as ObservationLogicalKey;

    expect(computeRevisionGroupId(reordered)).toBe(
      computeRevisionGroupId(LOGICAL_KEY),
    );
  });

  it("separates facts that differ in unit, currency, period or subject", () => {
    const base = computeRevisionGroupId(LOGICAL_KEY);

    expect(
      computeRevisionGroupId({ ...LOGICAL_KEY, currency: "ARS" }),
    ).not.toBe(base);
    expect(computeRevisionGroupId({ ...LOGICAL_KEY, unit: "shares" })).not.toBe(
      base,
    );
    expect(
      computeRevisionGroupId({ ...LOGICAL_KEY, asOf: "2023-12-31" }),
    ).not.toBe(base);
    expect(
      computeRevisionGroupId({
        ...LOGICAL_KEY,
        subjectId: "0a1b7c40-3f21-4d8e-9a01-000000000003",
      }),
    ).not.toBe(base);
  });

  it("keeps every revision of one fact inside the same chain", () => {
    // La parser version no forma parte de la clave lógica: corregir el parser
    // produce otra revisión del mismo hecho, no un hecho distinto.
    expect(
      toLogicalKey(observation({ parserVersion: "fixture-2.0.0" })),
    ).toStrictEqual(LOGICAL_KEY);
  });
});

describe("computeObservationContentHash", () => {
  const input = {
    logicalKey: LOGICAL_KEY,
    parserVersion: "fixture-1.0.0",
    rawValue: "100000000" as string | null,
    rawValueStatus: "stored",
    normalizedValue: null,
    availableAt: "2025-02-20T21:00:00.000Z",
    sourceDocumentId: "fixtureco-fy2024-annual-report",
    externalId: "fixtureco-2024-revenue",
    qualityFlags: [] as readonly string[],
  };

  it("is deterministic for the same published content", () => {
    expect(computeObservationContentHash(input)).toBe(
      computeObservationContentHash({ ...input }),
    );
  });

  it("changes when the value, its availability or the parser change", () => {
    const base = computeObservationContentHash(input);

    expect(
      computeObservationContentHash({ ...input, rawValue: "96000000" }),
    ).not.toBe(base);
    expect(
      computeObservationContentHash({
        ...input,
        availableAt: "2025-05-01T14:00:00.000Z",
      }),
    ).not.toBe(base);
    // Una corrección de parser sobre el mismo payload es contenido distinto.
    expect(
      computeObservationContentHash({
        ...input,
        parserVersion: "fixture-2.0.0",
      }),
    ).not.toBe(base);
  });

  it("does not depend on the order of quality flags", () => {
    expect(
      computeObservationContentHash({ ...input, qualityFlags: ["a", "b"] }),
    ).toBe(
      computeObservationContentHash({ ...input, qualityFlags: ["b", "a"] }),
    );
  });
});
