import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { contentHashSchema } from "@/modules/temporal/domain/temporal-version";

import { ENGINE_VERSION, METHODOLOGY_VERSION } from "../domain/valuation-input";
import type { ValuationRun } from "../domain/valuation-run";

/**
 * Identidad de replay: el mismo snapshot bajo el mismo motor y la misma
 * metodología es **la misma corrida**, no una nueva. Un cambio de versión sí
 * produce otra, porque el resultado puede diferir legítimamente.
 */
export const valuationReplayKeySchema = z.object({
  inputHash: contentHashSchema,
  engineVersion: z.literal(ENGINE_VERSION),
  methodologyVersion: z.literal(METHODOLOGY_VERSION),
});

export type ValuationReplayKey = z.infer<typeof valuationReplayKeySchema>;

export function toReplayKey(run: ValuationRun): ValuationReplayKey {
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
  readonly storage: "demo-fixture" | "personal-postgres";
  /**
   * Registra la corrida. Es idempotente por clave de replay: si ya existe una
   * corrida para el mismo snapshot y motor devuelve **esa**, sin sobrescribirla
   * ni duplicarla. Una corrida es append-only.
   */
  record(run: ValuationRun): Promise<ValuationRun>;
  findByReplayKey(key: ValuationReplayKey): Promise<ValuationRun | null>;
  list(query: ValuationRunListQuery): Promise<ValuationRun[]>;
}

type RepositoryFactories = {
  demo: () => ValuationRunRepository;
  personal: () => ValuationRunRepository;
};

export function selectValuationRunRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): ValuationRunRepository {
  return mode === "personal" ? factories.personal() : factories.demo();
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
