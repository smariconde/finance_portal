import {
  computeCorporateActionContentHash,
  corporateActionSchema,
  type CorporateAction,
} from "./reporting-succession";
import { isSplitAction, SPLIT_RATIO_QUALIFIED_CONCEPT } from "./share-basis";
import type { ConfirmedSplit, SplitEvidence } from "./verify-split-evidence";

/**
 * Planificación pura del registro de los splits confirmados de un filer.
 *
 * Igual que la sucesión, el planner no escribe: devuelve qué eventos abre. Lo que
 * decide:
 *
 * 1. un split confirmado se registra una vez por presentación. Volver a
 *    confirmarlo con el mismo contenido no abre nada;
 * 2. la misma presentación descripta de otra forma —otro ratio, otra dirección,
 *    otra versión de la regla— es un conflicto nombrado, no una corrección: un
 *    split registrado ya ajustó lecturas;
 * 3. un split registrado que la evidencia de hoy no vuelve a confirmar **no se
 *    borra**. Queda nombrado para revisión, porque la evidencia pudo cambiar por
 *    una ingesta parcial y borrar un evento reescribiría lecturas pasadas.
 */
export const SPLIT_RECORDING_RULE_VERSION = "split-recording-1.0.0";

/**
 * Alcance del split registrado: los hechos sin dimensiones del filer. Qué clases
 * de acciones se dividieron no lo dice este cable, y no se registra por
 * security hasta que otra fuente lo pruebe.
 */
export const SPLIT_SCOPE = "filer_reported_shares";

export type SplitPlanRejectionCode = "conflicting_split";

export type SplitRecordingPlan = {
  readonly ruleVersion: string;
  readonly evidenceRuleVersion: string;
  readonly status: "planned" | "unchanged" | "rejected";
  readonly rejection: SplitPlanRejectionCode | null;
  readonly legalEntityId: string;
  readonly corporateActions: readonly CorporateAction[];
  /** Presentaciones cuyo split ya estaba registrado con este contenido. */
  readonly unchanged: readonly string[];
  /** Presentaciones en conflicto con un evento registrado. */
  readonly conflicts: readonly string[];
  /** Splits registrados de este filer que la evidencia no volvió a confirmar. */
  readonly notReconfirmed: readonly string[];
};

export type SplitRecordingInput = {
  readonly legalEntityId: string;
  readonly evidence: SplitEvidence;
  /** Eventos registrados que comparten presentación o sujeto con la evidencia. */
  readonly corporateActions: readonly CorporateAction[];
  /** Reloj inyectado: el dominio no lee `Date.now()`. */
  readonly recordedAt: string;
  readonly newId: () => string;
};

export function buildSplitActionContent(
  legalEntityId: string,
  split: ConfirmedSplit,
  evidenceRuleVersion: string,
): Omit<CorporateAction, "corporateActionId" | "contentHash" | "recordedAt"> {
  return {
    actionType: split.actionType,
    subjectType: "legal_entity",
    subjectId: legalEntityId,
    // La SEC publica la aprobación en texto libre y con fechas que no coinciden
    // entre presentaciones: no hay un anuncio fechable por regla.
    announcedAt: null,
    effectiveOn: split.effectiveOn,
    availableAt: split.availableAt,
    sourceId: "sec-edgar",
    sourceDocumentId: split.accessionNumber,
    terms: {
      ratio: split.ratio,
      ratioConcept: SPLIT_RATIO_QUALIFIED_CONCEPT,
      form: split.form,
      claimedPeriods: split.claimedPeriods.join(","),
      scope: SPLIT_SCOPE,
      decisionRuleVersion: evidenceRuleVersion,
    },
  };
}

export function planSplitRecording(
  input: SplitRecordingInput,
): SplitRecordingPlan {
  const { legalEntityId, evidence, corporateActions, recordedAt, newId } =
    input;
  const splitActions = corporateActions.filter(isSplitAction);
  const toOpen: CorporateAction[] = [];
  const unchanged: string[] = [];
  const conflicts: string[] = [];

  for (const split of evidence.splits) {
    const content = buildSplitActionContent(
      legalEntityId,
      split,
      evidence.ruleVersion,
    );
    const contentHash = computeCorporateActionContentHash(content);
    // Una accession describe a lo sumo un split, sea del tipo que sea: un split
    // registrado como `split` que hoy sale `reverse_split` es el mismo evento
    // descripto de otra forma.
    const recorded = splitActions.filter(
      (action) =>
        action.sourceId === content.sourceId &&
        action.sourceDocumentId === content.sourceDocumentId,
    );

    if (recorded.length === 0) {
      toOpen.push(
        corporateActionSchema.parse({
          ...content,
          corporateActionId: newId(),
          contentHash,
          recordedAt,
        }),
      );
    } else if (
      recorded.length === 1 &&
      recorded[0]!.contentHash === contentHash
    ) {
      unchanged.push(split.accessionNumber);
    } else {
      conflicts.push(split.accessionNumber);
    }
  }

  const confirmed = new Set(
    evidence.splits.map((split) => split.accessionNumber),
  );
  const notReconfirmed = splitActions
    .filter(
      (action) =>
        action.subjectType === "legal_entity" &&
        action.subjectId === legalEntityId &&
        !confirmed.has(action.sourceDocumentId),
    )
    .map((action) => action.sourceDocumentId)
    .sort();

  const base = {
    ruleVersion: SPLIT_RECORDING_RULE_VERSION,
    evidenceRuleVersion: evidence.ruleVersion,
    legalEntityId,
    unchanged,
    conflicts,
    notReconfirmed,
  };

  if (conflicts.length > 0) {
    return {
      ...base,
      status: "rejected",
      rejection: "conflicting_split",
      corporateActions: [],
    };
  }

  return {
    ...base,
    status: toOpen.length > 0 ? "planned" : "unchanged",
    rejection: null,
    corporateActions: toOpen,
  };
}
