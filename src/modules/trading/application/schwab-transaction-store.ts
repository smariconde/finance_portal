import type { SchwabTransaction } from "@/modules/trading/domain/schwab-transactions";

/**
 * Transacciones de la cuenta Schwab en la base de trading (ADR 0076, sección 8;
 * `F11-05`). Cada lectura distinta es una revisión nueva y nunca un update en el
 * lugar; una transacción que deja de venir queda `withdrawn`. No se guarda el
 * payload ni el número de cuenta: la cuenta es su HMAC.
 */
export type StoredTransaction = SchwabTransaction & {
  /** HMAC-SHA256 del número de cuenta, en hex. */
  readonly accountKey: string;
  readonly revision: number;
  readonly state: "recorded" | "withdrawn";
  readonly contentHash: string;
  /** Cuándo el portal vio esta revisión. */
  readonly recordedAt: string;
};

/** La transacción de una revisión guardada, sin los campos del almacén. */
export function transactionOf(stored: StoredTransaction): SchwabTransaction {
  return {
    activityId: stored.activityId,
    type: stored.type,
    status: stored.status,
    executedAt: stored.executedAt,
    settledAt: stored.settledAt,
    description: stored.description,
    orderId: stored.orderId,
    positionId: stored.positionId,
    netAmount: stored.netAmount,
    fees: stored.fees,
    instrument: stored.instrument,
  };
}

export type TransactionRevision = {
  readonly transaction: SchwabTransaction;
  readonly revision: number;
  readonly state: "recorded" | "withdrawn";
  readonly contentHash: string;
};

export type SchwabAccountRecord = {
  readonly accountKey: string;
  readonly lastFour: string;
};

export type TransactionSyncState = {
  readonly accountKey: string;
  /** Inicio de la historia verificada; `null` antes de la primera carga. */
  readonly historyFrom: string | null;
  /** Hasta dónde Schwab ya se comparó. */
  readonly checkedThrough: string | null;
  readonly claimedUntil: string | null;
};

export type TransactionRunStatus = "succeeded" | "failed" | "quarantined";

export type TransactionRun = {
  readonly runId: string;
  readonly accountKey: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly windowFrom: string | null;
  readonly windowTo: string | null;
  readonly requests: number;
  readonly status: TransactionRunStatus;
  /** Código cerrado de la falla o la cuarentena; `null` si salió bien. */
  readonly code: string | null;
  readonly inserted: number;
  readonly revised: number;
  readonly withdrawn: number;
  readonly unchanged: number;
  readonly parserVersion: string;
};

export interface SchwabTransactionStore {
  /** Registra la cuenta o actualiza cuándo se la vio; nunca su número. */
  recordAccount(account: SchwabAccountRecord, seenAt: string): Promise<void>;
  listAccounts(): Promise<SchwabAccountRecord[]>;
  readSync(accountKey: string): Promise<TransactionSyncState | null>;
  /**
   * Reclama la sincronización de la cuenta hasta `until`, en una sola
   * sentencia; crea el estado si no existe. `null` si otro la tiene reclamada.
   */
  claimSync(
    accountKey: string,
    now: string,
    until: string,
  ): Promise<TransactionSyncState | null>;
  /** Las revisiones vigentes (también las `withdrawn`) de la cuenta. */
  listCurrent(accountKey: string): Promise<StoredTransaction[]>;
  /**
   * Aplica una corrida exitosa en una transacción: supersede las revisiones
   * que reemplaza, inserta las nuevas, avanza el estado y suelta el reclamo.
   * `false` si el reclamo ya no era `claimedUntil`: no escribe nada.
   */
  applyRun(input: {
    readonly run: TransactionRun;
    readonly claimedUntil: string;
    readonly revisions: readonly TransactionRevision[];
    readonly historyFrom: string;
    readonly checkedThrough: string;
  }): Promise<boolean>;
  /** Registra una corrida que no escribe transacciones y suelta el reclamo. */
  recordFailedRun(
    run: TransactionRun,
    claimedUntil: string | null,
  ): Promise<void>;
  listRuns(accountKey: string | null, limit: number): Promise<TransactionRun[]>;
}
