import { describe, expect, it } from "vitest";

import {
  computeObservationContentHash,
  computeRevisionGroupId,
  observationSchema,
  type Observation,
  type ObservationLogicalKey,
} from "@/modules/observations/domain/observation";
import {
  assertSameUnitAndCurrency,
  queryObservations,
  selectLatestPerMetric,
  selectRevision,
} from "@/modules/observations/domain/select-observations";
import {
  pointInTimeQuerySchema,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";
import { isTemporalContractError } from "@/modules/temporal/domain/temporal-error";

const SUBJECT_ID = "0a1b7c40-3f21-4d8e-9a01-000000000001";
const RUN_ID = "0a1b7c40-3f21-4d8e-9a01-0000000000f1";

function logicalKey(
  overrides: Partial<ObservationLogicalKey> = {},
): ObservationLogicalKey {
  return {
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
    ...overrides,
  };
}

let sequence = 0;

function observation(fields: {
  key?: Partial<ObservationLogicalKey>;
  rawValue?: string | null;
  availableAt: string;
  recordedAt?: string;
  supersededAt?: string | null;
  revisionNumber?: number;
  restatementOfId?: string | null;
}): Observation {
  sequence += 1;
  const key = logicalKey(fields.key);
  const revisionNumber = fields.revisionNumber ?? 1;

  return observationSchema.parse({
    observationId: `0a1b7c40-3f21-4d8e-9a01-${String(sequence).padStart(12, "0")}`,
    ...key,
    parserVersion: "fixture-1.0.0",
    rawValue: fields.rawValue ?? "100000000",
    rawValueStatus:
      (fields.rawValue ?? "100000000") === null ? "not_provided" : "stored",
    normalizedValue: null,
    transformationId: null,
    availableAt: fields.availableAt,
    supersededAt: fields.supersededAt ?? null,
    fetchedAt: fields.recordedAt ?? "2026-08-24T10:00:00.000Z",
    recordedAt: fields.recordedAt ?? "2026-08-24T10:00:00.000Z",
    revisionGroupId: computeRevisionGroupId(key),
    revisionNumber,
    restatementOfId:
      fields.restatementOfId ??
      (revisionNumber === 1 ? null : "0a1b7c40-3f21-4d8e-9a01-0000000000b1"),
    contentHash: computeObservationContentHash({
      logicalKey: key,
      parserVersion: "fixture-1.0.0",
      rawValue: fields.rawValue ?? "100000000",
      rawValueStatus: "stored",
      normalizedValue: null,
      availableAt: fields.availableAt,
      sourceDocumentId: null,
      externalId: `external-${sequence}`,
      qualityFlags: [],
    }),
    qualityFlags: [],
    sourceDocumentId: null,
    externalId: `external-${sequence}`,
    ingestionRunId: RUN_ID,
  });
}

function query(overrides: Partial<PointInTimeQueryInput> = {}) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: "2025-06-01T00:00:00.000Z",
    revisionPolicy: "as_known",
    knownAt: "2025-06-01T00:00:00.000Z",
    sourcePolicyVersion: "source-policy-1.0.0",
    ...overrides,
  } as PointInTimeQueryInput);
}

/** El ejemplo de restatement del contrato point-in-time. */
const original = observation({
  rawValue: "100000000",
  availableAt: "2025-02-20T21:00:00.000Z",
  supersededAt: "2025-05-01T14:00:00.000Z",
});
const amendment = observation({
  rawValue: "96000000",
  availableAt: "2025-05-01T14:00:00.000Z",
  revisionNumber: 2,
  restatementOfId: original.observationId,
});
const chain = [original, amendment];

describe("selectRevision", () => {
  it("returns the value known at the cutoff, never a later restatement", () => {
    expect(
      selectRevision(chain, query({ knownAt: "2025-03-01T00:00:00.000Z" }))
        ?.rawValue,
    ).toBe("100000000");
  });

  it("returns the amendment once it became public", () => {
    expect(
      selectRevision(chain, query({ knownAt: "2025-06-01T00:00:00.000Z" }))
        ?.rawValue,
    ).toBe("96000000");
  });

  it("switches exactly at the instant the amendment became available", () => {
    expect(
      selectRevision(chain, query({ knownAt: "2025-05-01T13:59:59.999Z" }))
        ?.rawValue,
    ).toBe("100000000");
    expect(
      selectRevision(chain, query({ knownAt: "2025-05-01T14:00:00.000Z" }))
        ?.rawValue,
    ).toBe("96000000");
  });

  it("returns nothing before the first publication instead of a placeholder", () => {
    expect(
      selectRevision(chain, query({ knownAt: "2025-01-01T00:00:00.000Z" })),
    ).toBeNull();
  });

  it("labels the current view separately from a historical cutoff", () => {
    expect(
      selectRevision(
        chain,
        query({
          revisionPolicy: "latest_restated",
          knownAt: null,
        } as PointInTimeQueryInput),
      )?.rawValue,
    ).toBe("96000000");
  });

  it("answers what this installation had recorded under system_recorded", () => {
    const lateIngestion = [
      observation({
        rawValue: "88000000",
        availableAt: "2024-02-15T21:00:00.000Z",
        recordedAt: "2026-08-24T10:00:00.000Z",
      }),
    ];
    const knownAt = "2024-06-01T00:00:00.000Z";

    expect(
      selectRevision(
        lateIngestion,
        query({ knownAt, knowledgeBasis: "public_availability" }),
      )?.rawValue,
    ).toBe("88000000");
    expect(
      selectRevision(
        lateIngestion,
        query({ knownAt, knowledgeBasis: "system_recorded" }),
      ),
    ).toBeNull();
  });

  it("refuses to break a tie between two revisions with the same number", () => {
    const duplicated = [
      original,
      observation({
        rawValue: "97000000",
        availableAt: original.availableAt,
        supersededAt: original.supersededAt,
      }),
    ];

    try {
      selectRevision(duplicated, query());
      throw new Error("Expected selectRevision to raise.");
    } catch (error) {
      expect(isTemporalContractError(error, "ambiguous_revision")).toBe(true);
    }
  });

  it("rejects a chain that mixes revision groups", () => {
    expect(() =>
      selectRevision(
        [
          original,
          observation({
            key: { metricId: "net_income" },
            availableAt: original.availableAt,
          }),
        ],
        query(),
      ),
    ).toThrowError(/revision group/iu);
  });
});

describe("queryObservations", () => {
  const selector = {
    subjectType: "legal_entity" as const,
    subjectId: SUBJECT_ID,
  };

  it("excludes a fact whose period had not happened at the effective date", () => {
    const result = queryObservations(chain, selector, {
      ...query({ effectiveAt: "2024-06-30T00:00:00.000Z" }),
    });

    expect(result).toHaveLength(0);
  });

  it("returns one revision per chain and never both", () => {
    const result = queryObservations(chain, selector, query());

    expect(result).toHaveLength(1);
    expect(result[0]?.rawValue).toBe("96000000");
  });

  it("filters by metric without touching another subject's facts", () => {
    const netIncome = observation({
      key: { metricId: "net_income", concept: "NetIncomeLoss" },
      rawValue: "-4200000",
      availableAt: "2025-02-20T21:00:00.000Z",
    });
    const otherSubject = observation({
      key: { subjectId: "0a1b7c40-3f21-4d8e-9a01-000000000003" },
      availableAt: "2025-02-20T21:00:00.000Z",
    });

    const result = queryObservations(
      [...chain, netIncome, otherSubject],
      { ...selector, metricIds: ["net_income"] },
      query(),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.rawValue).toBe("-4200000");
  });
});

describe("selectLatestPerMetric", () => {
  it("keeps the most recent period of each metric", () => {
    const previousYear = observation({
      key: {
        asOf: "2023-12-31",
        periodStart: "2023-01-01",
        periodEnd: "2023-12-31",
      },
      rawValue: "88000000",
      availableAt: "2024-02-15T21:00:00.000Z",
    });

    const latest = selectLatestPerMetric([previousYear, amendment]);

    expect(latest).toHaveLength(1);
    expect(latest[0]?.asOf).toBe("2024-12-31");
  });

  it("reports a conflict when two independent facts share a period", () => {
    const otherSource = observation({
      key: { sourceId: "sec-edgar", datasetId: "sec.companyfacts" },
      rawValue: "99000000",
      availableAt: "2025-02-20T21:00:00.000Z",
    });

    expect(() => selectLatestPerMetric([amendment, otherSource])).toThrowError(
      /same metric and period/iu,
    );
  });
});

describe("assertSameUnitAndCurrency", () => {
  it("blocks comparing values in different currencies", () => {
    const inPesos = observation({
      key: { currency: "ARS" },
      availableAt: "2025-02-20T21:00:00.000Z",
    });

    try {
      assertSameUnitAndCurrency([amendment, inPesos]);
      throw new Error("Expected assertSameUnitAndCurrency to raise.");
    } catch (error) {
      expect(isTemporalContractError(error, "currency_or_unit_mismatch")).toBe(
        true,
      );
    }
  });

  it("accepts a homogeneous set", () => {
    expect(() => assertSameUnitAndCurrency(chain)).not.toThrow();
  });
});
