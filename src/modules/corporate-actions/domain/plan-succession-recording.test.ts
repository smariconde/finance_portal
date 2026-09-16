import { describe, expect, it } from "vitest";

import {
  identityGraphSchema,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";

import {
  buildFixtureDeclaration,
  buildSuccessionFixtureGraph,
  FIXTURE_EFFECTIVE_FROM,
  FIXTURE_PREDECESSOR_CIK,
  FIXTURE_PREDECESSOR_FILINGS,
  FIXTURE_PREDECESSOR_NAME,
  FIXTURE_SUCCESSION_ACCEPTED_AT,
  FIXTURE_SUCCESSOR_CIK,
  FIXTURE_SUCCESSOR_ENTITY_ID,
  FIXTURE_SUCCESSOR_FILINGS,
  FIXTURE_SUCCESSOR_NAME,
} from "../infrastructure/fixture-succession";
import {
  planSuccessionRecording,
  type SuccessionRecordingInput,
  type SuccessionRecordingPlan,
} from "./plan-succession-recording";
import type { LegalEntityRelationship } from "./reporting-succession";
import {
  verifySuccessionEvidence,
  type VerifiedSuccessionEvidence,
} from "./verify-succession-evidence";

const OPENED_AT = "2025-09-10T11:59:00.000Z";
const RECORDED_AT = "2025-09-10T12:00:00.000Z";

function evidence(): VerifiedSuccessionEvidence {
  const result = verifySuccessionEvidence({
    declaration: buildFixtureDeclaration(),
    successor: {
      cik: FIXTURE_SUCCESSOR_CIK,
      entityName: FIXTURE_SUCCESSOR_NAME,
      filings: FIXTURE_SUCCESSOR_FILINGS,
    },
    predecessor: {
      cik: FIXTURE_PREDECESSOR_CIK,
      entityName: FIXTURE_PREDECESSOR_NAME,
      filings: FIXTURE_PREDECESSOR_FILINGS,
    },
  });

  if (!result.ok) {
    throw new Error(`fixture evidence rejected: ${result.code}`);
  }

  return result.evidence;
}

function ids(prefix: string) {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${prefix}${String(sequence).padStart(12 - prefix.length, "0")}`;
  };
}

function plan(
  overrides: Partial<SuccessionRecordingInput> = {},
): SuccessionRecordingPlan {
  return planSuccessionRecording({
    declaration: buildFixtureDeclaration(),
    evidence: evidence(),
    graph: buildSuccessionFixtureGraph(),
    corporateActions: [],
    relationships: [],
    identityOpenedAt: OPENED_AT,
    recordedAt: RECORDED_AT,
    newId: ids("a"),
    ...overrides,
  });
}

/** Aplica un plan sobre el grafo como lo haría el repositorio. */
function applied(
  graph: IdentityGraph,
  result: SuccessionRecordingPlan,
): IdentityGraph {
  return identityGraphSchema.parse({
    ...graph,
    legalEntities: [...graph.legalEntities, ...result.legalEntities],
    identifierAssignments: [
      ...graph.identifierAssignments,
      ...result.identifierAssignments,
    ],
  });
}

function withEntity(graph: IdentityGraph, cik: string, entityId: string) {
  const [entity] = graph.legalEntities;
  const [assignment] = graph.identifierAssignments;

  return identityGraphSchema.parse({
    ...graph,
    legalEntities: [
      ...graph.legalEntities,
      { ...entity!, legalEntityId: entityId, legalName: `Filer ${cik}` },
    ],
    identifierAssignments: [
      ...graph.identifierAssignments,
      {
        ...assignment!,
        identifierAssignmentId: entityId.replace(/.$/u, "9"),
        subjectId: entityId,
        identifierValue: cik,
        normalizedValue: cik,
      },
    ],
  });
}

function openRelationship(
  predecessor: string,
  successor: string,
  suffix: string,
): LegalEntityRelationship {
  return {
    relationshipId: `00000000-0000-4000-8000-0000000e${suffix.padStart(4, "0")}`,
    relationshipType: "reporting_successor",
    predecessorLegalEntityId: predecessor,
    successorLegalEntityId: successor,
    corporateActionId: `00000000-0000-4000-8000-0000000c${suffix.padStart(4, "0")}`,
    effectiveOn: "2020-01-02",
    decidedBy: "owner",
    decisionRuleVersion: "sec-succession-evidence-1.0.0",
    validFrom: "2020-01-02T05:00:00.000Z",
    validTo: null,
    availableAt: "2020-01-02T15:00:00.000Z",
    supersededAt: null,
    sourceId: "sec-edgar",
    sourceDocumentId: "0000000900-20-000001",
    contentHash: "b".repeat(64),
    recordedAt: RECORDED_AT,
  };
}

describe("planSuccessionRecording", () => {
  it("abre el antecesor como entidad propia con su CIK, el evento y el vínculo", () => {
    const result = plan();

    expect(result.status).toBe("planned");
    expect(result.successorLegalEntityId).toBe(FIXTURE_SUCCESSOR_ENTITY_ID);
    expect(result.predecessorLegalEntityId).not.toBe(
      FIXTURE_SUCCESSOR_ENTITY_ID,
    );
    expect(result.legalEntities).toHaveLength(1);
    expect(result.legalEntities[0]).toMatchObject({
      legalEntityId: result.predecessorLegalEntityId,
      legalName: FIXTURE_PREDECESSOR_NAME,
      entityType: "other",
      jurisdiction: null,
      status: "unknown",
      // La identidad no se backdatea: el grafo la conoce desde la descarga.
      validFrom: OPENED_AT,
      availableAt: OPENED_AT,
    });
    expect(result.identifierAssignments).toStrictEqual([
      expect.objectContaining({
        subjectType: "legal_entity",
        subjectId: result.predecessorLegalEntityId,
        identifierType: "cik",
        normalizedValue: FIXTURE_PREDECESSOR_CIK,
        scope: "sec:filer",
        confidence: "authoritative",
      }),
    ]);
    expect(result.corporateActions).toStrictEqual([
      expect.objectContaining({
        actionType: "successor_issuer",
        subjectId: FIXTURE_SUCCESSOR_ENTITY_ID,
        effectiveOn: "2025-07-01",
        availableAt: FIXTURE_SUCCESSION_ACCEPTED_AT,
        terms: {
          form: "8-K12B",
          predecessorCik: FIXTURE_PREDECESSOR_CIK,
          successorCik: FIXTURE_SUCCESSOR_CIK,
        },
      }),
    ]);
    expect(result.relationships).toStrictEqual([
      expect.objectContaining({
        relationshipType: "reporting_successor",
        predecessorLegalEntityId: result.predecessorLegalEntityId,
        successorLegalEntityId: FIXTURE_SUCCESSOR_ENTITY_ID,
        corporateActionId: result.corporateActions[0]!.corporateActionId,
        effectiveOn: "2025-07-01",
        // El vínculo sí tiene fecha pública propia: la de la presentación.
        validFrom: FIXTURE_EFFECTIVE_FROM,
        availableAt: FIXTURE_SUCCESSION_ACCEPTED_AT,
        decidedBy: "owner",
      }),
    ]);
  });

  it("no abre nada la segunda vez aunque cambien los IDs y el reloj", () => {
    const first = plan();
    const second = plan({
      graph: applied(buildSuccessionFixtureGraph(), first),
      corporateActions: first.corporateActions,
      relationships: first.relationships,
      recordedAt: "2025-10-01T00:00:00.000Z",
      identityOpenedAt: "2025-10-01T00:00:00.000Z",
      newId: ids("b"),
    });

    expect(second).toMatchObject({
      status: "unchanged",
      rejection: null,
      predecessorLegalEntityId: first.predecessorLegalEntityId,
      legalEntities: [],
      identifierAssignments: [],
      corporateActions: [],
      relationships: [],
    });
  });

  it("reusa un antecesor cuyo CIK ya está en el grafo", () => {
    const known = "00000000-0000-4000-8000-0000000000a1";
    const result = plan({
      graph: withEntity(
        buildSuccessionFixtureGraph(),
        FIXTURE_PREDECESSOR_CIK,
        known,
      ),
    });

    expect(result.status).toBe("planned");
    expect(result.predecessorLegalEntityId).toBe(known);
    expect(result.legalEntities).toHaveLength(0);
    expect(result.identifierAssignments).toHaveLength(0);
  });

  it("rechaza un sucesor que no está en el grafo sin traerlo al universo", () => {
    const graph = identityGraphSchema.parse({
      ...buildSuccessionFixtureGraph(),
      legalEntities: [],
      identifierAssignments: [],
    });

    expect(plan({ graph })).toMatchObject({
      status: "rejected",
      rejection: "successor_not_in_graph",
      legalEntities: [],
    });
  });

  it("rechaza dos CIK que ya son la misma entidad", () => {
    const graph = withEntity(
      buildSuccessionFixtureGraph(),
      FIXTURE_PREDECESSOR_CIK,
      FIXTURE_SUCCESSOR_ENTITY_ID,
    );

    expect(plan({ graph })).toMatchObject({
      rejection: "predecessor_is_successor",
    });
  });

  it("rechaza un segundo antecesor abierto para el mismo sucesor", () => {
    const other = "00000000-0000-4000-8000-0000000000a2";
    const graph = withEntity(
      buildSuccessionFixtureGraph(),
      "0000000073",
      other,
    );

    expect(
      plan({
        graph,
        relationships: [
          openRelationship(other, FIXTURE_SUCCESSOR_ENTITY_ID, "1"),
        ],
      }),
    ).toMatchObject({
      status: "rejected",
      rejection: "successor_has_other_predecessor",
      legalEntities: [],
      relationships: [],
    });
  });

  it("rechaza un antecesor que ya tiene otro sucesor abierto", () => {
    const known = "00000000-0000-4000-8000-0000000000a1";
    const elsewhere = "00000000-0000-4000-8000-0000000000a3";
    let graph = withEntity(
      buildSuccessionFixtureGraph(),
      FIXTURE_PREDECESSOR_CIK,
      known,
    );
    graph = withEntity(graph, "0000000074", elsewhere);

    expect(
      plan({ graph, relationships: [openRelationship(known, elsewhere, "2")] }),
    ).toMatchObject({ rejection: "predecessor_has_other_successor" });
  });

  it("rechaza un vínculo que cerraría un ciclo en el linaje", () => {
    const known = "00000000-0000-4000-8000-0000000000a1";
    const graph = withEntity(
      buildSuccessionFixtureGraph(),
      FIXTURE_PREDECESSOR_CIK,
      known,
    );
    const between = "00000000-0000-4000-8000-0000000000a5";
    // Ya existe sucesor → intermedio → antecesor: declarar antecesor → sucesor
    // cerraría el círculo.
    const cyclic = plan({
      graph,
      relationships: [
        openRelationship(FIXTURE_SUCCESSOR_ENTITY_ID, between, "5"),
        openRelationship(between, known, "6"),
      ],
    });

    expect(cyclic).toMatchObject({ rejection: "lineage_cycle" });
  });

  it("rechaza el mismo par descrito con otra vigencia en vez de corregirlo", () => {
    const first = plan();
    const graph = applied(buildSuccessionFixtureGraph(), first);
    const drifted = { ...evidence(), effectiveOn: "2025-06-30" };

    expect(
      plan({
        graph,
        evidence: drifted,
        corporateActions: first.corporateActions,
        relationships: first.relationships,
      }),
    ).toMatchObject({
      status: "rejected",
      rejection: "conflicting_succession",
    });
  });

  it("hashea el contenido y no los IDs generados", () => {
    // Con el antecesor ya conocido, lo único que cambia entre los dos planes son
    // los IDs del evento y del vínculo, y el reloj.
    const graph = withEntity(
      buildSuccessionFixtureGraph(),
      FIXTURE_PREDECESSOR_CIK,
      "00000000-0000-4000-8000-0000000000a1",
    );
    const left = plan({ graph, newId: ids("c") });
    const right = plan({
      graph,
      newId: ids("d"),
      recordedAt: "2025-10-01T00:00:00.000Z",
    });

    expect(left.relationships[0]!.contentHash).toBe(
      right.relationships[0]!.contentHash,
    );
    expect(left.corporateActions[0]!.contentHash).toBe(
      right.corporateActions[0]!.contentHash,
    );
  });
});
