import { z } from "zod";

import {
  datasetFetchResponseSchema,
  MAX_RECORDS_PER_FETCH,
  type DatasetProvider,
} from "@/modules/ingestion/application/dataset-provider";
import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import {
  toSafeIngestionFailure,
  type IngestionFailure,
  type IngestionFailureCode,
} from "@/modules/ingestion/domain/ingestion-failure";
import {
  computeIdempotencyKey,
  EMPTY_COUNTS,
  ingestionRunSchema,
  isPublishableStatus,
  isTerminalStatus,
  type IngestionRun,
  type IngestionRunCounts,
  type IngestionRunStatus,
} from "@/modules/ingestion/domain/ingestion-run";
import {
  datasetIdSchema,
  evaluateIngestionRights,
  ingestionRightsRequestSchema,
  parserVersionSchema,
  sourceIdSchema,
} from "@/modules/ingestion/domain/source-registry-entry";
import {
  computeStagedBatchHash,
  stagedRecordSchema,
  type StagedRecord,
} from "@/modules/ingestion/domain/staged-record";

export const executeIngestionRunCommandSchema = z.object({
  sourceId: sourceIdSchema,
  datasetId: datasetIdSchema,
  parserVersion: parserVersionSchema,
  requestedAsOf: z.iso.date().nullable().default(null),
  /** Publicación de la fuente que se va a buscar; `null` es "la vigente". */
  requestedVintage: z.iso.date().nullable().default(null),
  cursor: z.string().trim().min(1).max(512).nullable().default(null),
  maxRecords: z
    .number()
    .int()
    .min(1)
    .max(MAX_RECORDS_PER_FETCH)
    .default(MAX_RECORDS_PER_FETCH),
  rights: ingestionRightsRequestSchema.default({
    storesRawPayload: true,
    storesNormalizedValues: true,
    publicDisplay: false,
  }),
});

export type ExecuteIngestionRunCommand = z.input<
  typeof executeIngestionRunCommandSchema
>;

export type IngestionRejection = {
  index: number;
  code: "schema_invalid" | "duplicate_external_id";
  /** Sólo rutas de campo: nunca el valor recibido (`TM-02`). */
  fields: string[];
};

export type IngestionRunOutcome = {
  run: IngestionRun;
  /** Vacío salvo que la corrida sea publicable. */
  records: readonly StagedRecord[];
  rejections: readonly IngestionRejection[];
  publishable: boolean;
  providerCalled: boolean;
  replayedFrom: string | null;
  /**
   * Instante de descarga informado por el adaptador. Viaja hasta la observación
   * publicada porque `fetched_at` es parte de la provenance, no un detalle de la
   * corrida.
   */
  fetchedAt: string | null;
};

export type ExecuteIngestionRunDependencies = {
  sourceRegistry: SourceRegistryRepository;
  ingestionRuns: IngestionRunRepository;
  provider: DatasetProvider;
  /** Reloj inyectado: el dominio no lee `Date.now()`. */
  now: () => string;
  newRunId: () => string;
};

type RunDraft = {
  runId: string;
  sourceId: string;
  datasetId: string;
  parserVersion: string;
  idempotencyKey: string;
  requestedAsOf: string | null;
  requestedVintage: string | null;
  cursor: string | null;
  startedAt: string;
};

function buildRun(
  draft: RunDraft,
  now: string,
  fields: {
    status: IngestionRunStatus;
    counts: IngestionRunCounts;
    contentHash: string | null;
    failure: IngestionFailure | null;
    nextCursor: string | null;
    qualityFlags: string[];
    replayOfRunId: string | null;
  },
): IngestionRun {
  return ingestionRunSchema.parse({
    ...draft,
    finishedAt: isTerminalStatus(fields.status) ? now : null,
    recordedAt: now,
    ...fields,
  });
}

/**
 * Orquesta una corrida de ingesta contra el gate de derechos, el provider y el
 * staging schema. Ninguna ruta llama al provider antes de resolver derechos y
 * ninguna corrida no publicable devuelve registros.
 */
export async function executeIngestionRun(
  command: ExecuteIngestionRunCommand,
  dependencies: ExecuteIngestionRunDependencies,
): Promise<IngestionRunOutcome> {
  const parsedCommand = executeIngestionRunCommandSchema.parse(command);
  const { sourceRegistry, ingestionRuns, provider, now, newRunId } =
    dependencies;

  const idempotencyKey = computeIdempotencyKey({
    sourceId: parsedCommand.sourceId,
    datasetId: parsedCommand.datasetId,
    parserVersion: parsedCommand.parserVersion,
    requestedAsOf: parsedCommand.requestedAsOf,
    requestedVintage: parsedCommand.requestedVintage,
    cursor: parsedCommand.cursor,
  });

  const previousRun = await ingestionRuns.findByIdempotencyKey(idempotencyKey);
  if (previousRun && isPublishableStatus(previousRun.status)) {
    // Replay exacto: la misma solicitud ya produjo este lote, así que no se
    // contacta la fuente ni se agrega una corrida nueva. Una corrida fallida,
    // vacía o en cuarentena sí es reintentable: no publicó nada.
    return {
      run: previousRun,
      records: [],
      rejections: [],
      publishable: false,
      providerCalled: false,
      replayedFrom: previousRun.runId,
      fetchedAt: null,
    };
  }

  const startedAt = now();
  const draft: RunDraft = {
    runId: newRunId(),
    sourceId: parsedCommand.sourceId,
    datasetId: parsedCommand.datasetId,
    parserVersion: parsedCommand.parserVersion,
    idempotencyKey,
    requestedAsOf: parsedCommand.requestedAsOf,
    requestedVintage: parsedCommand.requestedVintage,
    cursor: parsedCommand.cursor,
    startedAt,
  };

  const fail = async (
    code: IngestionFailureCode,
    cause: unknown,
    qualityFlags: string[] = [],
  ): Promise<IngestionRunOutcome> => {
    const run = buildRun(draft, now(), {
      status: "failed",
      counts: EMPTY_COUNTS,
      contentHash: null,
      failure: toSafeIngestionFailure(code, cause),
      nextCursor: null,
      qualityFlags,
      replayOfRunId: null,
    });

    return {
      run: await ingestionRuns.append(run),
      records: [],
      rejections: [],
      publishable: false,
      providerCalled: false,
      replayedFrom: null,
      fetchedAt: null,
    };
  };

  const entry = await sourceRegistry.findBySourceId(parsedCommand.sourceId);
  if (!entry) {
    return fail(
      "source_not_registered",
      "La fuente solicitada no existe en el registro.",
    );
  }

  if (!entry.datasets.includes(parsedCommand.datasetId)) {
    return fail(
      "dataset_not_registered",
      "El dataset solicitado no está declarado por la fuente.",
    );
  }

  const rights = evaluateIngestionRights(entry, parsedCommand.rights);
  if (!rights.allowed) {
    // Fail-closed antes de cualquier egress: `TM-15`.
    return fail(
      "rights_not_approved",
      `Derechos sin aprobar: ${rights.blockedBy.join(", ")}`,
      ["rights_blocked"],
    );
  }

  let rawResponse: unknown;
  try {
    rawResponse = await provider.fetchDataset({
      sourceId: parsedCommand.sourceId,
      datasetId: parsedCommand.datasetId,
      parserVersion: parsedCommand.parserVersion,
      requestedAsOf: parsedCommand.requestedAsOf,
      cursor: parsedCommand.cursor,
      maxRecords: parsedCommand.maxRecords,
    });
  } catch (cause) {
    const outcome = await fail("provider_error", cause);
    return { ...outcome, providerCalled: true };
  }

  const parsedResponse = datasetFetchResponseSchema.safeParse(rawResponse);
  if (!parsedResponse.success) {
    const outcome = await fail(
      "provider_contract_invalid",
      "La respuesta del proveedor no cumple el contrato del adaptador.",
    );
    return { ...outcome, providerCalled: true };
  }

  const response = parsedResponse.data;
  const identity = {
    sourceId: parsedCommand.sourceId,
    datasetId: parsedCommand.datasetId,
    parserVersion: parsedCommand.parserVersion,
  };

  const finish = async (
    fields: Parameters<typeof buildRun>[2],
    records: readonly StagedRecord[],
    rejections: readonly IngestionRejection[],
    replayedFrom: string | null,
  ): Promise<IngestionRunOutcome> => {
    const run = buildRun(draft, now(), fields);
    const publishable = isPublishableStatus(run.status);

    return {
      run: await ingestionRuns.append(run),
      records: publishable ? records : [],
      rejections,
      publishable,
      providerCalled: true,
      replayedFrom,
      fetchedAt: response.fetchedAt,
    };
  };

  if (response.records.length === 0) {
    // Una respuesta vacía no es un fallo, pero tampoco cierra el último
    // intervalo válido ni publica nada.
    return finish(
      {
        status: "empty",
        counts: EMPTY_COUNTS,
        contentHash: computeStagedBatchHash(identity, []),
        failure: null,
        nextCursor: response.nextCursor,
        qualityFlags: ["empty_response"],
        replayOfRunId: null,
      },
      [],
      [],
      null,
    );
  }

  const accepted: StagedRecord[] = [];
  const rejections: IngestionRejection[] = [];
  const seenExternalIds = new Set<string>();

  response.records.forEach((rawRecord, index) => {
    const parsedRecord = stagedRecordSchema.safeParse(rawRecord);

    if (!parsedRecord.success) {
      rejections.push({
        index,
        code: "schema_invalid",
        fields: [
          ...new Set(
            parsedRecord.error.issues.map((issue) =>
              issue.path.length > 0 ? issue.path.join(".") : "$",
            ),
          ),
        ],
      });
      return;
    }

    if (seenExternalIds.has(parsedRecord.data.externalId)) {
      rejections.push({
        index,
        code: "duplicate_external_id",
        fields: ["externalId"],
      });
      return;
    }

    seenExternalIds.add(parsedRecord.data.externalId);
    accepted.push(parsedRecord.data);
  });

  const fetched = response.records.length;
  const contentHash = computeStagedBatchHash(identity, accepted);

  if (accepted.length === 0) {
    // Parser roto o lote íntegramente inválido: se cuarentena, no se publica y
    // no se reemplaza el snapshot anterior por vacío (`TM-05`).
    return finish(
      {
        status: "quarantined",
        counts: { fetched, accepted: 0, rejected: fetched, duplicate: 0 },
        contentHash,
        failure: null,
        nextCursor: response.nextCursor,
        qualityFlags: ["parser_broken"],
        replayOfRunId: null,
      },
      [],
      rejections,
      null,
    );
  }

  const latestPublishable = await ingestionRuns.findLatestPublishable(
    parsedCommand.sourceId,
    parsedCommand.datasetId,
  );

  // La dedupe por content hash sólo aplica a un lote íntegro: con rechazos, el
  // detalle de la corrida sigue siendo información nueva que vale registrar.
  if (
    rejections.length === 0 &&
    latestPublishable?.contentHash === contentHash
  ) {
    return finish(
      {
        status: "duplicate",
        counts: { fetched, accepted: 0, rejected: 0, duplicate: fetched },
        contentHash,
        failure: null,
        nextCursor: response.nextCursor,
        qualityFlags: ["duplicate_content"],
        replayOfRunId: latestPublishable.runId,
      },
      [],
      [],
      latestPublishable.runId,
    );
  }

  return finish(
    {
      status: rejections.length > 0 ? "partial" : "succeeded",
      counts: {
        fetched,
        accepted: accepted.length,
        rejected: rejections.length,
        duplicate: 0,
      },
      contentHash,
      failure: null,
      nextCursor: response.nextCursor,
      qualityFlags: rejections.length > 0 ? ["partial_batch"] : [],
      replayOfRunId: null,
    },
    accepted,
    rejections,
    null,
  );
}
