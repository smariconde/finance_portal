import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import { contentHashSchema } from "@/modules/temporal/domain/temporal-version";

import {
  observationSubjectTypeSchema,
  type Observation,
} from "../domain/observation";
import {
  observationPrunePlanSchema,
  type ObservationPrune,
  type ObservationPruneCounts,
  type ObservationPrunePlan,
} from "../domain/observation-prune";

/**
 * Lectura acotada: el repositorio devuelve todas las revisiones del sujeto y la
 * selección temporal ocurre en el dominio, de modo que exista una sola
 * implementación del contrato point-in-time. El límite evita que una consulta
 * sin filtros recorra la tabla entera (`TM-07`).
 */
export const observationListQuerySchema = z.object({
  subjectType: observationSubjectTypeSchema,
  subjectId: z.uuid(),
  metricIds: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
  limit: z.number().int().min(1).max(1000).default(500),
});

export type ObservationListQuery = z.input<typeof observationListQuerySchema>;

export const observationSupersessionSchema = z.object({
  observationId: z.uuid(),
  /** Instante en que la revisión siguiente pasa a ser la vigente. */
  supersededAt: z.iso.datetime({ offset: true }),
});

export type ObservationSupersession = z.infer<
  typeof observationSupersessionSchema
>;

/**
 * Publicación atómica: las supersesiones y las revisiones nuevas entran en la
 * misma transacción. Una publicación parcial dejaría dos revisiones vigentes o
 * ninguna, y ambas rompen el contrato point-in-time.
 */
export type ObservationPublication = {
  ingestionRunId: string;
  observations: readonly Observation[];
  supersessions: readonly ObservationSupersession[];
};

/**
 * Techo de cadenas por lectura en lote. Un documento de la SEC trae miles de
 * hechos; el techo obliga al llamador a partir el lote en vez de armar una
 * consulta sin límite (`TM-07`).
 */
export const MAX_REVISION_GROUPS_PER_LOOKUP = 1000;

/**
 * Poda con su auditoría (ADR 0019). El borrado y la fila que lo explica entran
 * en la misma transacción: un borrado sin registro dejaría la base afirmando que
 * el filer no reportó lo que en realidad se borró.
 *
 * Los conteos no se pasan: el repositorio los mide dentro de la transacción y
 * los devuelve en el registro, para que la auditoría diga lo que efectivamente
 * pasó y no lo que el llamador creyó que iba a pasar.
 */
export const observationPruneRequestSchema = z.object({
  pruneId: z.uuid(),
  ruleVersion: z.string().trim().min(1).max(64),
  plan: observationPrunePlanSchema,
  selectionVersion: z.string().trim().min(1).max(64),
  selectionAnchorOn: z.iso.date(),
  anchorRunId: z.uuid(),
  actor: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(240),
  executedAt: z.iso.datetime({ offset: true }),
});

export type ObservationPruneRequest = z.infer<
  typeof observationPruneRequestSchema
>;

export interface ObservationRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  findLatestRevision(revisionGroupId: string): Promise<Observation | null>;
  /**
   * Todas las revisiones de las cadenas pedidas. Hace falta la cadena entera y no
   * sólo su punta: volver a publicar una vintage vieja de un hecho ya re-expresado
   * es un duplicado de una revisión intermedia, no una revisión nueva. Una cadena
   * sin revisiones no aparece; nunca se inventa una vacía.
   */
  listRevisionGroups(
    revisionGroupIds: readonly string[],
  ): Promise<Observation[]>;
  listByRevisionGroup(revisionGroupId: string): Promise<Observation[]>;
  list(query: ObservationListQuery): Promise<Observation[]>;
  publish(publication: ObservationPublication): Promise<Observation[]>;
  /** Cuántas filas borraría el plan, sin borrar ninguna: la corrida en seco. */
  countPruneTargets(
    plan: ObservationPrunePlan,
  ): Promise<ObservationPruneCounts>;
  /** Borra y registra en una sola transacción. */
  prune(request: ObservationPruneRequest): Promise<ObservationPrune>;
  /** Podas registradas de un sujeto, de la más reciente a la más vieja. */
  listPrunes(
    subjectType: Observation["subjectType"],
    subjectId: string,
  ): Promise<ObservationPrune[]>;
}

export const revisionGroupIdSchema = contentHashSchema;

type RepositoryFactories = {
  personal: () => ObservationRepository;
};

export function selectObservationRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): ObservationRepository {
  return selectPersonalDependency(mode, "observation", factories.personal);
}

/**
 * Identidad de cache de una lectura derivada. El modo forma parte de la clave,
 * así que una entrada de demo nunca puede servir datos personales (`TM-04`).
 */
export function createObservationCacheIdentity(
  mode: AppMode,
  subjectType: Observation["subjectType"],
  subjectId: string,
): readonly ["observation", AppMode, string, string] {
  return [
    "observation",
    mode,
    observationSubjectTypeSchema.parse(subjectType),
    z.uuid().parse(subjectId),
  ];
}
