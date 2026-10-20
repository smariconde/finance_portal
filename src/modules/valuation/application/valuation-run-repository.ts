import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import { contentHashSchema } from "@/modules/temporal/domain/temporal-version";

import { ENGINE_VERSION, METHODOLOGY_VERSION } from "../domain/valuation-input";
import type { StoredValuationRun } from "../domain/stored-valuation-run";
import {
  EXCESS_RETURN_ENGINE_VERSION,
  EXCESS_RETURN_METHODOLOGY_VERSION,
} from "../domain/excess-return-input";

/**
 * Identidad de replay: el mismo snapshot bajo el mismo motor y la misma
 * metodología es **la misma corrida**, no una nueva. Un cambio de versión sí
 * produce otra, porque el resultado puede diferir legítimamente.
 */
export const valuationReplayKeySchema = z.object({
  inputHash: contentHashSchema,
  engineVersion: z.enum([ENGINE_VERSION, EXCESS_RETURN_ENGINE_VERSION]),
  methodologyVersion: z.enum([
    METHODOLOGY_VERSION,
    EXCESS_RETURN_METHODOLOGY_VERSION,
  ]),
});

export type ValuationReplayKey = z.infer<typeof valuationReplayKeySchema>;

export function toReplayKey(run: StoredValuationRun): ValuationReplayKey {
  return valuationReplayKeySchema.parse({
    inputHash: run.inputHash,
    engineVersion: run.engineVersion,
    methodologyVersion: run.methodologyVersion,
  });
}

/**
 * Lectura acotada. El límite evita que una consulta sin filtros recorra la
 * tabla entera (`TM-07`).
 */
export const valuationRunListQuerySchema = z.object({
  legalEntityId: z.uuid(),
  securityId: z.uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export type ValuationRunListQuery = z.input<typeof valuationRunListQuerySchema>;

export interface ValuationRunRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  /**
   * Registra la corrida. Es idempotente por clave de replay: si ya existe una
   * corrida para el mismo snapshot y motor devuelve **esa**, sin sobrescribirla
   * ni duplicarla. Una corrida es append-only.
   */
  record(run: StoredValuationRun): Promise<StoredValuationRun>;
  findByReplayKey(key: ValuationReplayKey): Promise<StoredValuationRun | null>;
  /** Una corrida por su ID, para volver a calcularla (`F5-06`). */
  findById(valuationRunId: string): Promise<StoredValuationRun | null>;
  list(query: ValuationRunListQuery): Promise<StoredValuationRun[]>;
}

type RepositoryFactories = {
  personal: () => ValuationRunRepository;
};

export function selectValuationRunRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): ValuationRunRepository {
  return selectPersonalDependency(mode, "valuation-run", factories.personal);
}

/**
 * Identidad de cache de una valuación derivada. El modo forma parte de la clave,
 * así que una entrada de demo nunca puede servir una corrida personal
 * (`TM-04`).
 */
export function createValuationCacheIdentity(
  mode: AppMode,
  inputHash: string,
): readonly ["valuation", AppMode, string, string] {
  return [
    "valuation",
    mode,
    ENGINE_VERSION,
    contentHashSchema.parse(inputHash),
  ];
}
