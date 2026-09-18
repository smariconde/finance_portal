import {
  observationPrunePlanSchema,
  type ObservationPrunePlan,
} from "@/modules/observations/domain/observation-prune";

import {
  listSplitEvidenceConcepts,
  SEC_CONCEPT_SELECTION_VERSION,
} from "./sec-concept-selection";
import { secHistoryCutsFrom } from "./sec-history-window";

/**
 * Plan de poda de la historia de un filer (ADR 0019).
 *
 * La poda no vuelve a la red y no recalcula el ancla: la toma de la corrida que
 * la registró (`ingestion_runs.selection_anchor_on`, ADR 0017 §5). Así el corte
 * que borra es, byte a byte, el corte que esa misma corrida aplicó al descargar,
 * y la base queda con exactamente las filas que una ingesta nueva produciría.
 *
 * De ahí las dos negativas. Sin ancla registrada no hay corte que reproducir:
 * calcularlo de las filas guardadas sería adivinar, porque el foco `FY` que el
 * ancla necesita no está en la observación. Y un ancla de otra selección
 * describe otra ventana —la versión declara sus componentes—, así que tampoco
 * sirve. En los dos casos la salida es la misma: ingerir el filer otra vez, que
 * cuesta dos o tres requests y deja el ancla vigente.
 */
export const SEC_HISTORY_PRUNE_RULE_VERSION = "sec-history-prune-1.0.0";

export type SecHistoryPruneRejectionCode =
  /** El sujeto no tiene ninguna corrida con ancla registrada. */
  | "anchor_unknown"
  /** El ancla es de otra selección, que describe otra ventana. */
  | "selection_superseded";

/** Ancla vigente de un sujeto, tal como la registró su corrida. */
export type SecHistoryPruneAnchor = {
  readonly runId: string;
  readonly selectionVersion: string;
  readonly selectionAnchorOn: string;
};

export type SecHistoryPruneSubject = {
  readonly sourceId: string;
  readonly datasetId: string;
  readonly subjectType: ObservationPrunePlan["subjectType"];
  readonly subjectId: string;
};

export type SecHistoryPruneDecision =
  | {
      readonly status: "planned";
      readonly ruleVersion: string;
      readonly anchor: SecHistoryPruneAnchor;
      readonly plan: ObservationPrunePlan;
    }
  | {
      readonly status: "rejected";
      readonly ruleVersion: string;
      readonly code: SecHistoryPruneRejectionCode;
      readonly detail: string;
    };

export function planSecHistoryPrune(
  subject: SecHistoryPruneSubject,
  anchor: SecHistoryPruneAnchor | null,
  selectionVersion: string = SEC_CONCEPT_SELECTION_VERSION,
): SecHistoryPruneDecision {
  if (anchor === null) {
    return {
      status: "rejected",
      ruleVersion: SEC_HISTORY_PRUNE_RULE_VERSION,
      code: "anchor_unknown",
      detail: `No run of ${subject.datasetId} recorded an anchor for this subject.`,
    };
  }

  if (anchor.selectionVersion !== selectionVersion) {
    return {
      status: "rejected",
      ruleVersion: SEC_HISTORY_PRUNE_RULE_VERSION,
      code: "selection_superseded",
      detail: `The anchor was recorded under ${anchor.selectionVersion}; this code runs ${selectionVersion}.`,
    };
  }

  const cuts = secHistoryCutsFrom(anchor.selectionAnchorOn);

  return {
    status: "planned",
    ruleVersion: SEC_HISTORY_PRUNE_RULE_VERSION,
    anchor,
    plan: observationPrunePlanSchema.parse({
      sourceId: subject.sourceId,
      datasetId: subject.datasetId,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      periodsEndingBefore: cuts.periodsEndingFrom,
      evidencePeriodsEndingBefore: cuts.evidencePeriodsEndingFrom,
      evidenceConcepts: listSplitEvidenceConcepts(),
    }),
  };
}
