import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import type { IdentityResolver } from "@/modules/identity/application/identity-resolver";
import { normalizeIdentifierValue } from "@/modules/identity/domain/identity-graph";
import type { IdentityResolution } from "@/modules/identity/domain/resolve-identity";
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
  observationSchema,
  observationSubjectTypeSchema,
  withIngestionFlags,
  type Observation,
  type ObservationLogicalKey,
} from "../domain/observation";
import {
  createObservationCacheIdentity,
  MAX_REVISION_GROUPS_PER_LOOKUP,
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
export class PublicationNotAllowedError extends Error {
  constructor(status: string) {
    super(
      `An ingestion run with status ${status} cannot publish observations.`,
    );
    this.name = "PublicationNotAllowedError";
  }
}

/**
 * Sujeto de un documento que describe a una sola empresa, nombrado por un
 * identificador que la fuente no reasigna (un CIK).
 *
 * Se resuelve **una vez**, con el corte de la descarga, y no con el de cada
 * hecho. La diferencia importa: el grafo de identidad sólo conoce a la empresa
 * desde que se constituyó el universo, así que resolver al 2009 un hecho
 * publicado en 2009 no encontraría a nadie y rechazaría toda la historia. Hacerlo
 * al corte de la descarga no filtra conocimiento hacia atrás: el hecho sigue
 * siendo conocible desde su `available_at`, y lo único que se decide con el
 * grafo de hoy es a qué ID interno pertenece un CIK que la SEC nunca reutiliza.
 * Un ticker, que sí se reasigna, no puede usar esta vía.
 */
export const documentSubjectSchema = z.object({
  identifierType: z.string().trim().min(2).max(64),
  identifierValue: z.string().trim().min(1).max(128),
  scope: z.string().trim().min(1).max(256),
  /** Corte de la resolución: el instante de la descarga del documento. */
  resolvedAt: z.iso.datetime({ offset: true }),
});

export type DocumentSubject = z.infer<typeof documentSubjectSchema>;

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
  /**
   * Modo efectivo: forma parte de la identidad de cache invalidada. Sólo
   * `personal` publica, así que no lleva default: quien publica declara bajo
   * qué runtime lo hace en vez de heredarlo.
   */
  mode: z.literal("personal"),
  /**
   * `null` resuelve cada registro por su `subjectKey` al corte del propio
   * registro, que es lo correcto para una clave de proveedor con vigencia.
   */
  documentSubject: documentSubjectSchema.nullable().default(null),
});

export type PublishObservationsCommand = z.input<
  typeof publishObservationsCommandSchema
>;

export type ObservationRejectionCode =
  | "identity_not_found"
  | "identity_ambiguous"
  | "identity_conflict"
  | "ambiguous_revision"
  /** El registro nombra a otro sujeto que el documento que lo trajo. */
  | "subject_mismatch";

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

function subjectIdOf(
  resolution: IdentityResolution,
  subjectType: Observation["subjectType"],
): string | null {
  return subjectType === "legal_entity"
    ? resolution.legalEntityId
    : subjectType === "security"
      ? resolution.securityId
      : resolution.listingId;
}

type SubjectDecision =
  | { readonly ok: true; readonly subjectId: string }
  | {
      readonly ok: false;
      readonly code: ObservationRejectionCode;
      readonly candidateIds: readonly string[];
    };

function decide(
  resolution: IdentityResolution,
  subjectType: Observation["subjectType"],
): SubjectDecision {
  const subjectId = subjectIdOf(resolution, subjectType);

  if (resolution.status !== "resolved" || subjectId === null) {
    return {
      ok: false,
      code:
        resolution.status === "resolved"
          ? "identity_not_found"
          : rejectionFor(resolution.status),
      candidateIds: resolution.candidateIds,
    };
  }

  return { ok: true, subjectId };
}

/**
 * Orden de publicación: por disponibilidad y después por `externalId`. Dentro de
 * una misma cadena, cada revisión tiene que llegar después de la anterior; un
 * lote que trae dos vintages del mismo hecho no puede depender de que el
 * adaptador los haya emitido en orden.
 */
function byAvailability(left: StagedRecord, right: StagedRecord): number {
  const delta = Date.parse(left.availableAt) - Date.parse(right.availableAt);

  if (delta !== 0) {
    return delta;
  }

  return left.externalId < right.externalId
    ? -1
    : left.externalId > right.externalId
      ? 1
      : 0;
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
  const { documentSubject, subjectType } = parsedCommand;

  const published: Observation[] = [];
  const duplicates: string[] = [];
  const restated: string[] = [];
  const rejections: ObservationRejection[] = [];
  const supersessions: ObservationSupersession[] = [];
  const invalidations = new Map<
    string,
    readonly [string, AppMode, string, string]
  >();

  let documentDecision: SubjectDecision | null = null;
  let documentKey: string | null = null;

  if (documentSubject !== null) {
    documentKey = normalizeIdentifierValue(
      documentSubject.identifierType,
      documentSubject.identifierValue,
    );
    documentDecision = decide(
      await identity.resolve(
        {
          identifierType: documentSubject.identifierType,
          identifierValue: documentSubject.identifierValue,
          scope: documentSubject.scope,
        },
        pointInTimeQuerySchema.parse({
          effectiveAt: documentSubject.resolvedAt,
          revisionPolicy: "as_known",
          knownAt: documentSubject.resolvedAt,
          knowledgeBasis: "public_availability",
          sourcePolicyVersion: parsedCommand.sourcePolicyVersion,
        }),
      ),
      subjectType,
    );
  }

  type Candidate = {
    record: StagedRecord;
    logicalKey: ObservationLogicalKey;
    revisionGroupId: string;
  };

  const candidates: Candidate[] = [];

  for (const record of [...records].sort(byAvailability)) {
    let decision: SubjectDecision;

    if (documentDecision !== null && documentSubject !== null) {
      if (
        normalizeIdentifierValue(
          documentSubject.identifierType,
          record.subjectKey,
        ) !== documentKey
      ) {
        rejections.push({
          externalId: record.externalId,
          code: "subject_mismatch",
          candidateIds: [],
        });
        continue;
      }

      decision = documentDecision;
    } else {
      // La identidad se resuelve tal como se conocía cuando el hecho se hizo
      // público: un cambio de ticker posterior no reescribe el sujeto histórico.
      decision = decide(
        await identity.resolve(
          subjectLookup(record, run.sourceId),
          pointInTimeQuerySchema.parse({
            effectiveAt: `${record.asOf}T00:00:00.000Z`,
            revisionPolicy: "as_known",
            knownAt: record.availableAt,
            knowledgeBasis: "public_availability",
            sourcePolicyVersion: parsedCommand.sourcePolicyVersion,
          }),
        ),
        subjectType,
      );
    }

    if (!decision.ok) {
      rejections.push({
        externalId: record.externalId,
        code: decision.code,
        candidateIds: decision.candidateIds,
      });
      continue;
    }

    const logicalKey: ObservationLogicalKey = {
      subjectType,
      subjectId: decision.subjectId,
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

    candidates.push({
      record,
      logicalKey,
      revisionGroupId: computeRevisionGroupId(logicalKey),
    });
  }

  // Cadenas persistidas, leídas en lotes acotados en vez de una consulta por
  // registro: la punta decide la revisión siguiente y los hashes de toda la
  // cadena deciden qué ya se publicó.
  const latestByGroup = new Map<string, Observation>();
  const hashesByGroup = new Map<string, Set<string>>();
  const groupIds = [
    ...new Set(candidates.map((candidate) => candidate.revisionGroupId)),
  ];

  for (
    let offset = 0;
    offset < groupIds.length;
    offset += MAX_REVISION_GROUPS_PER_LOOKUP
  ) {
    const found = await observations.listRevisionGroups(
      groupIds.slice(offset, offset + MAX_REVISION_GROUPS_PER_LOOKUP),
    );

    for (const observation of found) {
      const latest = latestByGroup.get(observation.revisionGroupId);

      if (
        latest === undefined ||
        observation.revisionNumber > latest.revisionNumber
      ) {
        latestByGroup.set(observation.revisionGroupId, observation);
      }

      const hashes = hashesByGroup.get(observation.revisionGroupId);
      if (hashes === undefined) {
        hashesByGroup.set(
          observation.revisionGroupId,
          new Set([observation.contentHash]),
        );
      } else {
        hashes.add(observation.contentHash);
      }
    }
  }

  /** Posición en `published` de las revisiones creadas en este mismo lote. */
  const publishedIndex = new Map<string, number>();

  for (const { record, logicalKey, revisionGroupId } of candidates) {
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

    // Ingesta tardía: `public_availability` y `system_recorded` divergen y la
    // consulta debe poder distinguirlas.
    const qualityFlags = withIngestionFlags(
      record.qualityFlags,
      record.availableAt,
      recordedAt,
    );

    const previous = latestByGroup.get(revisionGroupId) ?? null;

    if (hashesByGroup.get(revisionGroupId)?.has(contentHash) === true) {
      // Idempotencia: el mismo hecho con el mismo contenido no crea revisión,
      // sea la punta de la cadena o una revisión que otra ya re-expresó.
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
      ingestionRunId: run.runId,
    });

    if (previous !== null) {
      const inBatch = publishedIndex.get(revisionGroupId);

      if (inBatch === undefined) {
        supersessions.push({
          observationId: previous.observationId,
          supersededAt: record.availableAt,
        });
      } else {
        // La revisión anterior todavía no está persistida: se cierra antes de
        // insertarla, porque una supersesión sobre una fila inexistente no
        // haría nada y dejaría dos revisiones vigentes en el mismo commit.
        published[inBatch] = observationSchema.parse({
          ...previous,
          supersededAt: record.availableAt,
        });
      }

      restated.push(record.externalId);
    }

    publishedIndex.set(revisionGroupId, published.length);
    published.push(observation);
    latestByGroup.set(revisionGroupId, observation);
    hashesByGroup.set(
      revisionGroupId,
      new Set([...(hashesByGroup.get(revisionGroupId) ?? []), contentHash]),
    );

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
