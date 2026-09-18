import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import {
  sourceControlStatusSchema,
  type SourceBudgetState,
  type SourceControl,
  type SourceRequestVerdict,
} from "@/modules/ingestion/domain/source-budget";
import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";

/**
 * Almacén del presupuesto diario y del kill switch (ADR 0020).
 *
 * `consume` es el único punto donde se gasta cuota, y es **una** sentencia
 * atómica: un incremento condicionado al tope que devuelve fila si entró y
 * ninguna si no. No hace falta lock ni lease —dos procesos que llamen a la vez
 * no pueden pasarse del tope, porque PostgreSQL serializa el upsert sobre la
 * misma clave— y por eso los comandos manuales quedan acotados sin tomar el
 * lease del backfill, que protege otra cosa (el avance ordenado de un job).
 *
 * La cuota se gasta al **intentar**, igual que el presupuesto por corrida: una
 * llamada que falla también consumió cuota de la fuente.
 */
export const sourceUsageWindowSchema = z.object({
  sourceId: sourceIdSchema,
  /** Inclusive, fechas UTC. */
  fromDay: z.iso.date(),
  toDay: z.iso.date(),
  limit: z.number().int().min(1).max(400).default(30),
});

export type SourceUsageWindow = z.input<typeof sourceUsageWindowSchema>;

export type SourceDailyUsage = {
  readonly sourceId: string;
  readonly day: string;
  readonly requests: number;
  readonly firstRequestAt: string;
  readonly lastRequestAt: string;
};

export const sourceControlChangeSchema = z.object({
  controlId: z.uuid(),
  sourceId: sourceIdSchema,
  status: sourceControlStatusSchema,
  /** `null` deja regir el tope declarado en código; nunca puede subirlo. */
  dailyRequestLimit: z.number().int().min(0).max(1_000_000).nullable(),
  reason: z.string().trim().min(3).max(240),
  actor: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:@/-]{1,128}$/u),
  now: z.iso.datetime({ offset: true }),
});

export type SourceControlChange = z.infer<typeof sourceControlChangeSchema>;

export interface SourceBudgetStore {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  /** Control vigente y consumo del día, sin gastar nada. */
  readState(sourceId: string, now: string): Promise<SourceBudgetState>;
  /**
   * Gasta una llamada si el control y el tope del día la permiten. El veredicto
   * lo decide el almacén, no el llamador: entre una lectura y esta escritura
   * puede haber pasado otro proceso.
   */
  consume(sourceId: string, now: string): Promise<SourceRequestVerdict>;
  /** Supersede el control vigente y abre el nuevo, en una transacción. */
  setControl(change: SourceControlChange): Promise<SourceControl>;
  /** Controles vigentes de todas las fuentes que alguna vez tuvieron uno. */
  listControls(): Promise<SourceControl[]>;
  /** Historia de controles de una fuente, del más reciente al más viejo. */
  listControlHistory(
    sourceId: string,
    limit?: number,
  ): Promise<SourceControl[]>;
  listUsage(window: SourceUsageWindow): Promise<SourceDailyUsage[]>;
}

type StoreFactories = {
  personal: () => SourceBudgetStore;
};

export function selectSourceBudgetStore(
  mode: AppMode,
  factories: StoreFactories,
): SourceBudgetStore {
  return selectPersonalDependency(mode, "source-budget", factories.personal);
}
