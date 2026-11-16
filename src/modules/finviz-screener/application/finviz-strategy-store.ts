import type {
  FinvizStrategyFields,
  StoredFinvizStrategy,
} from "@/modules/finviz-screener/domain/finviz-screener-strategy";

/**
 * Las estrategias de Finviz en la base de trading (`F11-13`), como revisiones
 * append-only: renombrar o cambiar un filtro deja visible la anterior, y
 * archivar es otra revisión, no un borrado. No dependen de la cuenta Schwab.
 */
export type SaveFinvizStrategyResult =
  | {
      readonly state: "saved" | "unchanged";
      readonly strategy: StoredFinvizStrategy;
    }
  | { readonly state: "conflict" | "name_taken" };

export interface FinvizStrategyStore {
  /** Las vigentes y activas, por nombre. */
  listActive(): Promise<StoredFinvizStrategy[]>;
  /** Escribe sólo si la vigente es `baseRevision` (`null`: una nueva). */
  save(input: {
    readonly strategyId: string;
    readonly baseRevision: number | null;
    readonly fields: FinvizStrategyFields;
    readonly version: string;
    readonly catalogVersion: string;
    readonly recordedAt: string;
  }): Promise<SaveFinvizStrategyResult>;
  archive(input: {
    readonly strategyId: string;
    readonly baseRevision: number;
    readonly recordedAt: string;
  }): Promise<"archived" | "conflict">;
}
