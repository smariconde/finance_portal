import { z } from "zod";

import type { IdentityResolver } from "@/modules/identity/application/identity-resolver";
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
import {
  computeStagedBatchHash,
  stagedRecordSchema,
  type StagedRecord,
} from "@/modules/ingestion/domain/staged-record";
import type { ObservationRepository } from "@/modules/observations/application/observation-repository";
import {
  publishObservations,
  type ObservationRejectionCode,
} from "@/modules/observations/application/publish-observations";
import type {
  SourceDocumentRecording,
  SourceDocumentRepository,
} from "@/modules/observations/application/source-document-repository";
import {
  computeSourceDocumentContentHash,
  sourceDocumentSchema,
  type SourceDocument,
} from "@/modules/observations/domain/source-document";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import {
  buildSecFactVintages,
  type SecDocumentDraft,
  type SecFactRejection,
  type SecFactVintagesCounts,
} from "../domain/build-sec-fact-vintages";
import {
  SEC_COMPANY_FACTS_PARSER_VERSION,
  type SecCompanyFactsCounts,
} from "../domain/parse-sec-company-facts";
import { SEC_SUBMISSIONS_PARSER_VERSION } from "../domain/parse-sec-submissions";
import { SEC_CONCEPT_SELECTION_VERSION } from "../domain/sec-concept-selection";
import { SEC_FACT_RULES_VERSION } from "../domain/sec-fact-rules";
import type {
  SecHistoryWindow,
  SecHistoryWindowSelection,
} from "../domain/sec-history-window";
import {
  CompanyFactsSourceError,
  type CompanyFactsDocument,
  type CompanyFactsSource,
} from "./company-facts-source";
import { SEC_SOURCE_ID } from "./live-company-facts-source";

/**
 * Ingesta de los hechos XBRL de un filer: la primera corrida de datos reales que
 * termina en observaciones point-in-time.
 *
 * El orden es el que exige el threat model y no se negocia:
 *
 * 1. **registro y derechos**, sin red: una fuente no aprobada no genera tráfico
 *    (`TM-15`);
 * 2. **sujeto**, sin red: un CIK que el universo no conoce no justifica una
 *    descarga;
 * 3. **descarga y vintages**: un documento que no se entiende se cuarentena y no
 *    toca lo publicado (`TM-05`);
 * 4. **corrida**, **documentos** y **observaciones**, en ese orden, porque cada
 *    uno referencia al anterior.
 *
 * La corrida es una por documento y no una por página: toda observación publicada
 * se explica hasta la descarga de companyfacts que la trajo (`TM-16`).
 */
export const COMPANY_FACTS_DATASET_ID = "sec.companyfacts";

/**
 * Versión del pipeline que se registra como `parser_version` de la corrida.
 * Cubre los dos parsers y las reglas de hecho, porque los tres deciden el
 * contenido publicado. El test del orquestador fija los componentes: cambiar uno
 * sin subir esta versión rompe ese test, no la historia.
 */
export const COMPANY_FACTS_PIPELINE = Object.freeze({
  parserVersion: "sec-companyfacts-1.0.0",
  components: Object.freeze({
    companyFacts: SEC_COMPANY_FACTS_PARSER_VERSION,
    submissions: SEC_SUBMISSIONS_PARSER_VERSION,
    factRules: SEC_FACT_RULES_VERSION,
  }),
});

/** Scope del CIK en el grafo de identidad (`plan-universe-constitution.ts`). */
export const CIK_SCOPE = "sec:filer";

/**
 * Lo que la corrida guarda: valores normalizados y derivados. El payload no se
 * conserva, así que no se pide `rawStorage`.
 */
const RIGHTS_REQUEST: IngestionRightsRequest = {
  storesRawPayload: false,
  storesNormalizedValues: true,
  publicDisplay: false,
};

export const ingestCompanyFactsCommandSchema = z.object({
  cik: z
    .string()
    .trim()
    .regex(/^[0-9]{1,10}$/u)
    .refine((value) => Number(value) > 0)
    .transform((value) => value.padStart(10, "0")),
  mode: z.literal("personal"),
  /** Descarga y arma todo, pero no registra corrida, documentos ni observaciones. */
  dryRun: z.boolean().default(false),
});

export type IngestCompanyFactsCommand = z.input<
  typeof ingestCompanyFactsCommandSchema
>;

export class SubjectNotInUniverseError extends Error {
  readonly cik: string;
  readonly status: string;

  constructor(cik: string, status: string) {
    super(`CIK ${cik} does not resolve to a legal entity (${status}).`);
    this.name = "SubjectNotInUniverseError";
    this.cik = cik;
    this.status = status;
  }
}

export type IngestCompanyFactsDependencies = {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly ingestionRuns: IngestionRunRepository;
  readonly sourceDocuments: SourceDocumentRepository;
  readonly observations: ObservationRepository;
  readonly identity: IdentityResolver;
  readonly source: CompanyFactsSource;
  /** Reloj inyectado: el dominio no lee `Date.now()`. */
  readonly now: () => string;
  readonly newId: () => string;
};

export type CompanyFactsPublicationSummary = {
  readonly published: number;
  readonly restated: number;
  readonly duplicates: number;
  readonly rejections: Readonly<
    Partial<Record<ObservationRejectionCode, number>>
  >;
};

export type IngestCompanyFactsOutcome = {
  /** `false` en un dry run: la corrida devuelta es la que se habría registrado. */
  readonly persisted: boolean;
  readonly run: IngestionRun;
  /** `null` cuando la corrida terminó antes de resolver el sujeto. */
  readonly legalEntityId: string | null;
  readonly documents: readonly CompanyFactsDocument[];
  readonly wire: {
    readonly counts: SecCompanyFactsCounts;
    readonly filings: number;
    readonly filingRowRejections: number;
    readonly factRowRejections: number;
  } | null;
  /** Ventana de historia aplicada; `null` si la corrida no llegó a los hechos. */
  readonly window: {
    readonly window: SecHistoryWindow | null;
    readonly counts: SecHistoryWindowSelection["counts"];
  } | null;
  readonly vintages: SecFactVintagesCounts | null;
  readonly rejections: readonly SecFactRejection[];
  readonly stagingRejections: number;
  readonly sourceDocuments: SourceDocumentRecording | null;
  readonly publication: CompanyFactsPublicationSummary | null;
};

function toSourceDocument(
  draft: SecDocumentDraft,
  legalEntityId: string,
  ingestionRunId: string,
  recordedAt: string,
): SourceDocument {
  const content = {
    sourceId: SEC_SOURCE_ID,
    sourceDocumentId: draft.accessionNumber,
    documentType: draft.form,
    subjectType: "legal_entity" as const,
    subjectId: legalEntityId,
    publishedOn: draft.filingDate,
    acceptedAt: draft.acceptedAt,
    availableAt: draft.availableAt,
    availabilityRule: draft.availabilityRule,
    periodEndOn: draft.reportDate,
    fiscalYear: draft.fiscalYear,
    fiscalPeriod: draft.fiscalPeriod,
  };

  return sourceDocumentSchema.parse({
    ...content,
    contentHash: computeSourceDocumentContentHash(content),
    ingestionRunId,
    recordedAt,
  });
}

function countByCode(
  rejections: readonly { code: ObservationRejectionCode }[],
): Partial<Record<ObservationRejectionCode, number>> {
  const counts: Partial<Record<ObservationRejectionCode, number>> = {};

  for (const { code } of rejections) {
    counts[code] = (counts[code] ?? 0) + 1;
  }

  return counts;
}

export async function ingestCompanyFacts(
  command: IngestCompanyFactsCommand,
  dependencies: IngestCompanyFactsDependencies,
): Promise<IngestCompanyFactsOutcome> {
  const { cik, mode, dryRun } = ingestCompanyFactsCommandSchema.parse(command);
  const {
    sourceRegistry,
    ingestionRuns,
    sourceDocuments,
    observations,
    identity,
    source,
    now,
    newId,
  } = dependencies;

  const batchIdentity = {
    sourceId: SEC_SOURCE_ID,
    datasetId: COMPANY_FACTS_DATASET_ID,
    parserVersion: COMPANY_FACTS_PIPELINE.parserVersion,
  };
  const requestKey = {
    ...batchIdentity,
    requestedAsOf: null,
    requestedVintage: null,
    cursor: null,
    subjectKey: cik,
    selectionVersion: SEC_CONCEPT_SELECTION_VERSION,
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
    selectionAnchorOn?: string | null;
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
      selectionVersion: SEC_CONCEPT_SELECTION_VERSION,
      selectionAnchorOn: fields.selectionAnchorOn ?? null,
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

  const emptyHash = computeStagedBatchHash(batchIdentity, []);

  const blank = {
    documents: [],
    wire: null,
    window: null,
    vintages: null,
    rejections: [],
    stagingRejections: 0,
    sourceDocuments: null,
    publication: null,
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
      persisted: !dryRun,
      run: await failed(
        "source_not_registered",
        "La fuente solicitada no existe en el registro.",
      ),
      legalEntityId: null,
      ...blank,
    };
  }

  if (!entry.datasets.includes(COMPANY_FACTS_DATASET_ID)) {
    return {
      persisted: !dryRun,
      run: await failed(
        "dataset_not_registered",
        "El dataset solicitado no está declarado por la fuente.",
      ),
      legalEntityId: null,
      ...blank,
    };
  }

  const rights = evaluateIngestionRights(entry, RIGHTS_REQUEST);

  if (!rights.allowed) {
    return {
      persisted: !dryRun,
      run: await failed(
        "rights_not_approved",
        `Derechos sin aprobar: ${rights.blockedBy.join(", ")}`,
        { qualityFlags: ["rights_blocked"] },
      ),
      legalEntityId: null,
      ...blank,
    };
  }

  // 2. Sujeto, todavía sin red. Un CIK fuera del universo no es una corrida: es
  //    una solicitud equivocada, y no deja fila.
  const resolution = await identity.resolve(
    { identifierType: "cik", identifierValue: cik, scope: CIK_SCOPE },
    pointInTimeQuerySchema.parse({
      effectiveAt: startedAt,
      revisionPolicy: "as_known",
      knownAt: startedAt,
      knowledgeBasis: "public_availability",
      sourcePolicyVersion: "source-policy-1.0.0",
    }),
  );

  if (resolution.status !== "resolved" || resolution.legalEntityId === null) {
    throw new SubjectNotInUniverseError(cik, resolution.status);
  }

  const legalEntityId = resolution.legalEntityId;

  // 3. Descarga.
  let download;

  try {
    download = await source.load(cik);
  } catch (cause) {
    if (
      cause instanceof CompanyFactsSourceError &&
      (cause.code === "payload_schema_invalid" ||
        cause.code === "subject_mismatch")
    ) {
      // Un documento que no se entiende se cuarentena: no publica y no reemplaza
      // el último lote válido. El flag nombra qué documento y por qué.
      return {
        persisted: !dryRun,
        run: await record({
          status: "quarantined",
          counts: EMPTY_COUNTS,
          contentHash: emptyHash,
          failure: null,
          qualityFlags: [`${cause.document}_${cause.code}`],
        }),
        legalEntityId,
        ...blank,
      };
    }

    return {
      persisted: !dryRun,
      run: await failed("provider_error", cause, {
        retryable:
          cause instanceof CompanyFactsSourceError ? cause.retryable : false,
      }),
      legalEntityId,
      ...blank,
    };
  }

  if (download.status === "no_company_facts") {
    return {
      persisted: !dryRun,
      run: await record({
        status: "empty",
        counts: EMPTY_COUNTS,
        contentHash: emptyHash,
        failure: null,
        qualityFlags: ["no_company_facts"],
      }),
      legalEntityId,
      ...blank,
      documents: download.documents,
    };
  }

  // 4. Vintages y staging, sobre los hechos de la ventana. El ancla viaja en cada
  //    corrida que haya leído los hechos: sin ella, la versión de la selección no
  //    dice qué períodos se fueron a buscar.
  const selectionAnchorOn = download.window?.anchorOn ?? null;
  const vintages = buildSecFactVintages({
    cik,
    facts: download.facts,
    filings: download.filings,
    unreadableAccessions: new Set(
      download.filingRejections
        .map((rejection) => rejection.accessionNumber)
        .filter((accession): accession is string => accession !== null),
    ),
  });

  const accepted: StagedRecord[] = [];
  let stagingRejections = 0;

  for (const candidate of vintages.records) {
    const parsed = stagedRecordSchema.safeParse(candidate);

    if (parsed.success) {
      accepted.push(parsed.data);
    } else {
      stagingRejections += 1;
    }
  }

  const rejected = vintages.rejections.length + stagingRejections;
  const fetched = accepted.length + rejected;
  const wire = {
    counts: download.counts,
    filings: download.filings.length,
    filingRowRejections: download.filingRejections.length,
    factRowRejections: download.factRejections.length,
  };
  const partialOutcome = {
    legalEntityId,
    documents: download.documents,
    wire,
    window: { window: download.window, counts: download.windowCounts },
    vintages: vintages.counts,
    rejections: vintages.rejections,
    stagingRejections,
    sourceDocuments: null,
    publication: null,
  };

  if (fetched === 0) {
    return {
      persisted: !dryRun,
      run: await record({
        status: "empty",
        counts: EMPTY_COUNTS,
        contentHash: emptyHash,
        failure: null,
        qualityFlags: ["no_selected_facts"],
        selectionAnchorOn,
      }),
      ...partialOutcome,
    };
  }

  const contentHash = computeStagedBatchHash(batchIdentity, accepted);

  if (accepted.length === 0) {
    return {
      persisted: !dryRun,
      run: await record({
        status: "quarantined",
        counts: { fetched, accepted: 0, rejected, duplicate: 0 },
        contentHash,
        failure: null,
        qualityFlags: ["parser_broken"],
        selectionAnchorOn,
      }),
      ...partialOutcome,
    };
  }

  // La versión del documento es todo lo que la corrida decidió sobre él: el
  // ancla de la ventana, los registros aceptados, lo rechazado con su código y
  // las presentaciones. Dos descargas con esa misma versión son la misma corrida.
  const documentVersion = computeContentHash({
    selectionAnchorOn,
    records: contentHash,
    rejections: vintages.rejections
      .map((rejection) =>
        [
          rejection.concept,
          rejection.unit,
          rejection.accessionNumber,
          rejection.code,
        ].join("|"),
      )
      .sort(),
    stagingRejections,
    documents: vintages.documents,
  });
  const idempotencyKey = computeIdempotencyKey({
    ...requestKey,
    documentVersion,
  });
  const previous = await ingestionRuns.findByIdempotencyKey(idempotencyKey);
  const replayOf =
    previous !== null && isPublishableStatus(previous.status) ? previous : null;

  const run = await record(
    replayOf === null
      ? {
          status: rejected > 0 ? "partial" : "succeeded",
          counts: {
            fetched,
            accepted: accepted.length,
            rejected,
            duplicate: 0,
          },
          contentHash,
          failure: null,
          qualityFlags: rejected > 0 ? ["partial_batch"] : [],
          idempotencyKey,
          selectionAnchorOn,
        }
      : {
          // Mismo contenido que una corrida ya publicada: se registra que se
          // volvió a mirar, y no se publica una corrida nueva.
          status: "duplicate",
          counts: { fetched, accepted: 0, rejected: 0, duplicate: fetched },
          contentHash,
          failure: null,
          qualityFlags: ["duplicate_content"],
          replayOfRunId: replayOf.runId,
          idempotencyKey,
          selectionAnchorOn,
        },
  );

  if (dryRun) {
    return { ...partialOutcome, persisted: false, run };
  }

  // La corrida que publica es la publicable: la nueva o, ante un duplicado, la
  // original. Volver a publicar bajo la original sólo inserta lo que falte —la
  // publicación es idempotente por content hash—, y así una publicación que se
  // cortó después de registrar su corrida se completa en vez de quedar coja.
  const publishingRun = replayOf ?? run;
  const recordedAt = now();

  const documents = await sourceDocuments.record(
    vintages.documents.map((draft) =>
      toSourceDocument(draft, legalEntityId, publishingRun.runId, recordedAt),
    ),
  );

  const publication = await publishObservations(
    publishingRun,
    accepted,
    {
      subjectType: "legal_entity",
      fetchedAt: download.fetchedAt,
      mode,
      documentSubject: {
        identifierType: "cik",
        identifierValue: cik,
        scope: CIK_SCOPE,
        resolvedAt: download.fetchedAt,
      },
    },
    {
      identity,
      observations,
      now,
      newObservationId: newId,
    },
  );

  return {
    ...partialOutcome,
    persisted: true,
    run,
    sourceDocuments: documents,
    publication: {
      published: publication.published.length,
      restated: publication.restated.length,
      duplicates: publication.duplicates.length,
      rejections: countByCode(publication.rejections),
    },
  };
}
