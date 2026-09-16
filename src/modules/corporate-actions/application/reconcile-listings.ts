import { z } from "zod";

import { SEC_SOURCE_ID } from "@/modules/fundamentals/application/live-company-facts-source";
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
import type {
  SourceDocumentRecording,
  SourceDocumentRepository,
} from "@/modules/observations/application/source-document-repository";
import {
  computeSourceDocumentContentHash,
  sourceDocumentSchema,
  type SourceDocument,
} from "@/modules/observations/domain/source-document";

import {
  detectListingDivergences,
  LISTING_DIVERGENCE_RULE_VERSION,
  type ListingDivergence,
} from "../domain/detect-listing-divergences";
import { SEC_LISTING_INDEX_PARSER_VERSION } from "../domain/parse-sec-listing-index";
import {
  LISTING_RECONCILIATION_RULE_VERSION,
  planListingReconciliation,
  type ListingReconciliationPlan,
} from "../domain/plan-listing-reconciliation";
import {
  LISTING_EVIDENCE_RULE_VERSION,
  SEC_EXCHANGE_FILERS_VERSION,
  verifyListingCandidate,
  type EvidenceFiling,
  type ListingCandidate,
  type ListingVerification,
} from "../domain/verify-listing-evidence";
import type {
  CorporateActionRepository,
  ListingReconciliationSummary,
} from "./corporate-action-repository";
import {
  ListingEvidenceSourceError,
  type ListingEvidenceDocument,
  type ListingEvidenceSource,
} from "./listing-evidence-source";

/**
 * Reconciliación de listings: lleva al grafo los traspasos de mercado, delistings
 * y renombres que la SEC fecha, y nombra lo que no puede fechar (ADR 0013).
 *
 * El orden es el de toda ingesta del proyecto:
 *
 * 1. **registro y derechos**, sin red (`TM-15`);
 * 2. **grafo** registrado, sin red;
 * 3. **tabla** vigente de tickers: qué divergió. Un request;
 * 4. por cada filer que diverge o que el owner pidió verificar, su **índice**. Un
 *    documento que no se entiende cuarentena la corrida de ese filer (`TM-05`);
 * 5. **verificación y plan**, en dominio;
 * 6. **corrida**, **documentos** y **grafo**, en ese orden (`TM-16`).
 *
 * Una corrida por filer, con su CIK como sujeto: lo que se verifica de uno no
 * depende de otro, y la auditoría se lee por emisor.
 */
export const LISTING_DATASET_ID = "sec.submissions";

export const LISTING_PIPELINE = Object.freeze({
  parserVersion: "sec-listing-events-1.0.0",
  components: Object.freeze({
    index: SEC_LISTING_INDEX_PARSER_VERSION,
    divergence: LISTING_DIVERGENCE_RULE_VERSION,
    evidence: LISTING_EVIDENCE_RULE_VERSION,
    exchangeFilers: SEC_EXCHANGE_FILERS_VERSION,
    reconciliation: LISTING_RECONCILIATION_RULE_VERSION,
  }),
});

/**
 * Techo de filers por corrida. Un día normal diverge un puñado; más que esto es un
 * cambio de la tabla que merece mirarse antes de pagar cientos de requests, y lo
 * que sobra queda nombrado como diferido.
 */
export const MAX_FILERS_PER_RUN = 64;

const RIGHTS_REQUEST: IngestionRightsRequest = {
  storesRawPayload: false,
  storesNormalizedValues: true,
  publicDisplay: false,
};

const cikSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{1,10}$/u)
  .refine((value) => Number(value) > 0, "CIK must be positive.")
  .transform((value) => value.padStart(10, "0"));

export const reconcileListingsCommandSchema = z.object({
  mode: z.literal("personal"),
  dryRun: z.boolean().default(false),
  /** Filers cuyo delisting se verifica aunque la tabla todavía los muestre. */
  requestedCiks: z.array(cikSchema).max(MAX_FILERS_PER_RUN).default([]),
});

export type ReconcileListingsCommand = z.input<
  typeof reconcileListingsCommandSchema
>;

export type ReconcileListingsDependencies = {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly ingestionRuns: IngestionRunRepository;
  readonly sourceDocuments: SourceDocumentRepository;
  readonly corporateActions: CorporateActionRepository;
  /** Versiones abiertas del grafo de identidad. */
  readonly loadIdentityGraph: () => Promise<IdentityGraph>;
  readonly source: ListingEvidenceSource;
  readonly now: () => string;
  readonly newId: () => string;
};

export type FilerReconciliationOutcome = {
  readonly cik: string;
  readonly legalEntityId: string;
  /** `false` en un dry run. */
  readonly persisted: boolean;
  readonly run: IngestionRun;
  readonly document: ListingEvidenceDocument | null;
  readonly verifications: readonly ListingVerification[];
  readonly plan: ListingReconciliationPlan | null;
  readonly sourceDocuments: SourceDocumentRecording | null;
  readonly applied: ListingReconciliationSummary | null;
};

export type ReconcileListingsOutcome = {
  /** Rechazo antes de salir a la red; `null` si pasó el registro. */
  readonly rejection: IngestionRun | null;
  readonly assignments: ListingEvidenceDocument | null;
  readonly divergences: readonly ListingDivergence[];
  /** CIK pedidos que el grafo no tiene con un listing vigente. */
  readonly requestedNotInGraph: readonly string[];
  readonly filers: readonly FilerReconciliationOutcome[];
  /** Filers que superaron el techo de la corrida, sin verificar. */
  readonly deferred: readonly string[];
};

type RunFields = {
  readonly subjectKey: string | null;
  readonly status: IngestionRunStatus;
  readonly counts: IngestionRunCounts;
  readonly contentHash: string | null;
  readonly failure: IngestionFailure | null;
  readonly qualityFlags: readonly string[];
  readonly idempotencyKey?: string;
  readonly replayOfRunId?: string | null;
};

function flag(value: string): string {
  return value.slice(0, 64);
}

function evidenceFilings(plan: ListingReconciliationPlan): EvidenceFiling[] {
  const filings = plan.applied.flatMap((change) => {
    if (change.kind === "listing_transfer") {
      const { withdrawal, registration, certification, notice } =
        change.evidence;

      return [withdrawal, registration, certification, notice].filter(
        (filing): filing is EvidenceFiling => filing !== null,
      );
    }

    return change.kind === "delisting"
      ? [change.evidence.strike, change.evidence.notice]
      : [];
  });

  return [
    ...new Map(filings.map((filing) => [filing.accessionNumber, filing])),
  ].map(([, filing]) => filing);
}

export async function reconcileListings(
  command: ReconcileListingsCommand,
  dependencies: ReconcileListingsDependencies,
): Promise<ReconcileListingsOutcome> {
  const { dryRun, requestedCiks } =
    reconcileListingsCommandSchema.parse(command);
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
    datasetId: LISTING_DATASET_ID,
    parserVersion: LISTING_PIPELINE.parserVersion,
  };
  const requestKey = (subjectKey: string | null) => ({
    ...batchIdentity,
    requestedAsOf: null,
    requestedVintage: null,
    cursor: null,
    subjectKey,
    selectionVersion: null,
  });

  const record = async (
    startedAt: string,
    fields: RunFields,
  ): Promise<IngestionRun> => {
    const finishedAt = now();
    const run = ingestionRunSchema.parse({
      runId: newId(),
      ...batchIdentity,
      idempotencyKey:
        fields.idempotencyKey ??
        computeIdempotencyKey(requestKey(fields.subjectKey)),
      requestedAsOf: null,
      requestedVintage: null,
      cursor: null,
      nextCursor: null,
      subjectKey: fields.subjectKey,
      selectionVersion: null,
      status: fields.status,
      startedAt,
      finishedAt,
      counts: fields.counts,
      contentHash: fields.contentHash,
      failure: fields.failure,
      qualityFlags: [...new Set(fields.qualityFlags)].slice(0, 16),
      replayOfRunId: fields.replayOfRunId ?? null,
      recordedAt: finishedAt,
    });

    return dryRun ? run : ingestionRuns.append(run);
  };

  const failed = (
    startedAt: string,
    subjectKey: string | null,
    code: IngestionFailureCode,
    cause: unknown,
    options: { retryable?: boolean; qualityFlags?: string[] } = {},
  ) => {
    const failure = toSafeIngestionFailure(code, cause);

    return record(startedAt, {
      subjectKey,
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

  const blank = {
    rejection: null,
    assignments: null,
    divergences: [],
    requestedNotInGraph: [],
    filers: [],
    deferred: [],
  } as const;
  const startedAt = now();

  // 1. Registro y derechos, antes de cualquier egress.
  const entry = await sourceRegistry.findBySourceId(SEC_SOURCE_ID);

  if (!entry) {
    return {
      ...blank,
      rejection: await failed(
        startedAt,
        null,
        "source_not_registered",
        "La fuente solicitada no existe en el registro.",
      ),
    };
  }

  if (!entry.datasets.includes(LISTING_DATASET_ID)) {
    return {
      ...blank,
      rejection: await failed(
        startedAt,
        null,
        "dataset_not_registered",
        "El dataset solicitado no está declarado por la fuente.",
      ),
    };
  }

  const rights = evaluateIngestionRights(entry, RIGHTS_REQUEST);

  if (!rights.allowed) {
    return {
      ...blank,
      rejection: await failed(
        startedAt,
        null,
        "rights_not_approved",
        `Derechos sin aprobar: ${rights.blockedBy.join(", ")}`,
        { qualityFlags: ["rights_blocked"] },
      ),
    };
  }

  // 2. Grafo, todavía sin red.
  const graph = await loadIdentityGraph();

  // 3. Tabla vigente: qué divergió.
  const table = await source.loadAssignments();
  const { entities, divergences } = detectListingDivergences({
    graph,
    assignments: table.assignments,
  });

  const candidatesByCik = new Map<string, ListingCandidate[]>();

  for (const divergence of divergences) {
    candidatesByCik.set(divergence.cik, [
      ...(candidatesByCik.get(divergence.cik) ?? []),
      divergence,
    ]);
  }

  const requestedNotInGraph: string[] = [];

  for (const cik of requestedCiks) {
    const entity = entities.get(cik);

    if (entity === undefined) {
      requestedNotInGraph.push(cik);
      continue;
    }

    const existing = candidatesByCik.get(cik) ?? [];
    const covered = new Set(
      existing.flatMap((candidate) =>
        "listing" in candidate ? [candidate.listing.listingId] : [],
      ),
    );

    candidatesByCik.set(cik, [
      ...existing,
      ...entity.listings
        .filter((listing) => !covered.has(listing.listingId))
        .map((listing) => ({
          kind: "check_requested" as const,
          cik,
          legalEntityId: entity.legalEntityId,
          listing,
        })),
    ]);
  }

  const ciks = [...candidatesByCik.keys()].sort();
  const filers: FilerReconciliationOutcome[] = [];

  // 4-6. Un filer por vez, con su propia corrida.
  for (const cik of ciks.slice(0, MAX_FILERS_PER_RUN)) {
    const entity = entities.get(cik)!;
    const candidates = candidatesByCik.get(cik)!;
    const filerStartedAt = now();
    const base = {
      cik,
      legalEntityId: entity.legalEntityId,
      verifications: [],
      plan: null,
      sourceDocuments: null,
      applied: null,
    } as const;

    let download;

    try {
      download = await source.loadIndex(cik);
    } catch (cause) {
      const run =
        cause instanceof ListingEvidenceSourceError &&
        (cause.code === "payload_schema_invalid" ||
          cause.code === "subject_mismatch")
          ? await record(filerStartedAt, {
              subjectKey: cik,
              status: "quarantined",
              counts: EMPTY_COUNTS,
              contentHash: computeContentHash({ cik, failure: cause.code }),
              failure: null,
              qualityFlags: [flag(`${cause.document}_${cause.code}`)],
            })
          : await failed(filerStartedAt, cik, "provider_error", cause, {
              retryable:
                cause instanceof ListingEvidenceSourceError
                  ? cause.retryable
                  : false,
            });

      filers.push({ ...base, persisted: !dryRun, run, document: null });
      continue;
    }

    const verifications = candidates.map((candidate) =>
      verifyListingCandidate({
        candidate,
        entity,
        index: download.index,
        fetchedAt: download.document.fetchedAt,
      }),
    );
    const changes = verifications.flatMap((verification) =>
      verification.status === "verified" ? [verification.change] : [],
    );
    const documentIds = changes.flatMap((change) =>
      change.kind === "listing_transfer"
        ? [change.evidence.certification.accessionNumber]
        : change.kind === "delisting"
          ? [change.evidence.strike.accessionNumber]
          : [],
    );
    const recordedAt = now();
    const plan = planListingReconciliation({
      cik,
      legalEntityId: entity.legalEntityId,
      changes,
      corporateActions:
        documentIds.length === 0
          ? []
          : await corporateActions.listCorporateActions({
              sourceDocumentIds: documentIds,
            }),
      recordedAt,
      newId,
    });

    const rejectionCodes = [
      ...verifications.flatMap((verification) =>
        verification.status === "rejected" ? [verification.code] : [],
      ),
      ...plan.rejections.map((rejection) => rejection.code),
    ];
    const accepted = plan.applied.length;
    const rejected = rejectionCodes.length;
    const fetched = accepted + rejected;
    const contentHash = computeContentHash({
      cik,
      pipeline: LISTING_PIPELINE,
      applied: plan.applied,
      rejections: [
        ...verifications.flatMap((verification) =>
          verification.status === "rejected"
            ? [
                {
                  code: verification.code,
                  kind: verification.candidate.kind,
                  listingId:
                    "listing" in verification.candidate
                      ? verification.candidate.listing.listingId
                      : null,
                },
              ]
            : [],
        ),
        ...plan.rejections.map((rejection) => ({
          code: rejection.code,
          kind: rejection.change.kind,
        })),
      ],
    });
    const qualityFlags = [
      ...rejectionCodes.map((code) => flag(`listing_${code}`)),
      ...plan.applied.flatMap((change) =>
        change.kind === "listing_transfer" && change.evidence.notice === null
          ? ["transfer_notice_not_found"]
          : change.kind === "rename" && change.mode === "correction"
            ? ["rename_corrects_recorded_version"]
            : [],
      ),
    ];
    const status: IngestionRunStatus =
      fetched === 0
        ? "empty"
        : accepted === 0
          ? "quarantined"
          : rejected === 0
            ? "succeeded"
            : "partial";
    const idempotencyKey = computeIdempotencyKey({
      ...requestKey(cik),
      documentVersion: contentHash,
    });
    const previous = isPublishableStatus(status)
      ? await ingestionRuns.findByIdempotencyKey(idempotencyKey)
      : null;
    const replayOf =
      previous !== null && isPublishableStatus(previous.status)
        ? previous
        : null;

    const run = await record(
      filerStartedAt,
      replayOf === null
        ? {
            subjectKey: cik,
            status,
            counts: { fetched, accepted, rejected, duplicate: 0 },
            contentHash,
            failure: null,
            qualityFlags,
            idempotencyKey: isPublishableStatus(status)
              ? idempotencyKey
              : undefined,
          }
        : {
            // La misma evidencia ya se registró: un registro que se cortó
            // después de anotar su corrida se completa bajo la original.
            subjectKey: cik,
            status: "duplicate",
            counts: { fetched, accepted: 0, rejected: 0, duplicate: fetched },
            contentHash,
            failure: null,
            qualityFlags: ["duplicate_content", ...qualityFlags],
            idempotencyKey,
            replayOfRunId: replayOf.runId,
          },
    );
    const partial = {
      ...base,
      document: download.document,
      verifications,
      plan,
      run,
    };

    if (dryRun || plan.status !== "planned") {
      filers.push({ ...partial, persisted: !dryRun });
      continue;
    }

    const publishingRun = replayOf ?? run;
    const documents: SourceDocument[] = evidenceFilings(plan).map((filing) => {
      const content = {
        sourceId: SEC_SOURCE_ID,
        sourceDocumentId: filing.accessionNumber,
        documentType: filing.form,
        subjectType: "legal_entity" as const,
        subjectId: entity.legalEntityId,
        publishedOn: filing.filingDate,
        acceptedAt: filing.acceptedAt,
        availableAt: filing.acceptedAt,
        availabilityRule: "sec_acceptance",
        periodEndOn: filing.reportDate,
        fiscalYear: null,
        fiscalPeriod: null,
      };

      return sourceDocumentSchema.parse({
        ...content,
        contentHash: computeSourceDocumentContentHash(content),
        ingestionRunId: publishingRun.runId,
        recordedAt,
      });
    });
    const recordedDocuments =
      documents.length === 0 ? null : await sourceDocuments.record(documents);
    const applied = await corporateActions.applyListingPlan(plan);

    filers.push({
      ...partial,
      persisted: true,
      sourceDocuments: recordedDocuments,
      applied,
    });
  }

  return {
    rejection: null,
    assignments: table.document,
    divergences,
    requestedNotInGraph,
    filers,
    deferred: ciks.slice(MAX_FILERS_PER_RUN),
  };
}
