import type {
  SchwabConnectionEvent,
  SchwabConnectionStore,
  StoredSchwabConnection,
} from "@/modules/trading/application/schwab-connection-store";

/** Doble en memoria del almacén de la conexión; sólo para tests. */
export function createInMemorySchwabConnectionStore(): SchwabConnectionStore & {
  readonly events: SchwabConnectionEvent[];
} {
  const states = new Map<
    string,
    { createdAt: string; expiresAt: string; consumedAt: string | null }
  >();
  let connection: StoredSchwabConnection | null = null;
  let claimedUntil: string | null = null;
  const events: SchwabConnectionEvent[] = [];

  return {
    events,
    async issueState({ stateHash, createdAt, expiresAt }) {
      const dayAgo = Date.parse(createdAt) - 24 * 60 * 60 * 1000;
      for (const [key, state] of states) {
        if (Date.parse(state.expiresAt) < dayAgo) states.delete(key);
      }
      states.set(stateHash.toString("hex"), {
        createdAt,
        expiresAt,
        consumedAt: null,
      });
    },
    async consumeState(stateHash, now) {
      const state = states.get(stateHash.toString("hex"));
      if (
        !state ||
        state.consumedAt !== null ||
        Date.parse(state.expiresAt) <= Date.parse(now)
      ) {
        return false;
      }
      state.consumedAt = now;
      return true;
    },
    async readConnection() {
      return connection;
    },
    async saveConnection(next) {
      connection = next;
      claimedUntil = null;
    },
    async deleteConnection() {
      connection = null;
      claimedUntil = null;
    },
    async claimRefresh(now, until) {
      if (connection === null) return null;
      if (claimedUntil !== null && Date.parse(claimedUntil) > Date.parse(now)) {
        return null;
      }
      claimedUntil = until;
      return connection;
    },
    async completeRefresh(claim, renewed) {
      if (connection === null || claimedUntil !== claim) return false;
      connection = { ...connection, ...renewed };
      claimedUntil = null;
      return true;
    },
    async releaseRefresh(claim) {
      if (claimedUntil === claim) claimedUntil = null;
    },
    async recordEvent(event) {
      events.push(event);
    },
    async listEvents(limit) {
      return [...events].reverse().slice(0, limit);
    },
  };
}
