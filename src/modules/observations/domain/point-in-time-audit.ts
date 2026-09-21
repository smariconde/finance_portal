import { z } from "zod";

import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";

import type { Observation } from "./observation";
import { queryObservations } from "./select-observations";

/**
 * Auditoría del contrato point-in-time sobre lo que la base ya publicó.
 *
 * Es el gate de la Fase 2 vuelto comando: las afirmaciones que hasta ahora se
 * verificaron a mano sobre una empresa —Apple antes y después de su 10-K/A,
 * ExxonMobil antes y después del `8-K12B`— se evalúan acá sobre **todas** las
 * cadenas publicadas, y una que deje de valer se nombra (`TM-05`, `TM-06`).
 *
 * La afirmación central se evalúa a través de `queryObservations`, el mismo
 * dominio que lee la aplicación. Un verificador que reimplementara la selección
 * probaría su propia copia y no el contrato.
 */
export const pointInTimeClaimSchema = z.enum([
  /** Cuando una fila cita un documento, el documento existe y la fecha coincide. */
  "provenance_resolves",
  /** La disponibilidad es la aceptación del filing, nunca el instante de descarga. */
  "availability_precedes_fetch",
  /** La cadena de revisiones está ordenada, encadenada y con una sola vigente. */
  "revision_chain_ordered",
  /** Un restatement posterior no se filtra en una consulta anterior. */
  "as_known_excludes_later_revision",
  /** Una revisión nueva cambia algo; si no, es un duplicado. */
  "restatement_changes_content",
]);

export type PointInTimeClaim = z.infer<typeof pointInTimeClaimSchema>;

/** Orden de presentación: de la procedencia al contrato temporal. */
export const POINT_IN_TIME_CLAIMS: readonly PointInTimeClaim[] =
  pointInTimeClaimSchema.options;

export const AUDIT_RULE_VERSION = "point-in-time-audit-1.0.0";

/**
 * Techo de fallas conservadas. Los conteos no tienen techo: una base rota debe
 * poder decir cuántas filas rompió sin construir un arreglo del tamaño de la
 * tabla.
 */
export const MAX_RETAINED_FINDINGS = 50;

export type AuditFinding = {
  readonly claim: PointInTimeClaim;
  readonly detail: string;
  readonly revisionGroupId: string;
  readonly observationId: string;
  /** Sujeto y hecho, para poder ir a buscarlo sin volver a correr la consulta. */
  readonly subjectId: string;
  readonly metricId: string;
  readonly asOf: string;
};

/**
 * Cuántas veces se evaluó cada afirmación y cuántas falló. Una afirmación con
 * cero evaluaciones **no pasa**: queda `not_exercised`, porque una base sin
 * ninguna cadena restateada no prueba nada sobre el no-look-ahead.
 */
export type ClaimTally = {
  readonly checked: number;
  readonly failed: number;
};

export type PointInTimeAudit = {
  readonly ruleVersion: string;
  readonly chains: number;
  readonly revisions: number;
  readonly restatedChains: number;
  /**
   * Filas que no citan ningún documento. No es una falla: una fuente de fixture
   * no publica documentos. Es un conteo que el informe muestra porque para la
   * SEC vale cero, y pasar de cero a N es la regresión que hay que ver.
   */
  readonly rowsWithoutSourceDocument: number;
  readonly tallies: Readonly<Record<PointInTimeClaim, ClaimTally>>;
  readonly findings: readonly AuditFinding[];
  /** Fallas que ocurrieron y no se conservaron por el techo. */
  readonly droppedFindings: number;
};

function emptyTallies(): Record<PointInTimeClaim, ClaimTally> {
  return Object.fromEntries(
    POINT_IN_TIME_CLAIMS.map((claim) => [claim, { checked: 0, failed: 0 }]),
  ) as Record<PointInTimeClaim, ClaimTally>;
}

export function createAudit(): PointInTimeAudit {
  return {
    ruleVersion: AUDIT_RULE_VERSION,
    chains: 0,
    revisions: 0,
    restatedChains: 0,
    rowsWithoutSourceDocument: 0,
    tallies: emptyTallies(),
    findings: [],
    droppedFindings: 0,
  };
}

/**
 * Disponibilidad del documento que trajo cada fila. La fila guarda el id y no la
 * fecha (ADR 0018): que las dos coincidan es justamente lo que la afirmación de
 * procedencia comprueba.
 *
 * La clave lleva la fuente porque el documento se identifica por el par, no por
 * el id: dos fuentes pueden numerar distinto y coincidir.
 */
export type SourceDocumentIndex = ReadonlyMap<string, string>;

export function sourceDocumentKey(
  sourceId: string,
  sourceDocumentId: string,
): string {
  return `${sourceId}|${sourceDocumentId}`;
}

type MutableTallies = Record<
  PointInTimeClaim,
  { checked: number; failed: number }
>;

type ChainAudit = {
  readonly findings: readonly AuditFinding[];
  readonly tallies: Readonly<Record<PointInTimeClaim, ClaimTally>>;
  readonly rowsWithoutSourceDocument: number;
};

function findingOf(
  claim: PointInTimeClaim,
  detail: string,
  observation: Observation,
): AuditFinding {
  return {
    claim,
    detail,
    revisionGroupId: observation.revisionGroupId,
    observationId: observation.observationId,
    subjectId: observation.subjectId,
    metricId: observation.metricId,
    asOf: observation.asOf,
  };
}

/** Un instante antes de `at`. El corte del contrato es semiabierto. */
function oneInstantBefore(at: string): string {
  return new Date(Date.parse(at) - 1).toISOString();
}

/**
 * Qué devuelve el dominio para esta cadena en ese corte de conocimiento. La
 * consulta va contra las revisiones de la cadena y nada más, así que devuelve a
 * lo sumo una observación.
 */
function revisionKnownAt(
  revisions: readonly Observation[],
  knownAt: string,
): Observation | null {
  const [head] = revisions;

  if (head === undefined) {
    return null;
  }

  const selected = queryObservations(
    revisions,
    {
      subjectType: head.subjectType,
      subjectId: head.subjectId,
      metricIds: [head.metricId],
    },
    pointInTimeQuerySchema.parse({
      effectiveAt: knownAt,
      knownAt,
      revisionPolicy: "as_known",
      knowledgeBasis: "public_availability",
      adjustmentPolicy: "as_known",
      sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
    }),
  );

  return selected[0] ?? null;
}

/**
 * Audita una cadena completa. Recibe todas las revisiones de un mismo
 * `revision_group_id`; el llamador garantiza que no mezcla cadenas.
 */
export function auditRevisionChain(
  chain: readonly Observation[],
  documents: SourceDocumentIndex,
): ChainAudit {
  const findings: AuditFinding[] = [];
  const tallies = emptyTallies() as MutableTallies;
  let rowsWithoutSourceDocument = 0;

  const revisions = [...chain].sort(
    (left, right) => left.revisionNumber - right.revisionNumber,
  );

  for (const [index, revision] of revisions.entries()) {
    const documentId = revision.sourceDocumentId;

    if (documentId === null) {
      rowsWithoutSourceDocument += 1;
    } else {
      tallies.provenance_resolves.checked += 1;
      const documentAvailableAt = documents.get(
        sourceDocumentKey(revision.sourceId, documentId),
      );

      if (documentAvailableAt === undefined) {
        tallies.provenance_resolves.failed += 1;
        findings.push(
          findingOf("provenance_resolves", "unknown_source_document", revision),
        );
      } else if (
        Date.parse(documentAvailableAt) !== Date.parse(revision.availableAt)
      ) {
        tallies.provenance_resolves.failed += 1;
        findings.push(
          findingOf(
            "provenance_resolves",
            "document_availability_mismatch",
            revision,
          ),
        );
      }
    }

    tallies.availability_precedes_fetch.checked += 1;
    if (Date.parse(revision.availableAt) >= Date.parse(revision.fetchedAt)) {
      tallies.availability_precedes_fetch.failed += 1;
      findings.push(
        findingOf(
          "availability_precedes_fetch",
          "availability_dated_with_the_clock",
          revision,
        ),
      );
    }

    tallies.revision_chain_ordered.checked += 1;
    const expectedNumber = index + 1;
    const previous = index === 0 ? null : revisions[index - 1]!;

    if (revision.revisionNumber !== expectedNumber) {
      tallies.revision_chain_ordered.failed += 1;
      findings.push(
        findingOf("revision_chain_ordered", "revision_number_gap", revision),
      );
    } else if (revision.revisionGroupId !== revisions[0]!.revisionGroupId) {
      tallies.revision_chain_ordered.failed += 1;
      findings.push(
        findingOf("revision_chain_ordered", "ambiguous_revision", revision),
      );
    } else if (previous === null) {
      if (revision.restatementOfId !== null) {
        tallies.revision_chain_ordered.failed += 1;
        findings.push(
          findingOf(
            "revision_chain_ordered",
            "first_revision_restates_something",
            revision,
          ),
        );
      }
    } else if (
      Date.parse(revision.availableAt) <= Date.parse(previous.availableAt)
    ) {
      tallies.revision_chain_ordered.failed += 1;
      findings.push(
        findingOf("revision_chain_ordered", "revision_not_newer", revision),
      );
    } else if (revision.restatementOfId !== previous.observationId) {
      tallies.revision_chain_ordered.failed += 1;
      findings.push(
        findingOf(
          "revision_chain_ordered",
          "broken_restatement_link",
          revision,
        ),
      );
    } else if (
      previous.supersededAt === null ||
      Date.parse(previous.supersededAt) !== Date.parse(revision.availableAt)
    ) {
      tallies.revision_chain_ordered.failed += 1;
      findings.push(
        findingOf(
          "revision_chain_ordered",
          "supersession_does_not_match_successor",
          revision,
        ),
      );
    }

    if (previous === null) {
      continue;
    }

    // Una revisión nueva que no cambia nada es un duplicado que el dedupe
    // debería haber reconocido contra la cadena entera.
    tallies.restatement_changes_content.checked += 1;
    if (previous.contentHash === revision.contentHash) {
      tallies.restatement_changes_content.failed += 1;
      findings.push(
        findingOf(
          "restatement_changes_content",
          "duplicate_content_hash",
          revision,
        ),
      );
    } else if (
      previous.rawValue === revision.rawValue &&
      previous.rawValueStatus === revision.rawValueStatus &&
      previous.normalizedValue === revision.normalizedValue &&
      previous.parserVersion === revision.parserVersion &&
      [...previous.qualityFlags].sort().join("|") ===
        [...revision.qualityFlags].sort().join("|")
    ) {
      tallies.restatement_changes_content.failed += 1;
      findings.push(
        findingOf(
          "restatement_changes_content",
          "identical_value_without_reason",
          revision,
        ),
      );
    }

    // El corazón del gate: un instante antes de la aceptación de esta revisión
    // el contrato devuelve la anterior, y en la aceptación devuelve esta.
    tallies.as_known_excludes_later_revision.checked += 1;
    const before = revisionKnownAt(
      revisions,
      oneInstantBefore(revision.availableAt),
    );
    const at = revisionKnownAt(revisions, revision.availableAt);

    if (before?.observationId !== previous.observationId) {
      tallies.as_known_excludes_later_revision.failed += 1;
      findings.push(
        findingOf(
          "as_known_excludes_later_revision",
          before === null
            ? "earlier_knowledge_returned_nothing"
            : "later_revision_leaked_into_earlier_query",
          revision,
        ),
      );
    } else if (at?.observationId !== revision.observationId) {
      tallies.as_known_excludes_later_revision.failed += 1;
      findings.push(
        findingOf(
          "as_known_excludes_later_revision",
          "revision_not_visible_at_its_own_availability",
          revision,
        ),
      );
    }
  }

  // Una sola revisión vigente por cadena, y es la última. Es una afirmación de
  // la cadena entera y no de una fila: una cadena de una sola revisión sin
  // vigente también la rompe.
  const last = revisions[revisions.length - 1];

  if (last !== undefined) {
    const current = revisions.filter(
      (revision) => revision.supersededAt === null,
    );

    tallies.revision_chain_ordered.checked += 1;

    if (current.length !== 1) {
      tallies.revision_chain_ordered.failed += 1;
      findings.push(
        findingOf(
          "revision_chain_ordered",
          current.length === 0
            ? "no_current_revision"
            : "more_than_one_current_revision",
          last,
        ),
      );
    } else if (current[0]!.observationId !== last.observationId) {
      tallies.revision_chain_ordered.failed += 1;
      findings.push(
        findingOf(
          "revision_chain_ordered",
          "current_revision_is_not_the_last",
          last,
        ),
      );
    }
  }

  return { findings, tallies, rowsWithoutSourceDocument };
}

/**
 * Suma una página de cadenas a la auditoría. La auditoría se construye de a
 * páginas porque la tabla no se lee entera de una sola consulta (`TM-07`).
 */
export function addChainsToAudit(
  audit: PointInTimeAudit,
  chains: readonly (readonly Observation[])[],
  documents: SourceDocumentIndex,
): PointInTimeAudit {
  const tallies = { ...audit.tallies } as MutableTallies;
  const findings = [...audit.findings];
  let droppedFindings = audit.droppedFindings;
  let chainCount = audit.chains;
  let revisionCount = audit.revisions;
  let restatedChains = audit.restatedChains;
  let rowsWithoutSourceDocument = audit.rowsWithoutSourceDocument;

  for (const chain of chains) {
    if (chain.length === 0) {
      continue;
    }

    chainCount += 1;
    revisionCount += chain.length;

    if (chain.length > 1) {
      restatedChains += 1;
    }

    const result = auditRevisionChain(chain, documents);
    rowsWithoutSourceDocument += result.rowsWithoutSourceDocument;

    for (const claim of POINT_IN_TIME_CLAIMS) {
      tallies[claim] = {
        checked: tallies[claim].checked + result.tallies[claim].checked,
        failed: tallies[claim].failed + result.tallies[claim].failed,
      };
    }

    for (const finding of result.findings) {
      if (findings.length < MAX_RETAINED_FINDINGS) {
        findings.push(finding);
      } else {
        droppedFindings += 1;
      }
    }
  }

  return {
    ruleVersion: audit.ruleVersion,
    chains: chainCount,
    revisions: revisionCount,
    restatedChains,
    rowsWithoutSourceDocument,
    tallies,
    findings,
    droppedFindings,
  };
}

export type ClaimStatus = "pass" | "fail" | "not_exercised";

export type ClaimVerdict = {
  readonly claim: PointInTimeClaim;
  readonly status: ClaimStatus;
  readonly checked: number;
  readonly failed: number;
};

export type PointInTimeAuditReport = {
  readonly ruleVersion: string;
  readonly chains: number;
  readonly revisions: number;
  readonly restatedChains: number;
  readonly rowsWithoutSourceDocument: number;
  readonly verdicts: readonly ClaimVerdict[];
  readonly findings: readonly AuditFinding[];
  readonly droppedFindings: number;
  /** El gate pasa sólo si toda afirmación se ejercitó y ninguna falló. */
  readonly passed: boolean;
};

export function summarizeAudit(
  audit: PointInTimeAudit,
): PointInTimeAuditReport {
  const verdicts = POINT_IN_TIME_CLAIMS.map((claim): ClaimVerdict => {
    const tally = audit.tallies[claim];

    return {
      claim,
      checked: tally.checked,
      failed: tally.failed,
      status:
        tally.failed > 0
          ? "fail"
          : tally.checked === 0
            ? "not_exercised"
            : "pass",
    };
  });

  return {
    ruleVersion: audit.ruleVersion,
    chains: audit.chains,
    revisions: audit.revisions,
    restatedChains: audit.restatedChains,
    rowsWithoutSourceDocument: audit.rowsWithoutSourceDocument,
    verdicts,
    findings: audit.findings,
    droppedFindings: audit.droppedFindings,
    passed: verdicts.every((verdict) => verdict.status === "pass"),
  };
}
