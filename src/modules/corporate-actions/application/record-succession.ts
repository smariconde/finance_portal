import { z } from "zod";

import { SEC_SOURCE_ID } from "@/modules/fundamentals/application/live-company-facts-source";
import { SEC_SUBMISSIONS_PARSER_VERSION } from "@/modules/fundamentals/domain/parse-sec-submissions";
import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  ingestionFailureSchema,
  toSafeIngestionFailure,
  type IngestionFailure,
  type IngestionFailureCode,
} from "@/modules/ingestion/domain/ingestion-failure";
import {
  computeIdempotencyKey,
  EMPTY_COUNTS,
  ingestionRunSchema,
  isPublishableStatus,
  type IngestionRun,
  type IngestionRunCounts,
  type IngestionRunStatus,
} from "@/modules/ingestion/domain/ingestion-run";
import {
  evaluateIngestionRights,
  type IngestionRightsRequest,
} from "@/modules/ingestion/domain/source-registry-entry";
import { computeStagedBatchHash } from "@/modules/ingestion/domain/staged-record";
import type {
  SourceDocumentRecording,
  SourceDocumentRepository,
} from "@/modules/observations/application/source-document-repository";
import {
  computeSourceDocumentContentHash,
  sourceDocumentSchema,
} from "@/modules/observations/domain/source-document";

import {
  planSuccessionRecording,
  SUCCESSION_RECORDING_RULE_VERSION,
  type SuccessionRecordingPlan,
} from "../domain/plan-succession-recording";
import {
  declaredSuccessionSchema,
  SUCCESSION_EVIDENCE_RULE_VERSION,
  type DeclaredSuccession,
  type DeclaredSuccessionInput,
} from "../domain/reporting-succession";
import {
  verifySuccessionEvidence,
  type VerifiedSuccessionEvidence,
} from "../domain/verify-succession-evidence";
import type {
  CorporateActionRepository,
  SuccessionRecordingSummary,
} from "./corporate-action-repository";
import {
  SuccessionEvidenceSourceError,
  type SuccessionEvidenceDocument,
  type SuccessionEvidenceSource,
} from "./succession-evidence-source";

/**
 * Registro de una sucesión de emisor declarada.
 *
 * El orden es el mismo de toda ingesta y no se negocia:
 *
 * 1. **registro y derechos**, sin red (`TM-15`);
 * 2. **sucesor en el grafo**, sin red: una sucesión no trae empresas al universo,
 *    y un sucesor desconocido no justifica una descarga;
 * 3. **evidencia**: los índices de los dos filers. Un documento que no se entiende
 *    se cuarentena (`TM-05`);
 * 4. **verificación y plan**, en dominio. Lo que no cierra queda en una corrida
 *    `quarantined` con el motivo en el flag y no toca el grafo;
 * 5. **corrida**, **documento** y **grafo**, en ese orden, porque cada uno
 *    referencia al anterior (`TM-16`).
 */
export const SUCCESSION_DATASET_ID = "sec.submissions";

/**
 * Versión del pipeline registrada como `parser_version` de la corrida. Cubre el
 * parser del índice, la regla de evidencia y la de registro, porque las tres
 * deciden qué se escribe.
 */
export const SUCCESSION_PIPELINE = Object.freeze({
  parserVersion: "sec-succession-1.0.0",
  components: Object.freeze({
    submissions: SEC_SUBMISSIONS_PARSER_VERSION,
    evidence: SUCCESSION_EVIDENCE_RULE_VERSION,
    recording: SUCCESSION_RECORDING_RULE_VERSION,
  }),
});

/** Se guarda lo derivado —identidad y vínculo—, nunca el índice descargado. */
const RIGHTS_REQUEST: IngestionRightsRequest = {
  storesRawPayload: false,
  storesNormalizedValues: true,
  publicDisplay: false,
};

export const recordSuccessionCommandSchema = z.object({
  declaration: declaredSuccessionSchema,
  mode: z.literal("personal"),
  /** Descarga, verifica y planifica, pero no registra corrida, documento ni grafo. */
  dryRun: z.boolean().default(false),
});

export type RecordSuccessionCommand = {
  readonly declaration: DeclaredSuccessionInput;
  readonly mode: "personal";
  readonly dryRun?: boolean;
};

export type RecordSuccessionDependencies = {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly ingestionRuns: IngestionRunRepository;
  readonly sourceDocuments: SourceDocumentRepository;
  readonly corporateActions: CorporateActionRepository;
  /** Versiones abiertas del grafo de identidad. */
  readonly loadIdentityGraph: () => Promise<IdentityGraph>;
  readonly source: SuccessionEvidenceSource;
  readonly now: () => string;
  readonly newId: () => string;
};

export type RecordSuccessionOutcome = {
  /** `false` en un dry run o cuando se cortó antes de registrar una corrida. */
  readonly persisted: boolean;
  readonly declaration: DeclaredSuccession;
  /** `null` cuando la solicitud se rechazó antes de salir a la red. */
  readonly run: IngestionRun | null;
  readonly rejection: string | null;
  readonly documents: readonly SuccessionEvidenceDocument[];
  readonly evidence: VerifiedSuccessionEvidence | null;
  readonly plan: SuccessionRecordingPlan | null;
  readonly sourceDocuments: SourceDocumentRecording | null;
  readonly applied: SuccessionRecordingSummary | null;
};

export async function recordSuccession(
  command: RecordSuccessionCommand,
  dependencies: RecordSuccessionDependencies,
): Promise<RecordSuccessionOutcome> {
  const { declaration, dryRun } = recordSuccessionCommandSchema.parse(command);
  const {
    sourceRegistry,
    ingestionRuns,
    sourceDocuments,
    corporateActions,
    loadIdentityGraph,
    source,
    now,
    newId,
  } = dependencies;

  const batchIdentity = {
    sourceId: SEC_SOURCE_ID,
    datasetId: SUCCESSION_DATASET_ID,
    parserVersion: SUCCESSION_PIPELINE.parserVersion,
  };
  const requestKey = {
    ...batchIdentity,
    requestedAsOf: null,
    requestedVintage: null,
    cursor: null,
    subjectKey: declaration.successorCik,
    selectionVersion: null,
  };
  const startedAt = now();
  const runId = newId();

  type RunFields = {
    status: IngestionRunStatus;
    counts: IngestionRunCounts;
    contentHash: string | null;
    failure: IngestionFailure | null;
    qualityFlags: string[];
    replayOfRunId?: string | null;
    idempotencyKey?: string;
  };

  const record = async (fields: RunFields): Promise<IngestionRun> => {
    const finishedAt = now();
    const run = ingestionRunSchema.parse({
      runId,
      ...batchIdentity,
      idempotencyKey:
        fields.idempotencyKey ?? computeIdempotencyKey(requestKey),
      requestedAsOf: null,
      requestedVintage: null,
      cursor: null,
      nextCursor: null,
      subjectKey: declaration.successorCik,
      selectionVersion: null,
      status: fields.status,
      startedAt,
      finishedAt,
      counts: fields.counts,
      contentHash: fields.contentHash,
      failure: fields.failure,
      qualityFlags: fields.qualityFlags,
      replayOfRunId: fields.replayOfRunId ?? null,
      recordedAt: finishedAt,
    });

    return dryRun ? run : ingestionRuns.append(run);
  };

  const blank = {
    declaration,
    rejection: null,
    documents: [],
    evidence: null,
    plan: null,
    sourceDocuments: null,
    applied: null,
  } as const;

  const failed = async (
    code: IngestionFailureCode,
    cause: unknown,
    options: { retryable?: boolean; qualityFlags?: string[] } = {},
  ): Promise<IngestionRun> => {
    const failure = toSafeIngestionFailure(code, cause);

    return record({
      status: "failed",
      counts: EMPTY_COUNTS,
      contentHash: null,
      failure: ingestionFailureSchema.parse({
        ...failure,
        retryable: options.retryable ?? failure.retryable,
      }),
      qualityFlags: options.qualityFlags ?? [],
    });
  };

  // 1. Registro y derechos, antes de cualquier egress.
  const entry = await sourceRegistry.findBySourceId(SEC_SOURCE_ID);

  if (!entry) {
    return {
      ...blank,
      persisted: !dryRun,
      run: await failed(
        "source_not_registered",
        "La fuente solicitada no existe en el registro.",
      ),
    };
  }

  if (!entry.datasets.includes(SUCCESSION_DATASET_ID)) {
    return {
      ...blank,
      persisted: !dryRun,
      run: await failed(
        "dataset_not_registered",
        "El dataset solicitado no está declarado por la fuente.",
      ),
    };
  }

  const rights = evaluateIngestionRights(entry, RIGHTS_REQUEST);

  if (!rights.allowed) {
    return {
      ...blank,
      persisted: !dryRun,
      run: await failed(
        "rights_not_approved",
        `Derechos sin aprobar: ${rights.blockedBy.join(", ")}`,
        { qualityFlags: ["rights_blocked"] },
      ),
    };
  }

  // 2. Sucesor en el grafo, todavía sin red.
  const graph = await loadIdentityGraph();
  const successorKnown = graph.identifierAssignments.some(
    (assignment) =>
      assignment.identifierType === "cik" &&
      assignment.subjectType === "legal_entity" &&
      assignment.confidence === "authoritative" &&
      assignment.validTo === null &&
      assignment.supersededAt === null &&
      assignment.normalizedValue === declaration.successorCik,
  );

  if (!successorKnown) {
    return {
      ...blank,
      persisted: false,
      run: null,
      rejection: "successor_not_in_graph",
    };
  }

  const emptyHash = computeStagedBatchHash(batchIdentity, []);

  // 3. Evidencia.
  let download;

  try {
    download = await source.load({
      predecessorCik: declaration.predecessorCik,
      successorCik: declaration.successorCik,
      successionAccession: declaration.successionAccession,
    });
  } catch (cause) {
    if (
      cause instanceof SuccessionEvidenceSourceError &&
      (cause.code === "payload_schema_invalid" ||
        cause.code === "subject_mismatch")
    ) {
      return {
        ...blank,
        persisted: !dryRun,
        run: await record({
          status: "quarantined",
          counts: EMPTY_COUNTS,
          contentHash: emptyHash,
          failure: null,
          qualityFlags: [`${cause.document}_${cause.code}`],
        }),
      };
    }

    return {
      ...blank,
      persisted: !dryRun,
      run: await failed("provider_error", cause, {
        retryable:
          cause instanceof SuccessionEvidenceSourceError
            ? cause.retryable
            : false,
      }),
    };
  }

  const quarantine = async (code: string, contentHash: string) =>
    record({
      status: "quarantined",
      counts: { fetched: 1, accepted: 0, rejected: 1, duplicate: 0 },
      contentHash,
      failure: null,
      qualityFlags: [`succession_${code}`],
      idempotencyKey: computeIdempotencyKey({
        ...requestKey,
        documentVersion: contentHash,
      }),
    });

  // 4. Verificación y plan.
  const verification = verifySuccessionEvidence({
    declaration,
    successor: download.successor,
    predecessor: download.predecessor,
  });

  if (!verification.ok) {
    return {
      ...blank,
      documents: download.documents,
      rejection: verification.code,
      persisted: !dryRun,
      run: await quarantine(
        verification.code,
        computeContentHash({ declaration, rejection: verification.code }),
      ),
    };
  }

  const { evidence } = verification;
  const [relationships, actions] = await Promise.all([
    corporateActions.listRelationships(),
    corporateActions.listCorporateActions(),
  ]);
  const recordedAt = now();
  const plan = planSuccessionRecording({
    declaration,
    evidence,
    graph,
    corporateActions: actions,
    relationships,
    identityOpenedAt: download.predecessor.fetchedAt,
    recordedAt,
    newId,
  });
  const contentHash = computeContentHash({ declaration, evidence });
  const partial = {
    ...blank,
    documents: download.documents,
    evidence,
    plan,
  };

  if (plan.status === "rejected") {
    return {
      ...partial,
      rejection: plan.rejection,
      persisted: !dryRun,
      run: await quarantine(plan.rejection!, contentHash),
    };
  }

  const idempotencyKey = computeIdempotencyKey({
    ...requestKey,
    documentVersion: contentHash,
  });
  const previous = await ingestionRuns.findByIdempotencyKey(idempotencyKey);
  const replayOf =
    previous !== null && isPublishableStatus(previous.status) ? previous : null;

  const run = await record(
    replayOf === null && plan.status === "planned"
      ? {
          status: "succeeded",
          counts: { fetched: 1, accepted: 1, rejected: 0, duplicate: 0 },
          contentHash,
          failure: null,
          qualityFlags: [...evidence.qualityFlags],
          idempotencyKey,
        }
      : {
          // La misma evidencia ya se registró, o el grafo ya dice exactamente
          // esto: se deja constancia de que se volvió a mirar.
          status: "duplicate",
          counts: { fetched: 1, accepted: 0, rejected: 0, duplicate: 1 },
          contentHash,
          failure: null,
          qualityFlags: ["duplicate_content", ...evidence.qualityFlags],
          replayOfRunId: replayOf?.runId ?? null,
          idempotencyKey,
        },
  );

  if (dryRun) {
    return { ...partial, persisted: false, run };
  }

  // 5. Documento y grafo. La corrida que publica es la publicable: la nueva o,
  //    ante un duplicado, la original. Un registro que se cortó después de
  //    anotar su corrida se completa en vez de quedar cojo.
  const publishingRun = replayOf ?? run;
  const document = {
    sourceId: SEC_SOURCE_ID,
    sourceDocumentId: evidence.successionFiling.accessionNumber,
    documentType: evidence.successionFiling.form,
    subjectType: "legal_entity" as const,
    subjectId: plan.successorLegalEntityId!,
    publishedOn: evidence.successionFiling.filingDate,
    acceptedAt: evidence.successionFiling.acceptedAt,
    availableAt: evidence.availableAt,
    availabilityRule: "sec_acceptance",
    // Para un 8-K la fecha de reporte es la del evento.
    periodEndOn: evidence.effectiveOn,
    fiscalYear: null,
    fiscalPeriod: null,
  };
  const recordedDocuments = await sourceDocuments.record([
    sourceDocumentSchema.parse({
      ...document,
      contentHash: computeSourceDocumentContentHash(document),
      ingestionRunId: publishingRun.runId,
      recordedAt,
    }),
  ]);

  const applied =
    plan.status === "planned"
      ? await corporateActions.applySuccessionPlan(plan)
      : null;

  return {
    ...partial,
    persisted: true,
    run,
    sourceDocuments: recordedDocuments,
    applied,
  };
}
