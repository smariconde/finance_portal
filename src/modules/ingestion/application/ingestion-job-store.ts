import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import {
  ingestionJobItemStatusSchema,
  ingestionJobStatusSchema,
  type IngestionJob,
  type IngestionJobEvent,
  type IngestionJobItem,
  type IngestionJobItemCounts,
  type IngestionJobItemDecision,
  type IngestionJobPlanInput,
  type IngestionLease,
  type IngestionLeaseHandle,
} from "@/modules/ingestion/domain/ingestion-job";
import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";

/**
 * Almacén durable de jobs de ingesta (ADR 0015).
 *
 * Toda transición es una operación atómica del almacén. Las que cambian el
 * trabajo de un worker están **cercadas** por el token del lease: si otro proceso
 * tomó la fuente, la escritura no ocurre y el llamador recibe `lease_lost`. Cada
 * escritura cercada renueva además el vencimiento, así que un worker que avanza
 * nunca pierde el lease por no haber latido.
 *
 * Los instantes llegan como argumento: el almacén no lee un reloj, y así los
 * tests mueven el tiempo en vez de esperarlo.
 */
export const ingestionJobListQuerySchema = z.object({
  sourceId: sourceIdSchema.optional(),
  statuses: z.array(ingestionJobStatusSchema).min(1).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export type IngestionJobListQuery = z.input<typeof ingestionJobListQuerySchema>;

export const ingestionJobItemListQuerySchema = z.object({
  jobId: z.uuid(),
  statuses: z.array(ingestionJobItemStatusSchema).min(1).optional(),
  /** Paginación por ordinal: devuelve los items con ordinal mayor. */
  afterOrdinal: z.number().int().min(-1).default(-1),
  limit: z.number().int().min(1).max(1000).default(100),
});

export type IngestionJobItemListQuery = z.input<
  typeof ingestionJobItemListQuerySchema
>;

export const ingestionJobEventListQuerySchema = z.object({
  jobId: z.uuid(),
  /** Los eventos más recientes, devueltos en orden cronológico. */
  limit: z.number().int().min(1).max(500).default(50),
});

export type IngestionJobEventListQuery = z.input<
  typeof ingestionJobEventListQuerySchema
>;

export type IngestionJobCreation = {
  /** `false`: ya había un job abierto o pausado con el mismo plan. */
  readonly created: boolean;
  readonly job: IngestionJob;
};

export type LeaseAcquisition =
  | {
      readonly status: "acquired";
      readonly lease: IngestionLease;
      /** Lease vencido que se tomó; `null` si la fuente estaba libre. */
      readonly takenOver: IngestionLease | null;
      /** Items huérfanos devueltos a la cola o envenenados al tomar la fuente. */
      readonly recovered: readonly IngestionJobItem[];
      readonly job: IngestionJob;
    }
  | { readonly status: "busy"; readonly lease: IngestionLease }
  | {
      /** El job no está abierto o espera un backoff de la fuente. */
      readonly status: "job_not_runnable";
      readonly job: IngestionJob;
    };

export type FencedResult<TValue> =
  | ({ readonly status: "ok" } & TValue)
  | { readonly status: "lease_lost" }
  | { readonly status: "job_not_runnable"; readonly job: IngestionJob };

export type ItemTransition = {
  readonly item: IngestionJobItem;
  readonly job: IngestionJob;
};

export type ManualContext = {
  readonly now: string;
  readonly reason: string;
};

export class IngestionJobNotFoundError extends Error {
  readonly jobId: string;

  constructor(jobId: string) {
    super(`Ingestion job ${jobId} does not exist.`);
    this.name = "IngestionJobNotFoundError";
    this.jobId = jobId;
  }
}

export type IngestionJobStateErrorCode =
  | "job_terminal"
  | "job_not_paused"
  | "job_leased"
  | "item_not_found"
  | "item_not_requeueable"
  | "item_not_at_cursor"
  | "item_not_ready";

/**
 * Transición pedida que el estado no admite. Es un error del llamador, no una
 * carrera: las carreras esperables vuelven como resultado, no como excepción.
 */
export class IngestionJobStateError extends Error {
  readonly code: IngestionJobStateErrorCode;

  constructor(code: IngestionJobStateErrorCode, message: string) {
    super(message);
    this.name = "IngestionJobStateError";
    this.code = code;
  }
}

export interface IngestionJobStore {
  readonly storage: "in-memory-fixture" | "personal-postgres";

  /** Crea el job y sus items, o devuelve el abierto con el mismo plan. */
  createJob(
    plan: IngestionJobPlanInput,
    context: { readonly now: string },
  ): Promise<IngestionJobCreation>;
  getJob(jobId: string): Promise<IngestionJob | null>;
  listJobs(query: IngestionJobListQuery): Promise<IngestionJob[]>;
  listItems(query: IngestionJobItemListQuery): Promise<IngestionJobItem[]>;
  countItems(jobId: string): Promise<IngestionJobItemCounts>;
  listEvents(query: IngestionJobEventListQuery): Promise<IngestionJobEvent[]>;
  getLease(sourceId: string): Promise<IngestionLease | null>;
  /** Job y el item del cursor, sin tomar nada. */
  peekNext(jobId: string): Promise<{
    readonly job: IngestionJob;
    readonly item: IngestionJobItem | null;
  }>;

  /**
   * Toma el lease de la fuente del job si está libre o vencido. Al tomarlo
   * recupera todo item `running` de esa fuente: ninguno puede pertenecer a un
   * proceso vivo, porque el lease era el único permiso para correrlo.
   */
  acquireLease(request: {
    readonly jobId: string;
    readonly holder: string;
    readonly leaseToken: string;
    readonly now: string;
    readonly ttlMs: number;
  }): Promise<LeaseAcquisition>;
  /** Renueva el vencimiento; `null` si el token ya no es el del lease. */
  heartbeat(
    lease: IngestionLeaseHandle,
    context: { readonly now: string; readonly ttlMs: number },
  ): Promise<IngestionLease | null>;
  /** Suelta el lease si sigue siendo propio; `false` si ya no lo era. */
  releaseLease(
    lease: IngestionLeaseHandle,
    context: { readonly now: string },
  ): Promise<boolean>;

  /** Empieza el item del cursor: cuenta el intento y lo marca `running`. */
  startItem(
    lease: IngestionLeaseHandle,
    request: {
      readonly ordinal: number;
      readonly now: string;
      readonly ttlMs: number;
    },
  ): Promise<FencedResult<ItemTransition>>;
  /**
   * Checkpoint: registra la decisión sobre el item en curso y recalcula el
   * cursor; si no queda nada, completa el job. Un job pausado mientras el
   * intento corría igual recibe su resultado.
   */
  finishItem(
    lease: IngestionLeaseHandle,
    request: {
      readonly ordinal: number;
      readonly decision: IngestionJobItemDecision;
      readonly now: string;
      readonly ttlMs: number;
    },
  ): Promise<FencedResult<ItemTransition>>;

  // Recuperación manual. Cada una deja un evento con actor `owner` y motivo.
  pauseJob(jobId: string, context: ManualContext): Promise<IngestionJob>;
  /** Reabre un job pausado o levanta el backoff de uno abierto. */
  resumeJob(jobId: string, context: ManualContext): Promise<IngestionJob>;
  /** Se niega mientras exista un lease sobre el job, vivo o vencido. */
  cancelJob(jobId: string, context: ManualContext): Promise<IngestionJob>;
  /** Devuelve a la cola un item fallado o envenenado, con los intentos en cero. */
  requeueItem(
    jobId: string,
    ordinal: number,
    context: ManualContext,
  ): Promise<ItemTransition>;
  /**
   * Declara muerto al holder sin esperar el vencimiento. Sus items en curso se
   * recuperan en el acto; si seguía vivo, su próxima escritura cercada falla.
   */
  forceReleaseLease(
    sourceId: string,
    context: ManualContext,
  ): Promise<{
    readonly released: IngestionLease | null;
    readonly recovered: readonly IngestionJobItem[];
  }>;
}

type StoreFactories = {
  personal: () => IngestionJobStore;
};

export function selectIngestionJobStore(
  mode: AppMode,
  factories: StoreFactories,
): IngestionJobStore {
  return selectPersonalDependency(mode, "ingestion-job", factories.personal);
}
