import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import {
  approvalStatusSchema,
  sourceIdSchema,
  technicalStatusSchema,
  type SourceRegistryEntry,
} from "@/modules/ingestion/domain/source-registry-entry";

export const sourceRegistryListQuerySchema = z.object({
  technicalStatus: z.array(technicalStatusSchema).min(1).max(5).optional(),
  approvalStatus: z.array(approvalStatusSchema).min(1).max(6).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type SourceRegistryListQuery = z.input<
  typeof sourceRegistryListQuerySchema
>;
type ParsedSourceRegistryListQuery = z.output<
  typeof sourceRegistryListQuerySchema
>;

export interface SourceRegistryRepository {
  readonly storage: "demo-fixture" | "personal-postgres";
  findBySourceId(sourceId: string): Promise<SourceRegistryEntry | null>;
  list(query?: SourceRegistryListQuery): Promise<SourceRegistryEntry[]>;
  /**
   * El registro es configuración revisada por el owner, no datos de una
   * corrida: se declara explícitamente y se reemplaza por `sourceId`.
   */
  upsert(entry: SourceRegistryEntry): Promise<SourceRegistryEntry>;
}

type RepositoryFactories = {
  demo: () => SourceRegistryRepository;
  personal: () => SourceRegistryRepository;
};

export function selectSourceRegistryRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): SourceRegistryRepository {
  return mode === "personal" ? factories.personal() : factories.demo();
}

export function createSourceRegistryCacheIdentity(
  mode: AppMode,
  sourceId: string,
): readonly ["source-registry", AppMode, string] {
  return ["source-registry", mode, sourceIdSchema.parse(sourceId)];
}

/** Filtro compartido por la fixture demo y por el repositorio PostgreSQL. */
export function matchesSourceRegistryQuery(
  entry: SourceRegistryEntry,
  query: ParsedSourceRegistryListQuery,
): boolean {
  return (
    (query.technicalStatus?.includes(entry.technicalStatus) ?? true) &&
    (query.approvalStatus?.includes(entry.approvalStatus) ?? true)
  );
}
