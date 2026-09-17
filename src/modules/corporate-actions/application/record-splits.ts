import { z } from "zod";

import { SEC_SOURCE_ID } from "@/modules/fundamentals/application/live-company-facts-source";
import { SEC_COMPANY_CONCEPT_PARSER_VERSION } from "@/modules/fundamentals/domain/parse-sec-company-concept";
import { normalizeCik } from "@/modules/fundamentals/domain/parse-sec-submissions";
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
import type { ObservationRepository } from "@/modules/observations/application/observation-repository";
import type { SourceDocumentRepository } from "@/modules/observations/application/source-document-repository";
import type { Observation } from "@/modules/observations/domain/observation";

import {
  planSplitRecording,
  SPLIT_RECORDING_RULE_VERSION,
  type SplitRecordingPlan,
} from "../domain/plan-split-recording";
import {
  isShareBasisError,
  listSplitSensitiveConcepts,
  SPLIT_BASIS_RULE_VERSION,
} from "../domain/share-basis";
import {
  partitionSplitClaimsByHistory,
  SPLIT_CLAIM_HORIZON_VERSION,
  type SplitClaimBeforeHistory,
} from "../domain/split-claim-horizon";
import {
  evaluateSplitEvidence,
  SPLIT_EVIDENCE_RULE_VERSION,
  type SplitEvidence,
} from "../domain/verify-split-evidence";
import type {
  CorporateActionRepository,
  SplitRecordingSummary,
} from "./corporate-action-repository";
import {
  SplitClaimSourceError,
  type SplitClaimDocument,
  type SplitClaimSource,
} from "./split-claim-source";

/**
 * Verificación y registro de los splits de un filer.
 *
 * El orden es el de toda ingesta:
 *
 * 1. **registro y derechos**, sin red (`TM-15`);
 * 2. **sujeto y re-expresiones**, sin red: el CIK tiene que estar en el grafo y el
 *    filer tiene que tener hechos sensibles publicados. Sin esos hechos no hay
 *    segunda evidencia posible, y descargar el ratio sería gastar cuota para
 *    dejar todo `candidate`;
 * 3. **ratios declarados**, de `companyconcept`. Un documento que no se entiende se
 *    cuarentena (`TM-05`);
 * 4. **evidencia y plan**, en dominio;
 * 5. **corrida** y **eventos**, en ese orden (`TM-16`).
 *
 * Correr esto después de cada ingesta del filer es parte del runbook: la lectura
 * `latest_adjusted` sólo conoce los splits que este job registró.
 */
export const SPLIT_DATASET_ID = "sec.companyconcept";

export const SPLIT_PIPELINE = Object.freeze({
  parserVersion: "sec-split-1.1.0",
  components: Object.freeze({
    companyconcept: SEC_COMPANY_CONCEPT_PARSER_VERSION,
    horizon: SPLIT_CLAIM_HORIZON_VERSION,
    basis: SPLIT_BASIS_RULE_VERSION,
    evidence: SPLIT_EVIDENCE_RULE_VERSION,
    recording: SPLIT_RECORDING_RULE_VERSION,
  }),
});

/** Se guarda el evento derivado, nunca el documento descargado. */
const RIGHTS_REQUEST: IngestionRightsRequest = {
  storesRawPayload: false,
  storesNormalizedValues: true,
  publicDisplay: false,
};

/** Techo por concepto sensible; alcanzarlo es un error, no un truncado (`TM-07`). */
const REVISIONS_PER_CONCEPT = 1000;

export const recordSplitsCommandSchema = z.object({
  cik: z
    .string()
    .trim()
    .transform((value, context) => {
      const cik = normalizeCik(value);

      if (cik === null) {
        context.addIssue({ code: "custom", message: "CIK is not valid." });
        return z.NEVER;
      }

      return cik;
    }),
  mode: z.literal("personal"),
  /** Descarga, verifica y planifica, pero no registra corrida ni eventos. */
  dryRun: z.boolean().default(false),
});

export type RecordSplitsCommand = z.input<typeof recordSplitsCommandSchema>;

export type RecordSplitsDependencies = {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly ingestionRuns: IngestionRunRepository;
  readonly sourceDocuments: SourceDocumentRepository;
  readonly observations: ObservationRepository;
  readonly corporateActions: CorporateActionRepository;
  /** Versiones abiertas del grafo de identidad. */
  readonly loadIdentityGraph: () => Promise<IdentityGraph>;
  readonly source: SplitClaimSource;
  readonly now: () => string;
  readonly newId: () => string;
};

export type RecordSplitsRejection =
  "subject_not_in_graph" | "no_published_share_facts";

export type RecordSplitsOutcome = {
  readonly persisted: boolean;
  readonly cik: string;
  readonly legalEntityId: string | null;
  /** `null` cuando la solicitud se cortó antes de salir a la red. */
  readonly run: IngestionRun | null;
  readonly rejection: RecordSplitsRejection | null;
  readonly sensitiveRevisions: number;
  readonly documents: readonly SplitClaimDocument[];
  /**
   * Ratios declarados antes de la primera vintage sensible publicada: la regla
   * no los juzga, porque no hay re-expresión posible (ADR 0017).
   */
  readonly claimsBeforeHistory: readonly SplitClaimBeforeHistory[];
  readonly evidence: SplitEvidence | null;
  readonly plan: SplitRecordingPlan | null;
  readonly applied: SplitRecordingSummary | null;
};

export class SplitEvidenceReadLimitError extends Error {
  constructor(concept: string) {
    super(
      `The filer has ${REVISIONS_PER_CONCEPT} or more revisions of ${concept}; the evidence read would be truncated.`,
    );
    this.name = "SplitEvidenceReadLimitError";
  }
}

async function loadSensitiveRevisions(
  observations: ObservationRepository,
  legalEntityId: string,
): Promise<Observation[]> {
  const rows: Observation[] = [];

  // Una lectura por concepto: el techo del repositorio es por consulta y un filer
  // con treinta años de historia supera mil revisiones sumando los seis.
  for (const concept of listSplitSensitiveConcepts()) {
    const revisions = await observations.list({
      subjectType: "legal_entity",
      subjectId: legalEntityId,
      metricIds: [concept],
      limit: REVISIONS_PER_CONCEPT,
    });

    if (revisions.length >= REVISIONS_PER_CONCEPT) {
      throw new SplitEvidenceReadLimitError(concept);
    }

    rows.push(...revisions);
  }

  return rows;
}

export async function recordSplits(
  command: RecordSplitsCommand,
  dependencies: RecordSplitsDependencies,
): Promise<RecordSplitsOutcome> {
  const { cik, dryRun } = recordSplitsCommandSchema.parse(command);
  const {
    sourceRegistry,
    ingestionRuns,
    sourceDocuments,
    observations,
    corporateActions,
    loadIdentityGraph,
    source,
    now,
    newId,
  } = dependencies;

  const batchIdentity = {
    sourceId: SEC_SOURCE_ID,
    datasetId: SPLIT_DATASET_ID,
    parserVersion: SPLIT_PIPELINE.parserVersion,
  };
  const requestKey = {
    ...batchIdentity,
    requestedAsOf: null,
    requestedVintage: null,
    cursor: null,
    subjectKey: cik,
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
      subjectKey: cik,
      selectionVersion: null,
      status: fields.status,
      startedAt,
      finishedAt,
      counts: fields.counts,
      contentHash: fields.contentHash,
      failure: fields.failure,
      qualityFlags: fields.qualityFlags.slice(0, 16),
      replayOfRunId: fields.replayOfRunId ?? null,
      recordedAt: finishedAt,
    });

    return dryRun ? run : ingestionRuns.append(run);
  };

  const blank = {
    cik,
    legalEntityId: null,
    rejection: null,
    sensitiveRevisions: 0,
    documents: [],
    claimsBeforeHistory: [],
    evidence: null,
    plan: null,
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

  if (!entry.datasets.includes(SPLIT_DATASET_ID)) {
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

  // 2. Sujeto y re-expresiones publicadas, todavía sin red.
  const graph = await loadIdentityGraph();
  const legalEntityId =
    graph.identifierAssignments.find(
      (assignment) =>
        assignment.identifierType === "cik" &&
        assignment.subjectType === "legal_entity" &&
        assignment.confidence === "authoritative" &&
        assignment.validTo === null &&
        assignment.supersededAt === null &&
        assignment.normalizedValue === cik,
    )?.subjectId ?? null;

  if (legalEntityId === null) {
    return {
      ...blank,
      persisted: false,
      run: null,
      rejection: "subject_not_in_graph",
    };
  }

  const revisions = await loadSensitiveRevisions(observations, legalEntityId);
  const withSubject = { ...blank, legalEntityId };

  if (revisions.length === 0) {
    return {
      ...withSubject,
      persisted: false,
      run: null,
      rejection: "no_published_share_facts",
    };
  }

  const withRevisions = {
    ...withSubject,
    sensitiveRevisions: revisions.length,
  };
  const emptyHash = computeStagedBatchHash(batchIdentity, []);

  // 3. Ratios declarados.
  let download;

  try {
    download = await source.load({ cik });
  } catch (cause) {
    if (
      cause instanceof SplitClaimSourceError &&
      (cause.code === "payload_schema_invalid" ||
        cause.code === "subject_mismatch")
    ) {
      return {
        ...withRevisions,
        persisted: !dryRun,
        run: await record({
          status: "quarantined",
          counts: EMPTY_COUNTS,
          contentHash: emptyHash,
          failure: null,
          qualityFlags: [`companyconcept_${cause.code}`],
        }),
      };
    }

    return {
      ...withRevisions,
      persisted: !dryRun,
      run: await failed("provider_error", cause, {
        retryable:
          cause instanceof SplitClaimSourceError ? cause.retryable : false,
      }),
    };
  }

  const claims = download.status === "claims" ? download.claims : [];
  const accessions = [
    ...new Set(claims.map((claim) => claim.accessionNumber)),
  ].sort();

  // 4. Evidencia y plan, sólo sobre los ratios que caen dentro de la historia
  //    publicada: lo anterior se nombra y no se juzga.
  let evidence: SplitEvidence;
  let claimsBeforeHistory: readonly SplitClaimBeforeHistory[] = [];

  try {
    const documents =
      accessions.length === 0
        ? []
        : await sourceDocuments.findByIds({
            sourceId: SEC_SOURCE_ID,
            sourceDocumentIds: accessions,
          });
    const horizon = partitionSplitClaimsByHistory({
      claims,
      observations: revisions,
      documents,
    });
    claimsBeforeHistory = horizon.before;

    evidence = evaluateSplitEvidence({
      legalEntityId,
      claims: horizon.within,
      observations: revisions,
      documents,
    });
  } catch (cause) {
    if (isShareBasisError(cause)) {
      return {
        ...withRevisions,
        documents: download.documents,
        persisted: !dryRun,
        run: await failed(
          "provider_contract_invalid",
          `${cause.code}: ${cause.message}`,
        ),
      };
    }

    throw cause;
  }

  const recorded = await corporateActions.listCorporateActions({
    subjectIds: [legalEntityId],
    ...(accessions.length === 0 ? {} : { sourceDocumentIds: accessions }),
    actionTypes: ["split", "reverse_split"],
  });
  const recordedAt = now();
  const plan = planSplitRecording({
    legalEntityId,
    evidence,
    corporateActions: recorded,
    recordedAt,
    newId,
  });

  const fetched = evidence.filings.length + claimsBeforeHistory.length;
  const accepted = evidence.filings.filter(
    (filing) => filing.status !== "candidate",
  ).length;
  const rejected = fetched - accepted;
  const qualityFlags = [
    ...new Set([
      ...[...evidence.filings, ...claimsBeforeHistory]
        .filter((filing) => filing.code !== null)
        .map((filing) => `split_candidate_${filing.code}`)
        .sort(),
      ...evidence.splits.flatMap((split) => split.qualityFlags),
      ...(plan.notReconfirmed.length > 0
        ? ["recorded_split_not_reconfirmed"]
        : []),
      ...(download.status === "claims" && download.rejections.length > 0
        ? ["companyconcept_rows_rejected"]
        : []),
      ...(download.status === "no_claims" ? ["no_split_ratio_claims"] : []),
    ]),
  ];
  const contentHash = computeContentHash({
    cik,
    legalEntityId,
    pipeline: SPLIT_PIPELINE,
    claimsBeforeHistory,
    evidence,
  });
  const idempotencyKey = computeIdempotencyKey({
    ...requestKey,
    documentVersion: contentHash,
  });
  const partial = {
    ...withRevisions,
    documents: download.documents,
    claimsBeforeHistory,
    evidence,
    plan,
  };

  if (plan.status === "rejected") {
    return {
      ...partial,
      persisted: !dryRun,
      run: await record({
        status: "quarantined",
        counts: { fetched, accepted: 0, rejected: fetched, duplicate: 0 },
        contentHash,
        failure: null,
        qualityFlags: [`split_${plan.rejection}`, ...qualityFlags],
        idempotencyKey,
      }),
    };
  }

  const previous = await ingestionRuns.findByIdempotencyKey(idempotencyKey);
  const replayOf =
    previous !== null && isPublishableStatus(previous.status) ? previous : null;

  const run = await record(
    fetched === 0
      ? {
          status: "empty",
          counts: EMPTY_COUNTS,
          contentHash,
          failure: null,
          qualityFlags,
          idempotencyKey,
        }
      : replayOf !== null
        ? {
            // La misma evidencia ya se registró: se deja constancia de que se
            // volvió a mirar.
            status: "duplicate",
            counts: { fetched, accepted: 0, rejected: 0, duplicate: fetched },
            contentHash,
            failure: null,
            qualityFlags: ["duplicate_content", ...qualityFlags],
            replayOfRunId: replayOf.runId,
            idempotencyKey,
          }
        : {
            // Sólo candidatos: nada verificó, igual que una sucesión que no cierra.
            status:
              accepted === 0
                ? "quarantined"
                : rejected > 0
                  ? "partial"
                  : "succeeded",
            counts: { fetched, accepted, rejected, duplicate: 0 },
            contentHash,
            failure: null,
            qualityFlags,
            idempotencyKey,
          },
  );

  if (dryRun) {
    return { ...partial, persisted: false, run };
  }

  // 5. Eventos. Un registro que se cortó después de anotar su corrida se completa
  //    en la corrida siguiente: el plan vuelve a salir `planned`.
  const applied =
    plan.status === "planned"
      ? await corporateActions.applySplitPlan(plan)
      : null;

  return { ...partial, persisted: true, run, applied };
}
