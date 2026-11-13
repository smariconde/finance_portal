/**
 * Almacén de la conexión con Schwab en la base de trading (ADR 0076). Los
 * sobres ya llegan sellados: el almacén nunca ve un token en claro.
 */
export type StoredSchwabConnection = {
  readonly accessEnvelope: Buffer;
  readonly accessExpiresAt: string;
  readonly refreshEnvelope: Buffer;
  readonly authorizedAt: string;
  readonly refreshExpiresAt: string;
  readonly envelopeVersion: string;
  readonly updatedAt: string;
};

export type SchwabConnectionEventKind =
  | "connected"
  | "access_refreshed"
  | "refresh_failed"
  | "exchange_failed"
  | "callback_rejected"
  | "disconnected";

export type SchwabConnectionEvent = {
  readonly eventId: string;
  readonly kind: SchwabConnectionEventKind;
  /** Código cerrado: `[a-z0-9_:.-]`, nunca texto de la fuente. */
  readonly code: string;
  readonly requestId: string | null;
  readonly occurredAt: string;
};

export interface SchwabConnectionStore {
  /** Guarda el hash de un `state` y limpia los vencidos hace más de un día. */
  issueState(input: {
    readonly stateHash: Buffer;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<void>;
  /**
   * Consume un `state` en una sola sentencia: `true` sólo si existía, seguía
   * vigente y nadie lo había usado. Dos callbacks con el mismo `state` no
   * pueden ganar los dos.
   */
  consumeState(stateHash: Buffer, now: string): Promise<boolean>;
  readConnection(): Promise<StoredSchwabConnection | null>;
  /** Reemplaza la conexión entera: un login nuevo, con su propio vencimiento. */
  saveConnection(connection: StoredSchwabConnection): Promise<void>;
  /** Borra los tokens: el owner se desconecta. El log queda. */
  deleteConnection(): Promise<void>;
  /**
   * Reclama la renovación del access token hasta `until`, en una sola
   * sentencia: devuelve la conexión si nadie tenía un reclamo vigente, o `null`
   * si otro la está renovando (o no hay conexión). No retiene la conexión a la
   * base mientras se llama a Schwab.
   */
  claimRefresh(
    now: string,
    until: string,
  ): Promise<StoredSchwabConnection | null>;
  /**
   * Escribe los tokens renovados y suelta el reclamo, sólo si el reclamo sigue
   * siendo `claimedUntil`: un renovador que tardó más que su reclamo no pisa al
   * siguiente. `false` si perdió el reclamo.
   */
  completeRefresh(
    claimedUntil: string,
    renewed: Pick<
      StoredSchwabConnection,
      "accessEnvelope" | "accessExpiresAt" | "refreshEnvelope" | "updatedAt"
    >,
  ): Promise<boolean>;
  /** Suelta un reclamo sin renovar (la renovación falló). */
  releaseRefresh(claimedUntil: string): Promise<void>;
  recordEvent(event: SchwabConnectionEvent): Promise<void>;
  listEvents(limit: number): Promise<SchwabConnectionEvent[]>;
}
