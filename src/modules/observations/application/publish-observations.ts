import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import type { IdentityResolver } from "@/modules/identity/application/identity-resolver";
import {
  isPublishableStatus,
  type IngestionRun,
} from "@/modules/ingestion/domain/ingestion-run";
import type { StagedRecord } from "@/modules/ingestion/domain/staged-record";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";

import {
  computeObservationContentHash,
  computeRevisionGroupId,
  LATE_INGESTION_FLAG,
  observationSchema,
  observationSubjectTypeSchema,
  type Observation,
  type ObservationLogicalKey,
} from "../domain/observation";
import {
  createObservationCacheIdentity,
  type ObservationRepository,
  type ObservationSupersession,
} from "./observation-repository";

/**
 * Publicación de observaciones: los pasos 5 a 7 del ciclo de ingesta descrito en
 * `docs/data/point-in-time-contract.md`. Resuelve identidad interna, arma la
 * cadena de revisión, asigna `recorded_at` en el commit y devuelve las
 * identidades de cache a invalidar recién después de publicar.
 *
 * Ninguna corrida no publicable llega hasta acá: una respuesta vacía, un parser
 * roto o una fuente caída no reemplazan el último valor válido (`TM-05`).
 */
/** Más de un día entre publicación y registro local ya es una ingesta tardía. */
const LATE_INGESTION_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export class PublicationNotAllowedError extends Error {
  constructor(status: string) {
    super(
      `An ingestion run with status ${status} cannot publish observations.`,
    );
    this.name = "PublicationNotAllowedError";
  }
}

export const publishObservationsCommandSchema = z.object({
  /** Sujeto interno al que la fuente atribuye sus registros. */
  subjectType: observationSubjectTypeSchema.default("legal_entity"),
  /** Instante de descarga informado por el adaptador. */
  fetchedAt: z.iso.datetime({ offset: true }),
  sourcePolicyVersion: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .default(DEFAULT_SOURCE_POLICY_VERSION),
  /** Modo efectivo: forma parte de la identidad de cache invalidada. */
  mode: z.enum(["demo", "personal"]).default("demo"),
});

export type PublishObservationsCommand = z.input<
  typeof publishObservationsCommandSchema
>;

export type ObservationRejectionCode =
  | "identity_not_found"
  | "identity_ambiguous"
  | "identity_conflict"
  | "ambiguous_revision";

export type ObservationRejection = {
  externalId: string;
  code: ObservationRejectionCode;
  /** Sólo identificadores internos y candidatos: nunca el valor (`TM-02`). */
  candidateIds: readonly string[];
};

export type PublishObservationsOutcome = {
  published: readonly Observation[];
  /** Contenido idéntico al ya publicado: no crea revisión ni sobreescribe. */
  duplicates: readonly string[];
  restated: readonly string[];
  rejections: readonly ObservationRejection[];
  supersessions: readonly ObservationSupersession[];
  /**
   * Lecturas derivadas a invalidar. Se emiten después del commit y quedan a
   * cargo del llamador: ninguna superficie las lee todavía (`F1-06`).
   */
  invalidations: readonly (readonly [string, AppMode, string, string])[];
};

export type PublishObservationsDependencies = {
  identity: IdentityResolver;
  observations: ObservationRepository;
  /** Reloj inyectado: `recorded_at` no lo decide el dominio. */
  now: () => string;
  newObservationId: () => string;
};

function rejectionFor(
  status: "not_found" | "ambiguous" | "conflict",
): ObservationRejectionCode {
  return status === "ambiguous"
    ? "identity_ambiguous"
    : status === "conflict"
      ? "identity_conflict"
      : "identity_not_found";
}

/**
 * Convención de sujeto de la fuente sintética: la clave que el proveedor usa
 * para nombrar a la empresa es un identificador con scope propio, no un ticker
 * ni una foreign key.
 */
function subjectLookup(record: StagedRecord, sourceId: string) {
  return {
    identifierType: "vendor_subject_key",
    identifierValue: record.subjectKey,
    scope: `source:${sourceId}`,
  };
}

export async function publishObservations(
  run: IngestionRun,
  records: readonly StagedRecord[],
  command: PublishObservationsCommand,
  dependencies: PublishObservationsDependencies,
): Promise<PublishObservationsOutcome> {
  if (!isPublishableStatus(run.status)) {
    throw new PublicationNotAllowedError(run.status);
  }

  const parsedCommand = publishObservationsCommandSchema.parse(command);
  const { identity, observations, now, newObservationId } = dependencies;

  const published: Observation[] = [];
  const duplicates: string[] = [];
  const restated: string[] = [];
  const rejections: ObservationRejection[] = [];
  const supersessions: ObservationSupersession[] = [];
  const invalidations = new Map<
    string,
    readonly [string, AppMode, string, string]
  >();

  for (const record of records) {
    // La identidad se resuelve tal como se conocía cuando el hecho se hizo
    // público: un cambio de ticker posterior no reescribe el sujeto histórico.
    const resolution = await identity.resolve(
      subjectLookup(record, run.sourceId),
      pointInTimeQuerySchema.parse({
        effectiveAt: `${record.asOf}T00:00:00.000Z`,
        revisionPolicy: "as_known",
        knownAt: record.availableAt,
        knowledgeBasis: "public_availability",
        sourcePolicyVersion: parsedCommand.sourcePolicyVersion,
      }),
    );

    const subjectId =
      parsedCommand.subjectType === "legal_entity"
        ? resolution.legalEntityId
        : parsedCommand.subjectType === "security"
          ? resolution.securityId
          : resolution.listingId;

    if (resolution.status !== "resolved" || subjectId === null) {
      rejections.push({
        externalId: record.externalId,
        code:
          resolution.status === "resolved"
            ? "identity_not_found"
            : rejectionFor(resolution.status),
        candidateIds: resolution.candidateIds,
      });
      continue;
    }

    const logicalKey: ObservationLogicalKey = {
      subjectType: parsedCommand.subjectType,
      subjectId,
      metricId: record.metricId,
      concept: record.concept,
      asOf: record.asOf,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      periodType: record.periodType,
      unit: record.unit,
      currency: record.currency,
      sourceId: run.sourceId,
      datasetId: run.datasetId,
      valueBasis: "reported",
    };

    const revisionGroupId = computeRevisionGroupId(logicalKey);
    const recordedAt = now();

    // El hash cubre el contenido y la provenance de la fuente. Los flags
    // derivados de la ingesta local se guardan en la fila pero quedan fuera del
    // hash: no describen el hecho publicado y harían que el mismo contenido
    // pareciera una revisión sólo por haberse ingerido más tarde.
    const contentHash = computeObservationContentHash({
      logicalKey,
      parserVersion: run.parserVersion,
      rawValue: record.rawValue,
      rawValueStatus: record.rawValueStatus,
      normalizedValue: null,
      availableAt: record.availableAt,
      sourceDocumentId: record.sourceDocumentId,
      externalId: record.externalId,
      qualityFlags: record.qualityFlags,
    });

    const qualityFlags = [...record.qualityFlags];

    if (
      Date.parse(recordedAt) - Date.parse(record.availableAt) >
      LATE_INGESTION_THRESHOLD_MS
    ) {
      // Ingesta tardía: `public_availability` y `system_recorded` divergen y la
      // consulta debe poder distinguirlas.
      qualityFlags.push(LATE_INGESTION_FLAG);
    }

    const previous = await observations.findLatestRevision(revisionGroupId);

    if (previous !== null && previous.contentHash === contentHash) {
      // Idempotencia: el mismo hecho con el mismo contenido no crea revisión.
      duplicates.push(record.externalId);
      continue;
    }

    if (
      previous !== null &&
      Date.parse(record.availableAt) <= Date.parse(previous.availableAt)
    ) {
      // Una revisión nueva que dice ser conocible antes que la anterior no
      // tiene desempate defendible.
      rejections.push({
        externalId: record.externalId,
        code: "ambiguous_revision",
        candidateIds: [previous.observationId],
      });
      continue;
    }

    const observation = observationSchema.parse({
      observationId: newObservationId(),
      ...logicalKey,
      parserVersion: run.parserVersion,
      rawValue: record.rawValue,
      rawValueStatus: record.rawValueStatus,
      normalizedValue: null,
      transformationId: null,
      availableAt: record.availableAt,
      supersededAt: null,
      fetchedAt: parsedCommand.fetchedAt,
      recordedAt,
      revisionGroupId,
      revisionNumber: previous === null ? 1 : previous.revisionNumber + 1,
      restatementOfId: previous?.observationId ?? null,
      contentHash,
      qualityFlags,
      sourceDocumentId: record.sourceDocumentId,
      externalId: record.externalId,
      ingestionRunId: run.runId,
    });

    if (previous !== null) {
      supersessions.push({
        observationId: previous.observationId,
        supersededAt: record.availableAt,
      });
      restated.push(record.externalId);
    }

    published.push(observation);

    const identityKey = createObservationCacheIdentity(
      parsedCommand.mode,
      observation.subjectType,
      observation.subjectId,
    );
    invalidations.set(identityKey.join("|"), identityKey);
  }

  if (published.length > 0) {
    // Commit único: supersesiones y revisiones nuevas o nada.
    await observations.publish({
      ingestionRunId: run.runId,
      observations: published,
      supersessions,
    });
  }

  return {
    published,
    duplicates,
    restated,
    rejections,
    supersessions,
    invalidations: [...invalidations.values()],
  };
}
