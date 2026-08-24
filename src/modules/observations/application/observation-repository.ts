import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { contentHashSchema } from "@/modules/temporal/domain/temporal-version";

import {
  observationSubjectTypeSchema,
  type Observation,
} from "../domain/observation";

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

export interface ObservationRepository {
  readonly storage: "demo-fixture" | "personal-postgres";
  findLatestRevision(revisionGroupId: string): Promise<Observation | null>;
  listByRevisionGroup(revisionGroupId: string): Promise<Observation[]>;
  list(query: ObservationListQuery): Promise<Observation[]>;
  publish(publication: ObservationPublication): Promise<Observation[]>;
}

export const revisionGroupIdSchema = contentHashSchema;

type RepositoryFactories = {
  demo: () => ObservationRepository;
  personal: () => ObservationRepository;
};

export function selectObservationRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): ObservationRepository {
  return mode === "personal" ? factories.personal() : factories.demo();
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
