import type { TradeAnnotation } from "@/modules/trading/domain/trade-annotation";

/**
 * Anotaciones del diario en la base de trading (ADR 0076, sección 8; `F11-07`).
 * Cada guardado distinto es una revisión nueva y nunca un update en el lugar:
 * un stop corregido deja visible el que se había planeado. La cuenta es su HMAC.
 */
export type StoredAnnotation = TradeAnnotation & {
  /** HMAC-SHA256 del número de cuenta, en hex. */
  readonly accountKey: string;
  readonly tradeKey: string;
  readonly revision: number;
  readonly version: string;
  readonly recordedAt: string;
};

export type SaveAnnotationInput = {
  readonly accountKey: string;
  readonly tradeKey: string;
  /**
   * La revisión que el owner estaba editando; `null` si no había ninguna. Si la
   * vigente es otra (otra pestaña, otro equipo), no se escribe nada.
   */
  readonly baseRevision: number | null;
  readonly annotation: TradeAnnotation;
  readonly version: string;
  readonly recordedAt: string;
};

export type SaveAnnotationResult =
  | { readonly state: "saved"; readonly annotation: StoredAnnotation }
  /** Igual a la vigente: no hay revisión nueva. */
  | { readonly state: "unchanged"; readonly annotation: StoredAnnotation }
  | { readonly state: "conflict"; readonly current: StoredAnnotation | null };

export type OwnSetupRecord = {
  readonly code: string;
  readonly label: string;
  readonly createdAt: string;
};

export type CreateOwnSetupResult = "created" | "exists" | "limit_reached";

export interface TradeAnnotationStore {
  /** La revisión vigente de cada trade anotado de la cuenta. */
  listCurrentAnnotations(accountKey: string): Promise<StoredAnnotation[]>;
  /** Todas las revisiones de un trade, la más nueva primero. */
  listAnnotationRevisions(
    accountKey: string,
    tradeKey: string,
  ): Promise<StoredAnnotation[]>;
  saveAnnotation(input: SaveAnnotationInput): Promise<SaveAnnotationResult>;
  listOwnSetups(): Promise<OwnSetupRecord[]>;
  /** Crea un setup propio; `limit_reached` si ya hay `limit`. */
  createOwnSetup(
    setup: OwnSetupRecord,
    limit: number,
  ): Promise<CreateOwnSetupResult>;
}
