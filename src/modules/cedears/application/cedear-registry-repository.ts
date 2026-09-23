import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type {
  CedearRegistryPlan,
  StoredCedearRegistry,
} from "../domain/plan-cedear-registry";

/**
 * Lectura acotada del registro (`TM-07`). Superar el techo es un error y no un
 * truncado: un registro truncado en silencio es una matriz con marcas de menos.
 */
export const cedearRegistryQuerySchema = z.object({
  /** `null` lee los dos emisores. */
  depositaryLegalEntityId: z.uuid().nullable().default(null),
  limit: z.number().int().min(1).max(50_000).default(10_000),
});

export type CedearRegistryQuery = z.input<typeof cedearRegistryQuerySchema>;

export type CedearRegistrySummary = {
  readonly ruleVersion: string;
  readonly sourceId: string;
  readonly applied: {
    readonly legalEntities: number;
    readonly securities: number;
    readonly identifierAssignments: number;
    readonly programs: number;
    readonly programSupersessions: number;
    readonly ratios: number;
    readonly ratioSupersessions: number;
  };
};

export interface CedearRegistryRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  /** Todas las versiones, vigentes o no: el planner y la lectura al corte las precisan. */
  loadRegistry(query: CedearRegistryQuery): Promise<StoredCedearRegistry>;
  /**
   * Aplica el plan en una transacción. Partido no sirve: un programa sin su
   * security, o un ratio nuevo sin superseder el viejo, dejaría el registro en
   * un estado que los índices únicos declaran imposible.
   */
  applyRegistryPlan(plan: CedearRegistryPlan): Promise<CedearRegistrySummary>;
}

type RepositoryFactories = {
  personal: () => CedearRegistryRepository;
};

export function selectCedearRegistryRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): CedearRegistryRepository {
  return selectPersonalDependency(
    mode,
    "cedear-registry-repository",
    factories.personal,
  );
}

export function summarizeCedearPlan(
  plan: CedearRegistryPlan,
): CedearRegistrySummary {
  return {
    ruleVersion: plan.ruleVersion,
    sourceId: plan.sourceId,
    applied: {
      legalEntities: plan.legalEntities.length,
      securities: plan.securities.length,
      identifierAssignments: plan.identifierAssignments.length,
      programs: plan.programs.length,
      programSupersessions: plan.programSupersessions.length,
      ratios: plan.ratios.length,
      ratioSupersessions: plan.ratioSupersessions.length,
    },
  };
}
