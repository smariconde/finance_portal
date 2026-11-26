import {
  sameRiskSettings,
  type RiskSettings,
} from "@/modules/trading/domain/trading-rules";

/**
 * Las reglas propias del owner en la base de trading (`trading-rules-1.0.0`,
 * `F11-09`), como revisiones append-only: cambiar un límite deja visible el
 * anterior. Sin revisión rigen los valores por defecto del dominio.
 */
export type StoredRiskSettings = Omit<
  RiskSettings,
  "swingAllocationPercent" | "dayRiskPerTradePercent"
> & {
  /** `null` en una revisión de `trading-rules-1.0.0`, que no los tenía. */
  readonly swingAllocationPercent: string | null;
  readonly dayRiskPerTradePercent: string | null;
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

/**
 * Lo guardado ya dice exactamente esto. Una revisión de `1.0.0` nunca coincide:
 * guardar la completa con el reparto y el riesgo day.
 */
export function storedSettingsMatch(
  stored: StoredRiskSettings,
  settings: RiskSettings,
): boolean {
  const { swingAllocationPercent, dayRiskPerTradePercent } = stored;
  if (swingAllocationPercent === null || dayRiskPerTradePercent === null)
    return false;
  return sameRiskSettings(
    { ...stored, swingAllocationPercent, dayRiskPerTradePercent },
    settings,
  );
}
