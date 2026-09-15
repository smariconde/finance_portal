import { describe, expect, it } from "vitest";

import {
  computeObservationContentHash,
  computeRevisionGroupId,
  observationSchema,
  type Observation,
  type ObservationLogicalKey,
} from "@/modules/observations/domain/observation";
import { queryObservations } from "@/modules/observations/domain/select-observations";
import {
  pointInTimeQuerySchema,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";
import { isTemporalContractError } from "@/modules/temporal/domain/temporal-error";

import {
  queryLineageObservations,
  REPORTING_LINEAGE_RULE_VERSION,
  resolveReportingLineage,
} from "./reporting-lineage";
import type { LegalEntityRelationship } from "./reporting-succession";

const OLD = "00000000-0000-4000-8000-0000000000a1";
const MIDDLE = "00000000-0000-4000-8000-0000000000a2";
const NEW = "00000000-0000-4000-8000-0000000000a3";

/** Sucesión sintética: vigente desde el 2025-07-01 y conocible por la tarde. */
const ACCEPTED_AT = "2025-07-01T15:10:00.000Z";
const RECORDED_AT = "2025-09-10T12:00:00.000Z";

function relationship(
  overrides: Partial<LegalEntityRelationship> = {},
): LegalEntityRelationship {
  return {
    relationshipId: "00000000-0000-4000-8000-0000000000e1",
    relationshipType: "reporting_successor",
    predecessorLegalEntityId: OLD,
    successorLegalEntityId: NEW,
    corporateActionId: "00000000-0000-4000-8000-0000000000c1",
    effectiveOn: "2025-07-01",
    decidedBy: "owner",
    decisionRuleVersion: "sec-succession-evidence-1.0.0",
    validFrom: "2025-07-01T04:00:00.000Z",
    validTo: null,
    availableAt: ACCEPTED_AT,
    supersededAt: null,
    sourceId: "sec-edgar",
    sourceDocumentId: "0000000900-25-000001",
    contentHash: "a".repeat(64),
    recordedAt: RECORDED_AT,
    ...overrides,
  };
}

function query(overrides: Partial<PointInTimeQueryInput> = {}) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: "2026-06-01T00:00:00.000Z",
    revisionPolicy: "as_known",
    knownAt: "2026-06-01T00:00:00.000Z",
    knowledgeBasis: "public_availability",
    sourcePolicyVersion: "source-policy-1.0.0",
    ...overrides,
  } as PointInTimeQueryInput);
}

let sequence = 0;

function fact(fields: {
  subjectId: string;
  asOf: string;
  rawValue: string;
  availableAt: string;
  periodStart?: string;
  revisionNumber?: number;
  supersededAt?: string | null;
  recordedAt?: string;
}): Observation {
  sequence += 1;
  const key: ObservationLogicalKey = {
    subjectType: "legal_entity",
    subjectId: fields.subjectId,
    metricId: "us-gaap:Revenues",
    concept: "us-gaap:Revenues",
    asOf: fields.asOf,
    periodStart: fields.periodStart ?? `${fields.asOf.slice(0, 4)}-01-01`,
    periodEnd: fields.asOf,
    periodType: "annual",
    unit: "monetary",
    currency: "USD",
    sourceId: "sec-edgar",
    datasetId: "sec.companyfacts",
    valueBasis: "reported",
  };
  const revisionNumber = fields.revisionNumber ?? 1;

  return observationSchema.parse({
    observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    ...key,
    parserVersion: "sec-companyfacts-1.0.0",
    rawValue: fields.rawValue,
    rawValueStatus: "stored",
    normalizedValue: null,
    transformationId: null,
    availableAt: fields.availableAt,
    supersededAt: fields.supersededAt ?? null,
    fetchedAt: fields.recordedAt ?? RECORDED_AT,
    recordedAt: fields.recordedAt ?? RECORDED_AT,
    revisionGroupId: computeRevisionGroupId(key),
    revisionNumber,
    restatementOfId:
      revisionNumber === 1 ? null : "00000000-0000-4000-8000-0000000000b1",
    contentHash: computeObservationContentHash({
      logicalKey: key,
      parserVersion: "sec-companyfacts-1.0.0",
      rawValue: fields.rawValue,
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
    ingestionRunId: "00000000-0000-4000-8000-0000000000f1",
  });
}

/** Historia del antecesor, un comparativo repetido y el primer año del sucesor. */
const OLD_2023 = fact({
  subjectId: OLD,
  asOf: "2023-12-31",
  rawValue: "900",
  availableAt: "2024-02-20T21:00:00.000Z",
});
const OLD_2024 = fact({
  subjectId: OLD,
  asOf: "2024-12-31",
  rawValue: "1000",
  availableAt: "2025-02-20T21:05:00.000Z",
});
const NEW_2024_COMPARATIVE = fact({
  subjectId: NEW,
  asOf: "2024-12-31",
  rawValue: "1000",
  availableAt: "2026-02-18T21:00:00.000Z",
});
const NEW_2025 = fact({
  subjectId: NEW,
  asOf: "2025-12-31",
  rawValue: "1200",
  availableAt: "2026-02-18T21:00:00.000Z",
});

describe("resolveReportingLineage", () => {
  it("devuelve sólo al sujeto cuando no hay vínculo", () => {
    expect(resolveReportingLineage([], NEW, query())).toStrictEqual({
      ruleVersion: REPORTING_LINEAGE_RULE_VERSION,
      legalEntityId: NEW,
      segments: [
        { legalEntityId: NEW, reportsBefore: null, relationshipId: null },
      ],
    });
  });

  it("suma al antecesor con la vigencia como borde exclusivo", () => {
    expect(
      resolveReportingLineage([relationship()], NEW, query()).segments,
    ).toStrictEqual([
      { legalEntityId: NEW, reportsBefore: null, relationshipId: null },
      {
        legalEntityId: OLD,
        reportsBefore: "2025-07-01",
        relationshipId: "00000000-0000-4000-8000-0000000000e1",
      },
    ]);
  });

  it("no ve al antecesor un segundo antes de la presentación de sucesión", () => {
    const before = query({
      effectiveAt: "2025-07-01T15:09:59.000Z",
      knownAt: "2025-07-01T15:09:59.000Z",
    });
    const at = query({ effectiveAt: ACCEPTED_AT, knownAt: ACCEPTED_AT });

    expect(
      resolveReportingLineage([relationship()], NEW, before).segments,
    ).toHaveLength(1);
    expect(
      resolveReportingLineage([relationship()], NEW, at).segments,
    ).toHaveLength(2);
  });

  it("bajo system_recorded exige además que la instalación lo haya registrado", () => {
    const known = query({
      knowledgeBasis: "system_recorded",
      knownAt: "2025-08-01T00:00:00.000Z",
    });

    expect(
      resolveReportingLineage([relationship()], NEW, known).segments,
    ).toHaveLength(1);
  });

  it("no aplica el vínculo a una fecha efectiva anterior a la sucesión", () => {
    const early = query({ effectiveAt: "2025-06-30T12:00:00.000Z" });

    expect(
      resolveReportingLineage([relationship()], NEW, early).segments,
    ).toHaveLength(1);
  });

  it("encadena dos sucesiones con el borde más temprano para el más lejano", () => {
    const lineage = resolveReportingLineage(
      [
        relationship({ predecessorLegalEntityId: MIDDLE }),
        relationship({
          relationshipId: "00000000-0000-4000-8000-0000000000e2",
          predecessorLegalEntityId: OLD,
          successorLegalEntityId: MIDDLE,
          effectiveOn: "2020-01-02",
          validFrom: "2020-01-02T05:00:00.000Z",
          availableAt: "2020-01-02T15:00:00.000Z",
        }),
      ],
      NEW,
      query(),
    );

    expect(
      lineage.segments.map((segment) => [
        segment.legalEntityId,
        segment.reportsBefore,
      ]),
    ).toStrictEqual([
      [NEW, null],
      [MIDDLE, "2025-07-01"],
      [OLD, "2020-01-02"],
    ]);
  });

  it("declara ambiguo un sujeto con dos antecesores visibles", () => {
    try {
      resolveReportingLineage(
        [
          relationship(),
          relationship({
            relationshipId: "00000000-0000-4000-8000-0000000000e3",
            predecessorLegalEntityId: MIDDLE,
          }),
        ],
        NEW,
        query(),
      );
      expect.unreachable("dos antecesores no tienen desempate");
    } catch (error) {
      expect(isTemporalContractError(error, "ambiguous_identity")).toBe(true);
    }
  });

  it("corta un ciclo en vez de recorrerlo", () => {
    expect(() =>
      resolveReportingLineage(
        [
          relationship(),
          relationship({
            relationshipId: "00000000-0000-4000-8000-0000000000e4",
            predecessorLegalEntityId: NEW,
            successorLegalEntityId: OLD,
          }),
        ],
        NEW,
        query(),
      ),
    ).toThrow(/cycle/u);
  });
});

describe("queryLineageObservations", () => {
  const lineage = resolveReportingLineage([relationship()], NEW, query());
  const all = [OLD_2023, OLD_2024, NEW_2024_COMPARATIVE, NEW_2025];

  it("une la historia del antecesor sin reasignar el sujeto de sus hechos", () => {
    const selection = queryLineageObservations(all, lineage, {}, query(), []);

    expect(
      selection.observations.map((observation) => [
        observation.asOf,
        observation.subjectId,
        observation.rawValue,
      ]),
    ).toStrictEqual([
      ["2023-12-31", OLD, "900"],
      // El comparativo lo repitió el sucesor después: gana su vintage, con el
      // mismo valor.
      ["2024-12-31", NEW, "1000"],
      ["2025-12-31", NEW, "1200"],
    ]);
    expect(selection.overlaps).toStrictEqual({
      sameValue: 1,
      differentValue: 0,
    });
  });

  it("antes de que el sucesor repita el comparativo usa la vintage del antecesor", () => {
    const at = query({
      knownAt: "2025-12-01T00:00:00.000Z",
      effectiveAt: "2025-12-01T00:00:00.000Z",
    });
    const selection = queryLineageObservations(
      all,
      resolveReportingLineage([relationship()], NEW, at),
      {},
      at,
      [],
    );

    expect(
      selection.observations.map((observation) => observation.subjectId),
    ).toStrictEqual([OLD, OLD]);
  });

  it("excluye lo que el antecesor reporte de períodos posteriores a la vigencia", () => {
    const afterSuccession = fact({
      subjectId: OLD,
      asOf: "2025-07-01",
      periodStart: "2024-07-02",
      rawValue: "777",
      availableAt: "2025-08-01T20:00:00.000Z",
    });
    const selection = queryLineageObservations(
      [...all, afterSuccession],
      lineage,
      {},
      query(),
      [],
    );

    expect(
      selection.observations.some(
        (observation) =>
          observation.observationId === afterSuccession.observationId,
      ),
    ).toBe(false);
  });

  it("ante valores distintos gana la revisión conocible más reciente", () => {
    const restatedBySuccessor = fact({
      subjectId: NEW,
      asOf: "2024-12-31",
      rawValue: "950",
      availableAt: "2026-02-18T21:00:00.000Z",
    });
    const selection = queryLineageObservations(
      [OLD_2024, restatedBySuccessor],
      lineage,
      {},
      query(),
      [],
    );

    expect(selection.observations.map((row) => row.rawValue)).toStrictEqual([
      "950",
    ]);
    expect(selection.overlaps).toStrictEqual({
      sameValue: 0,
      differentValue: 1,
    });
  });

  it("respeta la revisión vigente dentro de la cadena de cada segmento", () => {
    const amended = {
      ...fact({
        subjectId: OLD,
        asOf: "2023-12-31",
        rawValue: "880",
        availableAt: "2024-06-01T20:00:00.000Z",
        revisionNumber: 2,
      }),
      restatementOfId: OLD_2023.observationId,
    };
    const original = { ...OLD_2023, supersededAt: "2024-06-01T20:00:00.000Z" };
    const early = query({
      knownAt: "2025-08-01T00:00:00.000Z",
      effectiveAt: "2025-08-01T00:00:00.000Z",
    });
    const beforeAmendment = query({
      knownAt: "2024-03-01T00:00:00.000Z",
      effectiveAt: "2025-08-01T00:00:00.000Z",
    });

    const values = (at: typeof early) =>
      queryLineageObservations(
        [original, amended],
        resolveReportingLineage([relationship()], NEW, early),
        {},
        at,
        [],
      ).observations.map((row) => row.rawValue);

    expect(values(early)).toStrictEqual(["880"]);
    expect(values(beforeAmendment)).toStrictEqual(["900"]);
  });

  it("dos filers con valores distintos en el mismo instante no tienen desempate", () => {
    const sameInstant = fact({
      subjectId: NEW,
      asOf: "2024-12-31",
      rawValue: "999",
      availableAt: OLD_2024.availableAt,
    });

    try {
      queryLineageObservations(
        [OLD_2024, sameInstant],
        lineage,
        {},
        query(),
        [],
      );
      expect.unreachable("el mismo instante con dos valores es ambiguo");
    } catch (error) {
      expect(isTemporalContractError(error, "ambiguous_revision")).toBe(true);
    }
  });

  it("compara importes como decimales y no como texto", () => {
    const rescaled = fact({
      subjectId: NEW,
      asOf: "2024-12-31",
      rawValue: "1000.00",
      availableAt: OLD_2024.availableAt,
    });
    const selection = queryLineageObservations(
      [OLD_2024, rescaled],
      lineage,
      {},
      query(),
      [],
    );

    expect(selection.overlaps.sameValue).toBe(1);
    // Mismo instante y mismo valor: gana el segmento más cercano al sujeto.
    expect(selection.observations[0]!.subjectId).toBe(NEW);
  });

  it("declara la política de ajuste y deja la base reportada con as_known", () => {
    const selection = queryLineageObservations(all, lineage, {}, query(), []);

    expect(selection.adjustment).toStrictEqual({
      policy: "as_known",
      ruleVersion: null,
    });
    expect(
      selection.rows.map((row) => [row.value, row.basis, row.revisionKind]),
    ).toStrictEqual([
      ["900", "as_reported", "original"],
      ["1000", "as_reported", "original"],
      ["1200", "as_reported", "original"],
    ]);
  });

  it("con latest_adjusted un importe del antecesor se lee igual: no está en acciones", () => {
    const selection = queryLineageObservations(
      all,
      lineage,
      {},
      query({ adjustmentPolicy: "latest_adjusted" }),
      [],
    );

    expect(selection.rows.map((row) => row.value)).toStrictEqual([
      "900",
      "1000",
      "1200",
    ]);
    expect(selection.adjustment.ruleVersion).toBe("split-adjustment-1.0.0");
  });

  it("sin vínculo coincide exactamente con la selección por sujeto", () => {
    const alone = resolveReportingLineage([], NEW, query());

    expect(
      queryLineageObservations(all, alone, {}, query(), []).observations,
    ).toStrictEqual(
      queryObservations(
        all,
        { subjectType: "legal_entity", subjectId: NEW },
        query(),
      ),
    );
  });
});
