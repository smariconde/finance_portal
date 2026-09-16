import { z } from "zod";
import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  computeIdempotencyKey,
  ingestionRunSchema,
  isPublishableStatus,
  type IngestionRun,
} from "@/modules/ingestion/domain/ingestion-run";
import { toSafeIngestionFailure } from "@/modules/ingestion/domain/ingestion-failure";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import {
  computeSourceDocumentContentHash,
  sourceDocumentSchema,
  type SourceDocumentContent,
} from "@/modules/observations/domain/source-document";
import type { SourceDocumentRepository } from "@/modules/observations/application/source-document-repository";
import {
  declaredEventSchema,
  DECLARED_EVENT_RULE_VERSION,
  type DeclaredEventInput,
  type DeclaredEventPlan,
} from "../domain/declared-event";
import {
  declaredEntityIds,
  planDeclaredEvent,
  type DeclaredEventEvidence,
} from "../domain/plan-declared-event";
import type {
  CorporateActionRepository,
  DeclaredEventSummary,
} from "./corporate-action-repository";
import {
  ListingEvidenceSourceError,
  type ListingEvidenceSource,
} from "./listing-evidence-source";

export const DECLARED_EVENT_PIPELINE_VERSION = "sec-declared-event-1.0.0";
export type RecordDeclaredEventDependencies = {
  readonly sourceRegistry: Pick<SourceRegistryRepository, "findBySourceId">;
  readonly ingestionRuns: IngestionRunRepository;
  readonly sourceDocuments: SourceDocumentRepository;
  readonly corporateActions: CorporateActionRepository;
  readonly loadIdentityGraph: () => Promise<IdentityGraph>;
  readonly source: ListingEvidenceSource;
  readonly now: () => string;
  readonly newId: () => string;
};
export type RecordDeclaredEventOutcome = {
  readonly run: IngestionRun;
  readonly rejection: string | null;
  readonly plan: DeclaredEventPlan | null;
  readonly applied: DeclaredEventSummary | null;
};
const commandSchema = z
  .object({
    declaration: declaredEventSchema,
    mode: z.literal("personal"),
    dryRun: z.boolean().default(true),
  })
  .strict();

/** A local job: rights → evidence → pure plan → audit/documents → atomic graph. */
export async function recordDeclaredEvent(
  command: {
    declaration: DeclaredEventInput;
    mode: "personal";
    dryRun?: boolean;
  },
  deps: RecordDeclaredEventDependencies,
): Promise<RecordDeclaredEventOutcome> {
  const { declaration, dryRun } = commandSchema.parse(command);
  const startedAt = deps.now();
  const subjectKey =
    declaration.kind === "acquisition"
      ? declaration.acquiredCik
      : declaration.cik;
  const datasetId =
    declaration.kind === "acquisition"
      ? "sec.submissions"
      : "sec.company-tickers-exchange";
  const identity = {
    sourceId: "sec-edgar",
    datasetId,
    parserVersion: DECLARED_EVENT_PIPELINE_VERSION,
    requestedAsOf: declaration.effectiveOn,
    requestedVintage: null,
    cursor: null,
    subjectKey,
    selectionVersion: DECLARED_EVENT_RULE_VERSION,
  };
  const declarationHash = computeContentHash(declaration);
  const contentHash = computeContentHash({
    declarationHash,
    rule: DECLARED_EVENT_RULE_VERSION,
  });
  const publishingKey = computeIdempotencyKey({
    ...identity,
    documentVersion: contentHash,
  });
  const record = async (
    status: "succeeded" | "duplicate" | "quarantined" | "failed",
    rejection: string | null,
    replayOf: IngestionRun | null = null,
    at = deps.now(),
    cause?: unknown,
  ) => {
    const run = ingestionRunSchema.parse({
      ...identity,
      runId: deps.newId(),
      idempotencyKey: publishingKey,
      nextCursor: null,
      status,
      startedAt,
      finishedAt: at,
      recordedAt: at,
      contentHash: status === "failed" ? null : contentHash,
      failure:
        status === "failed"
          ? {
              ...toSafeIngestionFailure("provider_error", cause ?? rejection),
              retryable:
                cause instanceof ListingEvidenceSourceError && cause.retryable,
            }
          : null,
      qualityFlags: rejection ? [rejection] : [],
      replayOfRunId: replayOf?.runId ?? null,
      counts: {
        fetched: status === "failed" ? 0 : 1,
        accepted: status === "succeeded" ? 1 : 0,
        rejected: status === "quarantined" ? 1 : 0,
        duplicate: status === "duplicate" ? 1 : 0,
      },
    });
    return dryRun ? run : deps.ingestionRuns.append(run);
  };
  const reject = async (
    reason: string,
    plan: DeclaredEventPlan | null = null,
  ): Promise<RecordDeclaredEventOutcome> => ({
    run: await record("quarantined", reason),
    rejection: reason,
    plan,
    applied: null,
  });
  const entry = await deps.sourceRegistry.findBySourceId("sec-edgar");
  if (!entry) return reject("source_not_registered");
  if (!entry.datasets.includes(datasetId))
    return reject("dataset_not_registered");
  if (
    !evaluateIngestionRights(entry, {
      storesRawPayload: false,
      storesNormalizedValues: true,
      publicDisplay: false,
    }).allowed
  )
    return reject("rights_not_approved");
  const graph = await deps.loadIdentityGraph();
  const ciks =
    declaration.kind === "acquisition"
      ? [declaration.acquiredCik, declaration.acquirerCik]
      : [declaration.cik];
  if (ciks.some((cik) => declaredEntityIds(graph, cik).length !== 1))
    return reject("entity_not_uniquely_in_graph");
  if (Date.parse(declaration.decidedAt) > Date.parse(startedAt))
    return reject("future_declaration");
  let evidence: DeclaredEventEvidence;
  try {
    if (declaration.kind === "acquisition") {
      const acquired = await deps.source.loadIndex(declaration.acquiredCik);
      const acquirer = await deps.source.loadIndex(declaration.acquirerCik);
      evidence = {
        kind: "acquisition",
        acquired: acquired.index,
        acquirer: acquirer.index,
        fetchedAt: new Date(
          Math.min(
            Date.parse(acquired.document.fetchedAt),
            Date.parse(acquirer.document.fetchedAt),
          ),
        ).toISOString(),
      };
    } else {
      const download = await deps.source.loadAssignments({
        requireComplete: true,
      });
      evidence = {
        kind: "symbol_change",
        assignments: download.assignments,
        fetchedAt: download.document.fetchedAt,
      };
    }
  } catch (cause) {
    if (
      cause instanceof ListingEvidenceSourceError &&
      ["payload_schema_invalid", "subject_mismatch"].includes(cause.code)
    )
      return reject(cause.code);
    return {
      run: await record("failed", "provider_error", null, deps.now(), cause),
      rejection: "provider_error",
      plan: null,
      applied: null,
    };
  }
  const [corporateActions, relationships] = await Promise.all([
    deps.corporateActions.listCorporateActions(),
    deps.corporateActions.listRelationships(),
  ]);
  const recordedAt = deps.now();
  const input = {
    declaration,
    evidence,
    graph,
    corporateActions,
    relationships,
    recordedAt,
    newId: deps.newId,
  };
  let plan = planDeclaredEvent(input);
  if (plan.status === "rejected") return reject(plan.rejection!, plan);
  // The declaration is the replay identity. Event and document hashes retain the
  // verified proof independently; unrelated SEC filings never change this key.
  const existing = await deps.ingestionRuns.findByIdempotencyKey(publishingKey);
  const previous =
    existing && isPublishableStatus(existing.status) ? existing : null;
  if (previous && plan.status === "planned")
    plan = planDeclaredEvent({
      ...input,
      firstVerifiedAt: previous.recordedAt,
    });
  if (plan.status === "rejected") return reject(plan.rejection!, plan);
  if (plan.status === "unchanged")
    return {
      run: await record("duplicate", null, previous),
      rejection: null,
      plan,
      applied: null,
    };

  const documentContents: SourceDocumentContent[] = plan.filings.map(
    ({ subjectId, filing }) => ({
      sourceId: "sec-edgar",
      sourceDocumentId: filing.accessionNumber,
      documentType: filing.form,
      subjectType: "legal_entity",
      subjectId,
      publishedOn: filing.filingDate,
      acceptedAt: filing.acceptedAt,
      availableAt: filing.acceptedAt!,
      availabilityRule: "sec_acceptance",
      periodEndOn: filing.reportDate,
      fiscalYear: null,
      fiscalPeriod: null,
    }),
  );
  if (declaration.kind === "symbol_change") {
    const action = plan.corporateActions[0]!;
    documentContents.push({
      sourceId: "sec-edgar",
      sourceDocumentId: action.sourceDocumentId,
      documentType: "owner_symbol_declaration",
      subjectType: "listing",
      subjectId: action.subjectId,
      publishedOn: null,
      acceptedAt: null,
      availableAt: action.availableAt,
      availabilityRule: "owner-declaration-verified-1.0.0",
      periodEndOn: declaration.effectiveOn,
      fiscalYear: null,
      fiscalPeriod: null,
    });
  }
  const stored = await deps.sourceDocuments.findByIds({
    sourceId: "sec-edgar",
    sourceDocumentIds: documentContents.map((d) => d.sourceDocumentId),
  });
  if (
    documentContents.some((d) =>
      stored.some(
        (old) =>
          old.sourceDocumentId === d.sourceDocumentId &&
          old.contentHash !== computeSourceDocumentContentHash(d),
      ),
    )
  )
    return reject("source_document_conflict", plan);
  const run = await record(
    previous ? "duplicate" : "succeeded",
    null,
    previous,
    recordedAt,
  );
  if (dryRun) return { run, rejection: null, plan, applied: null };
  const documents = await deps.sourceDocuments.record(
    documentContents.map((d) =>
      sourceDocumentSchema.parse({
        ...d,
        contentHash: computeSourceDocumentContentHash(d),
        ingestionRunId: (previous ?? run).runId,
        recordedAt,
      }),
    ),
  );
  if (documents.conflicts.length)
    return reject("source_document_conflict", plan);
  const applied = await deps.corporateActions.applyDeclaredEventPlan(plan);
  return { run, rejection: null, plan, applied };
}
