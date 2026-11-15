import type { RiskSettings } from "@/modules/trading/domain/trading-rules";

/**
 * Las reglas propias del owner en la base de trading (`trading-rules-1.0.0`,
 * `F11-09`), como revisiones append-only: cambiar un límite deja visible el
 * anterior. Sin revisión rigen los valores por defecto del dominio.
 */
export type StoredRiskSettings = RiskSettings & {
  readonly revision: number;
  readonly version: string;
  readonly recordedAt: string;
};

export type SaveRiskSettingsResult =
  | {
      readonly state: "saved" | "unchanged";
      readonly settings: StoredRiskSettings;
    }
  | { readonly state: "conflict"; readonly current: StoredRiskSettings | null };

export interface TradingRiskSettingsStore {
  /** La revisión vigente, o `null` si el owner nunca guardó. */
  readCurrent(): Promise<StoredRiskSettings | null>;
  /** Escribe sólo si la vigente es `baseRevision` (`null`: ninguna). */
  save(input: {
    readonly baseRevision: number | null;
    readonly settings: RiskSettings;
    readonly version: string;
    readonly recordedAt: string;
  }): Promise<SaveRiskSettingsResult>;
}
