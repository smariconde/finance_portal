import {
  identifierAssignmentSchema,
  legalEntitySchema,
  type IdentifierAssignment,
  type IdentityGraph,
  type LegalEntity,
} from "@/modules/identity/domain/identity-graph";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import {
  computeCorporateActionContentHash,
  corporateActionSchema,
  legalEntityRelationshipSchema,
  startOfNewYorkDay,
  type CorporateAction,
  type DeclaredSuccession,
  type LegalEntityRelationship,
} from "./reporting-succession";
import type { VerifiedSuccessionEvidence } from "./verify-succession-evidence";

/**
 * Planificación pura del registro de una sucesión verificada.
 *
 * Igual que la constitución del universo, el planner no escribe: devuelve qué
 * versiones abre para que la persistencia sea una transacción sin lógica. Lo que
 * decide:
 *
 * 1. el sucesor tiene que existir en el grafo por su CIK. Una sucesión no trae
 *    empresas al universo;
 * 2. el antecesor se reusa si su CIK ya está asignado y, si no, entra al grafo
 *    como entidad legal propia con su CIK. Nunca hereda el ID del sucesor;
 * 3. registrar dos veces la misma sucesión no abre nada. Una descripción distinta
 *    del mismo par es un conflicto nombrado, no una corrección silenciosa;
 * 4. un sucesor tiene a lo sumo un antecesor de reporte, un antecesor a lo sumo un
 *    sucesor, y el linaje no tiene ciclos. Dos antecesores serían dos historias
 *    del mismo período sin regla para elegir.
 */
export const SUCCESSION_RECORDING_RULE_VERSION = "succession-recording-1.0.0";

const CIK_SCOPE = "sec:filer";
const SEC_AUTHORITY = "U.S. Securities and Exchange Commission";

export type SuccessionPlanRejectionCode =
  | "successor_not_in_graph"
  /** Los dos CIK ya apuntan a la misma entidad legal. */
  | "predecessor_is_successor"
  | "successor_has_other_predecessor"
  | "predecessor_has_other_successor"
  | "lineage_cycle"
  /** El mismo par ya está registrado con otra evidencia o vigencia. */
  | "conflicting_succession";

export type SuccessionRecordingPlan = {
  readonly ruleVersion: string;
  readonly evidenceRuleVersion: string;
  readonly status: "planned" | "unchanged" | "rejected";
  readonly rejection: SuccessionPlanRejectionCode | null;
  readonly successorLegalEntityId: string | null;
  readonly predecessorLegalEntityId: string | null;
  readonly legalEntities: readonly LegalEntity[];
  readonly identifierAssignments: readonly IdentifierAssignment[];
  readonly corporateActions: readonly CorporateAction[];
  readonly relationships: readonly LegalEntityRelationship[];
};

export type SuccessionRecordingInput = {
  readonly declaration: DeclaredSuccession;
  readonly evidence: VerifiedSuccessionEvidence;
  /** Versiones abiertas del grafo. */
  readonly graph: IdentityGraph;
  readonly corporateActions: readonly CorporateAction[];
  readonly relationships: readonly LegalEntityRelationship[];
  /**
   * Desde cuándo el grafo conoce al antecesor: la descarga de su índice. Igual que
   * el universo, la identidad no se backdatea a la fecha de sus hechos; lo que
   * tiene fecha pública propia es el vínculo (ADR 0010).
   */
  readonly identityOpenedAt: string;
  /** Reloj inyectado: el dominio no lee `Date.now()`. */
  readonly recordedAt: string;
  readonly newId: () => string;
};

function isOpen(version: {
  readonly validTo: string | null;
  readonly supersededAt: string | null;
}): boolean {
  return version.validTo === null && version.supersededAt === null;
}

/** El hash cubre el contenido, nunca los IDs generados ni el instante local. */
function hashRelationshipContent(
  relationship: Omit<
    LegalEntityRelationship,
    "relationshipId" | "corporateActionId" | "contentHash" | "recordedAt"
  >,
): string {
  return computeContentHash({
    relationshipType: relationship.relationshipType,
    predecessorLegalEntityId: relationship.predecessorLegalEntityId,
    successorLegalEntityId: relationship.successorLegalEntityId,
    effectiveOn: relationship.effectiveOn,
    validFrom: relationship.validFrom,
    validTo: relationship.validTo,
    availableAt: relationship.availableAt,
    supersededAt: relationship.supersededAt,
    sourceId: relationship.sourceId,
    sourceDocumentId: relationship.sourceDocumentId,
    decidedBy: relationship.decidedBy,
    decisionRuleVersion: relationship.decisionRuleVersion,
  });
}

export function planSuccessionRecording(
  input: SuccessionRecordingInput,
): SuccessionRecordingPlan {
  const {
    declaration,
    evidence,
    graph,
    corporateActions,
    relationships,
    identityOpenedAt,
    recordedAt,
    newId,
  } = input;

  const base = {
    ruleVersion: SUCCESSION_RECORDING_RULE_VERSION,
    evidenceRuleVersion: evidence.ruleVersion,
  };

  const entityIdByCik = new Map(
    graph.identifierAssignments
      .filter(
        (assignment) =>
          isOpen(assignment) &&
          assignment.identifierType === "cik" &&
          assignment.subjectType === "legal_entity" &&
          assignment.confidence === "authoritative",
      )
      .map((assignment) => [assignment.normalizedValue, assignment.subjectId]),
  );

  const rejected = (
    code: SuccessionPlanRejectionCode,
    ids: { successor: string | null; predecessor: string | null },
  ): SuccessionRecordingPlan => ({
    ...base,
    status: "rejected",
    rejection: code,
    successorLegalEntityId: ids.successor,
    predecessorLegalEntityId: ids.predecessor,
    legalEntities: [],
    identifierAssignments: [],
    corporateActions: [],
    relationships: [],
  });

  const successorId = entityIdByCik.get(declaration.successorCik);

  if (successorId === undefined) {
    return rejected("successor_not_in_graph", {
      successor: null,
      predecessor: null,
    });
  }

  const knownPredecessorId = entityIdByCik.get(declaration.predecessorCik);

  if (knownPredecessorId === successorId) {
    return rejected("predecessor_is_successor", {
      successor: successorId,
      predecessor: knownPredecessorId,
    });
  }

  const openRelationships = relationships.filter(
    (relationship) =>
      relationship.relationshipType === "reporting_successor" &&
      isOpen(relationship),
  );
  const provenance = {
    sourceId: "sec-edgar",
    sourceDocumentId: evidence.successionFiling.accessionNumber,
  } as const;

  const legalEntities: LegalEntity[] = [];
  const identifierAssignments: IdentifierAssignment[] = [];
  let predecessorId = knownPredecessorId;

  if (predecessorId === undefined) {
    predecessorId = newId();
    const opening = {
      ...provenance,
      validFrom: identityOpenedAt,
      validTo: null,
      availableAt: identityOpenedAt,
      supersededAt: null,
    } as const;
    const entityContent = {
      ...opening,
      legalEntityId: predecessorId,
      legalName: evidence.predecessorName,
      // `submissions` no dice qué tipo de organización es: `other` es la
      // ausencia declarada, igual que en la constitución del universo.
      entityType: "other" as const,
      // El estado de incorporación que publica la SEC es un estado de EE. UU.,
      // no un código de país: guardarlo acá lo leería como jurisdicción ISO.
      jurisdiction: null,
      // Que siga existiendo como subsidiaria o se haya disuelto no lo prueba
      // ninguna de las dos presentaciones.
      status: "unknown" as const,
    };
    legalEntities.push(
      legalEntitySchema.parse({
        ...entityContent,
        contentHash: computeContentHash(entityContent),
        recordedAt,
      }),
    );
    const assignmentContent = {
      ...opening,
      identifierAssignmentId: newId(),
      subjectType: "legal_entity" as const,
      subjectId: predecessorId,
      identifierType: "cik",
      identifierValue: declaration.predecessorCik,
      normalizedValue: declaration.predecessorCik,
      scope: CIK_SCOPE,
      issuingAuthority: SEC_AUTHORITY,
      confidence: "authoritative" as const,
    };
    identifierAssignments.push(
      identifierAssignmentSchema.parse({
        ...assignmentContent,
        contentHash: computeContentHash(assignmentContent),
        recordedAt,
      }),
    );
  }

  const ids = { successor: successorId, predecessor: predecessorId };

  const relationshipBase = {
    relationshipType: "reporting_successor" as const,
    predecessorLegalEntityId: predecessorId,
    successorLegalEntityId: successorId,
    effectiveOn: evidence.effectiveOn,
    validFrom: startOfNewYorkDay(evidence.effectiveOn),
    validTo: null,
    availableAt: evidence.availableAt,
    supersededAt: null,
    ...provenance,
    decidedBy: declaration.decidedBy,
    decisionRuleVersion: evidence.ruleVersion,
  };
  const relationshipHash = hashRelationshipContent(relationshipBase);

  const samePair = openRelationships.find(
    (relationship) =>
      relationship.predecessorLegalEntityId === predecessorId &&
      relationship.successorLegalEntityId === successorId,
  );

  if (samePair !== undefined) {
    return samePair.contentHash === relationshipHash
      ? {
          ...base,
          status: "unchanged",
          rejection: null,
          successorLegalEntityId: successorId,
          predecessorLegalEntityId: predecessorId,
          legalEntities: [],
          identifierAssignments: [],
          corporateActions: [],
          relationships: [],
        }
      : rejected("conflicting_succession", ids);
  }

  if (
    openRelationships.some(
      (relationship) => relationship.successorLegalEntityId === successorId,
    )
  ) {
    return rejected("successor_has_other_predecessor", ids);
  }

  if (
    openRelationships.some(
      (relationship) => relationship.predecessorLegalEntityId === predecessorId,
    )
  ) {
    return rejected("predecessor_has_other_successor", ids);
  }

  // Agregar antecesor → sucesor cierra un ciclo si el sucesor ya es un ancestro
  // del antecesor.
  const predecessorOf = new Map(
    openRelationships.map((relationship) => [
      relationship.successorLegalEntityId,
      relationship.predecessorLegalEntityId,
    ]),
  );
  const visited = new Set<string>();
  let ancestor = predecessorOf.get(predecessorId);

  while (ancestor !== undefined && !visited.has(ancestor)) {
    if (ancestor === successorId) {
      return rejected("lineage_cycle", ids);
    }

    visited.add(ancestor);
    ancestor = predecessorOf.get(ancestor);
  }

  const actionBase = {
    actionType: "successor_issuer" as const,
    subjectType: "legal_entity" as const,
    subjectId: successorId,
    // La presentación de sucesión se publica el día del evento, no antes: no hay
    // un anuncio previo que esta fuente fije.
    announcedAt: null,
    effectiveOn: evidence.effectiveOn,
    availableAt: evidence.availableAt,
    ...provenance,
    terms: {
      form: evidence.successionFiling.form,
      predecessorCik: declaration.predecessorCik,
      successorCik: declaration.successorCik,
    },
  };
  const actionHash = computeCorporateActionContentHash(actionBase);
  const existingAction = corporateActions.find(
    (action) =>
      action.actionType === actionBase.actionType &&
      action.sourceId === actionBase.sourceId &&
      action.sourceDocumentId === actionBase.sourceDocumentId,
  );

  if (
    existingAction !== undefined &&
    existingAction.contentHash !== actionHash
  ) {
    return rejected("conflicting_succession", ids);
  }

  const actionsToOpen: CorporateAction[] = [];
  let corporateActionId = existingAction?.corporateActionId;

  if (corporateActionId === undefined) {
    corporateActionId = newId();
    actionsToOpen.push(
      corporateActionSchema.parse({
        ...actionBase,
        corporateActionId,
        contentHash: actionHash,
        recordedAt,
      }),
    );
  }

  return {
    ...base,
    status: "planned",
    rejection: null,
    successorLegalEntityId: successorId,
    predecessorLegalEntityId: predecessorId,
    legalEntities,
    identifierAssignments,
    corporateActions: actionsToOpen,
    relationships: [
      legalEntityRelationshipSchema.parse({
        ...relationshipBase,
        relationshipId: newId(),
        corporateActionId,
        contentHash: relationshipHash,
        recordedAt,
      }),
    ],
  };
}
