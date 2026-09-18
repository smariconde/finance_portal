import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import {
  datasetIdSchema,
  sourceIdSchema,
} from "@/modules/ingestion/domain/source-registry-entry";

/**
 * Marca de agua del refresh por sujeto (ADR 0021).
 *
 * Guarda hasta qué presentación miró el sondeo a cada filer y cuándo lo miró.
 * Es **estado**, no bitácora: la corrida de cada sondeo queda en
 * `ingestion_runs` y explica la vuelta, mientras que esta fila contesta directo
 * «¿qué sabía el portal la última vez?», que es lo que el plan lee sin red.
 *
 * El orden de escritura es el que sostiene la única invariante que importa: la
 * fila se escribe **después** de que el refresh terminó. Si algo falla en el
 * medio la marca queda atrás y la vuelta siguiente vuelve a bajar —que
 * deduplica por contenido— pero nunca queda adelante de un refresh que no
 * ocurrió. Por eso no hace falta una transacción que cruce repositorios.
 */
export const refreshStateKeySchema = z.object({
  sourceId: sourceIdSchema,
  datasetId: datasetIdSchema,
  subjectKey: z.string().trim().min(1).max(128),
});

export type RefreshStateKey = z.infer<typeof refreshStateKeySchema>;

export const refreshStateSchema = z
  .object({
    ...refreshStateKeySchema.shape,
    /** Par `(aceptación, accession)` de la presentación relevante más nueva. */
    watermarkAcceptedAt: z.iso.datetime({ offset: true }),
    watermarkAccession: z
      .string()
      .trim()
      .regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
    formSelectionVersion: z.string().trim().min(1).max(64),
    probeVersion: z.string().trim().min(1).max(64),
    lastCheckedAt: z.iso.datetime({ offset: true }),
    lastChangedAt: z.iso.datetime({ offset: true }),
    /** Corrida del sondeo que dejó esta fila. */
    probeRunId: z.uuid(),
    /** Corrida de companyfacts del último refresh efectivo. */
    refreshRunId: z.uuid(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((state, context) => {
    if (state.lastChangedAt > state.lastCheckedAt) {
      context.addIssue({
        code: "custom",
        path: ["lastChangedAt"],
        message: "lastChangedAt cannot be later than lastCheckedAt.",
      });
    }

    if (state.updatedAt < state.lastCheckedAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "updatedAt cannot be earlier than lastCheckedAt.",
      });
    }
  });

export type RefreshState = z.infer<typeof refreshStateSchema>;

export const refreshStateListQuerySchema = z.object({
  sourceId: sourceIdSchema,
  datasetId: datasetIdSchema,
  limit: z.number().int().min(1).max(5000).default(1000),
});

export type RefreshStateListQuery = z.input<typeof refreshStateListQuerySchema>;

export const refreshCheckSchema = z.object({
  ...refreshStateKeySchema.shape,
  checkedAt: z.iso.datetime({ offset: true }),
  probeRunId: z.uuid(),
  probeVersion: z.string().trim().min(1).max(64),
});

export type RefreshCheck = z.infer<typeof refreshCheckSchema>;

export interface RefreshStateStore {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  find(key: RefreshStateKey): Promise<RefreshState | null>;
  list(query: RefreshStateListQuery): Promise<RefreshState[]>;
  /**
   * Marca nueva después de un refresh efectivo, con la corrida que lo hizo. Es
   * la única forma de mover la marca: un sondeo que no bajó nada no la toca.
   */
  record(state: RefreshState): Promise<RefreshState>;
  /**
   * Un sondeo sin novedades: avanza cuándo se miró y con qué corrida, y deja la
   * marca donde estaba. Devuelve `null` si el sujeto todavía no tiene fila, que
   * es el caso en que el sondeo no tenía nada contra qué comparar.
   */
  touch(check: RefreshCheck): Promise<RefreshState | null>;
}

type StoreFactories = {
  personal: () => RefreshStateStore;
};

export function selectRefreshStateStore(
  mode: AppMode,
  factories: StoreFactories,
): RefreshStateStore {
  return selectPersonalDependency(mode, "refresh-state", factories.personal);
}
