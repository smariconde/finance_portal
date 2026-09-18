import { z } from "zod";

import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import type {
  RefreshState,
  RefreshStateStore,
} from "@/modules/ingestion/application/refresh-state-store";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  ingestionFailureSchema,
  toSafeIngestionFailure,
  type IngestionFailureCode,
} from "@/modules/ingestion/domain/ingestion-failure";
import {
  computeIdempotencyKey,
  EMPTY_COUNTS,
  ingestionRunSchema,
  isPublishableStatus,
  type IngestionRun,
  type IngestionRunStatus,
} from "@/modules/ingestion/domain/ingestion-run";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";

import {
  decideFilerRefresh,
  SEC_REFRESH_PROBE_VERSION,
  type FilerRefreshDecision,
  type FilerRefreshWatermark,
} from "../domain/sec-refresh-decision";
import {
  CompanyFactsSourceError,
  type CompanyFactsProbeSource,
} from "./company-facts-source";
import {
  COMPANY_FACTS_DATASET_ID,
  type IngestCompanyFactsOutcome,
} from "./ingest-company-facts";
import { SEC_SOURCE_ID } from "./live-company-facts-source";

/**
 * Refresh de un filer (ADR 0021, incremento 4 de `F2-05`).
 *
 * El orden es el mismo que el de la ingesta y tampoco se negocia:
 *
 * 1. **registro y derechos**, sin red: una fuente no aprobada no sondea nada
 *    (`TM-15`);
 * 2. **sondeo**: un request al índice de presentaciones;
 * 3. **decisión** contra la marca de agua guardada;
 * 4. **corrida del sondeo**, siempre, porque toda vuelta tiene que poder
 *    explicarse desde la base (`TM-16`);
 * 5. **companyfacts**, sólo si hay algo nuevo;
 * 6. **marca**, al final.
 *
 * El paso 6 va último a propósito: si algo se corta en el medio la marca queda
 * atrás y la vuelta siguiente vuelve a bajar —que deduplica por contenido— pero
 * nunca queda adelante de un refresh que no ocurrió.
 *
 * El dataset del sondeo es `sec.submissions`, que es lo que se descarga; el de
 * la marca es `sec.companyfacts`, que es lo que se mantiene fresco. Son
 * distintos y no se mezclan.
 */
export const REFRESH_PROBE_DATASET_ID = "sec.submissions";

const RIGHTS_REQUEST = {
  storesRawPayload: false,
  storesNormalizedValues: true,
  publicDisplay: false,
} as const;

export const refreshCompanyFactsCommandSchema = z.object({
  cik: z
    .string()
    .trim()
    .regex(/^[0-9]{1,10}$/u)
    .refine((value) => Number(value) > 0)
    .transform((value) => value.padStart(10, "0")),
  mode: z.literal("personal"),
  /** Sondea igual —cuesta un request— pero no registra nada. */
  dryRun: z.boolean().default(false),
});

export type RefreshCompanyFactsCommand = z.input<
  typeof refreshCompanyFactsCommandSchema
>;

export type RefreshCompanyFactsDependencies = {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly ingestionRuns: IngestionRunRepository;
  readonly refreshState: RefreshStateStore;
  readonly probeSource: CompanyFactsProbeSource;
  /**
   * Qué hacer cuando hay algo nuevo. Se inyecta en vez de construir la ingesta
   * acá: el refresh decide **si** bajar, no cómo se baja.
   */
  readonly ingest: (cik: string) => Promise<IngestCompanyFactsOutcome>;
  readonly now: () => string;
  readonly newId: () => string;
};

export type RefreshCompanyFactsOutcome = {
  readonly persisted: boolean;
  readonly cik: string;
  /** Corrida del sondeo: existe en toda vuelta, haya cambiado algo o no. */
  readonly probeRun: IngestionRun;
  /** `null` si el sondeo no llegó a decidir. */
  readonly decision: FilerRefreshDecision | null;
  /** Marca que había antes de esta vuelta. */
  readonly previous: FilerRefreshWatermark | null;
  /** Marca que quedó; `null` en dry run o si la vuelta no la tocó. */
  readonly state: RefreshState | null;
  /** Corrida de companyfacts, si el refresh la hizo. */
  readonly ingestion: IngestCompanyFactsOutcome | null;
};

/** Una ingesta que terminó sin publicar igual dejó al filer al día. */
function refreshed(status: IngestionRunStatus): boolean {
  return (
    isPublishableStatus(status) || status === "duplicate" || status === "empty"
  );
}

export async function refreshCompanyFacts(
  command: RefreshCompanyFactsCommand,
  dependencies: RefreshCompanyFactsDependencies,
): Promise<RefreshCompanyFactsOutcome> {
  const { cik, dryRun } = refreshCompanyFactsCommandSchema.parse(command);
  const {
    sourceRegistry,
    ingestionRuns,
    refreshState,
    probeSource,
    ingest,
    now,
    newId,
  } = dependencies;

  const batchIdentity = {
    sourceId: SEC_SOURCE_ID,
    datasetId: REFRESH_PROBE_DATASET_ID,
    parserVersion: SEC_REFRESH_PROBE_VERSION,
  };
  const stateKey = {
    sourceId: SEC_SOURCE_ID,
    datasetId: COMPANY_FACTS_DATASET_ID,
    subjectKey: cik,
  };
  const startedAt = now();
  const runId = newId();

  const record = async (fields: {
    status: IngestionRunStatus;
    counts: typeof EMPTY_COUNTS;
    contentHash: string | null;
    failure: ReturnType<typeof ingestionFailureSchema.parse> | null;
    qualityFlags?: string[];
    idempotencyKey?: string;
    replayOfRunId?: string | null;
    nextCursor?: string | null;
    cursor?: string | null;
  }): Promise<IngestionRun> => {
    const finishedAt = now();
    const run = ingestionRunSchema.parse({
      runId,
      ...batchIdentity,
      idempotencyKey:
        fields.idempotencyKey ??
        computeIdempotencyKey({
          ...batchIdentity,
          requestedAsOf: null,
          requestedVintage: null,
          cursor: fields.cursor ?? null,
          subjectKey: cik,
          selectionVersion: null,
        }),
      requestedAsOf: null,
      requestedVintage: null,
      cursor: fields.cursor ?? null,
      nextCursor: fields.nextCursor ?? null,
      subjectKey: cik,
      selectionVersion: null,
      selectionAnchorOn: null,
      status: fields.status,
      startedAt,
      finishedAt,
      counts: fields.counts,
      contentHash: fields.contentHash,
      failure: fields.failure,
      qualityFlags: fields.qualityFlags ?? [],
      replayOfRunId: fields.replayOfRunId ?? null,
      recordedAt: finishedAt,
    });

    return dryRun ? run : ingestionRuns.append(run);
  };

  const failed = async (
    code: IngestionFailureCode,
    cause: unknown,
    qualityFlags: string[] = [],
  ): Promise<RefreshCompanyFactsOutcome> => ({
    persisted: !dryRun,
    cik,
    probeRun: await record({
      status: "failed",
      counts: EMPTY_COUNTS,
      contentHash: null,
      failure: ingestionFailureSchema.parse(
        toSafeIngestionFailure(code, cause),
      ),
      qualityFlags,
    }),
    decision: null,
    previous: null,
    state: null,
    ingestion: null,
  });

  // 1. Registro y derechos, antes de cualquier egress.
  const entry = await sourceRegistry.findBySourceId(SEC_SOURCE_ID);

  if (!entry) {
    return failed(
      "source_not_registered",
      "La fuente solicitada no existe en el registro.",
    );
  }

  if (!entry.datasets.includes(REFRESH_PROBE_DATASET_ID)) {
    return failed(
      "dataset_not_registered",
      "El dataset solicitado no está declarado por la fuente.",
    );
  }

  const rights = evaluateIngestionRights(entry, RIGHTS_REQUEST);

  if (!rights.allowed) {
    return failed(
      "rights_not_approved",
      `Derechos sin aprobar: ${rights.blockedBy.join(", ")}`,
      ["rights_blocked"],
    );
  }

  // 2. Marca guardada y sondeo. La marca se lee antes de la red: si el sondeo
  //    falla, lo que ya se sabía no cambió.
  const stored = await refreshState.find(stateKey);
  const previous: FilerRefreshWatermark | null =
    stored === null
      ? null
      : {
          acceptedAt: stored.watermarkAcceptedAt,
          accessionNumber: stored.watermarkAccession,
          formSelectionVersion: stored.formSelectionVersion,
        };
  const cursor =
    previous === null
      ? null
      : `${previous.acceptedAt}|${previous.accessionNumber}`;

  let probe;

  try {
    probe = await probeSource.probe(cik);
  } catch (cause) {
    if (
      cause instanceof CompanyFactsSourceError &&
      (cause.code === "payload_schema_invalid" ||
        cause.code === "subject_mismatch")
    ) {
      // Un índice que no se entiende se cuarentena: no mueve la marca y no
      // dispara ninguna descarga.
      return {
        persisted: !dryRun,
        cik,
        probeRun: await record({
          status: "quarantined",
          counts: EMPTY_COUNTS,
          contentHash: computeContentHash({ probe: "unreadable" }),
          failure: null,
          qualityFlags: [`${cause.document}_${cause.code}`],
          cursor,
        }),
        decision: null,
        previous,
        state: null,
        ingestion: null,
      };
    }

    return failed("provider_error", cause);
  }

  // 3. Decisión, en dominio.
  const decision = decideFilerRefresh({
    filings: probe.filings,
    watermark: previous,
  });
  const observed = decision.observed;
  const nextCursor =
    observed === null
      ? null
      : `${observed.acceptedAt}|${observed.accessionNumber}`;
  // Lo que el sondeo vio **es** su contenido: dos vueltas que ven lo mismo
  // comparten clave, y la segunda queda registrada como repetición.
  const documentVersion = computeContentHash({
    observed,
    relevant: decision.relevant,
  });
  const idempotencyKey = computeIdempotencyKey({
    ...batchIdentity,
    requestedAsOf: null,
    requestedVintage: null,
    cursor,
    subjectKey: cik,
    selectionVersion: null,
    documentVersion,
  });
  const previousRun = await ingestionRuns.findByIdempotencyKey(idempotencyKey);
  // Una vuelta ya registrada con este mismo contenido no vuelve a ser
  // publicable: es la repetición de un intento anterior cuya descarga no llegó a
  // terminar.
  const repeated =
    previousRun !== null && isPublishableStatus(previousRun.status);
  // Lo que la corrida cuenta es el documento que pidió —el índice—, no las
  // presentaciones que trae: contarlas haría de «sondeé y no había nada nuevo»
  // un estado imposible, porque `succeeded` exige haber aceptado todo lo leído.
  // Cuántas relevantes vio y cuántas eran nuevas vive en la decisión, y el
  // comando lo informa.
  const brought = decision.refresh && !repeated;

  // 4. La corrida del sondeo, siempre.
  const probeRun = await record({
    status: brought ? "succeeded" : "duplicate",
    counts: {
      fetched: 1,
      accepted: brought ? 1 : 0,
      rejected: 0,
      duplicate: brought ? 0 : 1,
    },
    contentHash: documentVersion,
    failure: null,
    qualityFlags: [
      ...(decision.relevant === 0 ? ["no_relevant_filings"] : []),
      ...(decision.withoutAcceptance > 0 ? ["filings_without_acceptance"] : []),
    ],
    idempotencyKey,
    replayOfRunId: repeated ? previousRun.runId : null,
    cursor,
    nextCursor,
  });

  const checkedAt = now();

  if (!decision.refresh) {
    // 6bis. Sin novedades: sólo avanza cuándo se miró.
    return {
      persisted: !dryRun,
      cik,
      probeRun,
      decision,
      previous,
      state: dryRun
        ? null
        : await refreshState.touch({
            ...stateKey,
            checkedAt,
            probeRunId: probeRun.runId,
            probeVersion: decision.probeVersion,
          }),
      ingestion: null,
    };
  }

  if (dryRun || observed === null) {
    return {
      persisted: !dryRun,
      cik,
      probeRun,
      decision,
      previous,
      state: null,
      ingestion: null,
    };
  }

  // 5. Companyfacts, sólo porque hay algo nuevo.
  const ingestion = await ingest(cik);

  if (!refreshed(ingestion.run.status)) {
    // La marca no se mueve: la vuelta siguiente lo vuelve a intentar.
    return {
      persisted: true,
      cik,
      probeRun,
      decision,
      previous,
      state: null,
      ingestion,
    };
  }

  // 6. La marca, al final.
  const recordedAt = now();

  return {
    persisted: true,
    cik,
    probeRun,
    decision,
    previous,
    state: await refreshState.record({
      ...stateKey,
      watermarkAcceptedAt: observed.acceptedAt,
      watermarkAccession: observed.accessionNumber,
      formSelectionVersion: observed.formSelectionVersion,
      probeVersion: decision.probeVersion,
      lastCheckedAt: checkedAt,
      lastChangedAt: checkedAt,
      probeRunId: probeRun.runId,
      refreshRunId: ingestion.run.runId,
      updatedAt: recordedAt,
    }),
    ingestion,
  };
}
