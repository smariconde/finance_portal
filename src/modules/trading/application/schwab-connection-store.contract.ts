import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  SchwabConnectionStore,
  StoredSchwabConnection,
} from "./schwab-connection-store";

/**
 * Contrato del almacén de la conexión con Schwab, corrido contra el doble en
 * memoria (unitario) y contra PostgreSQL (integración de trading). Cada caso
 * deja la conexión en un estado conocido, así que el orden no importa.
 */
export const CONNECTION_T0 = "2026-11-13T15:00:00.000Z";

export function storedConnection(
  overrides: Partial<StoredSchwabConnection> = {},
): StoredSchwabConnection {
  return {
    accessEnvelope: randomBytes(48),
    accessExpiresAt: "2026-11-13T15:30:00.000Z",
    refreshEnvelope: randomBytes(48),
    authorizedAt: CONNECTION_T0,
    refreshExpiresAt: "2026-11-20T15:00:00.000Z",
    envelopeVersion: "schwab-token-envelope-1.0.0",
    updatedAt: CONNECTION_T0,
    ...overrides,
  };
}

export function describeSchwabConnectionStoreContract(
  label: string,
  createStore: () => SchwabConnectionStore,
): void {
  describe(`schwab connection store contract (${label})`, () => {
    async function issued(store: SchwabConnectionStore) {
      const stateHash = randomBytes(32);
      await store.issueState({
        stateHash,
        createdAt: CONNECTION_T0,
        expiresAt: "2026-11-13T15:10:00.000Z",
      });
      return stateHash;
    }

    it("consumes a state exactly once, inside its life", async () => {
      const store = createStore();
      const stateHash = await issued(store);

      expect(
        await store.consumeState(stateHash, "2026-11-13T15:09:59.000Z"),
      ).toBe(true);
      expect(
        await store.consumeState(stateHash, "2026-11-13T15:09:59.500Z"),
      ).toBe(false);
    });

    it("lets only one of two concurrent callbacks win", async () => {
      const store = createStore();
      const stateHash = await issued(store);

      const results = await Promise.all([
        store.consumeState(stateHash, "2026-11-13T15:01:00.000Z"),
        store.consumeState(stateHash, "2026-11-13T15:01:00.000Z"),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("refuses an expired or unknown state", async () => {
      const store = createStore();
      const stateHash = await issued(store);

      expect(
        await store.consumeState(stateHash, "2026-11-13T15:10:00.000Z"),
      ).toBe(false);
      expect(await store.consumeState(randomBytes(32), CONNECTION_T0)).toBe(
        false,
      );
    });

    it("keeps one connection and a new login replaces it", async () => {
      const store = createStore();
      const first = storedConnection();
      const second = storedConnection({
        authorizedAt: "2026-11-14T15:00:00.000Z",
        refreshExpiresAt: "2026-11-21T15:00:00.000Z",
        updatedAt: "2026-11-14T15:00:00.000Z",
        accessExpiresAt: "2026-11-14T15:30:00.000Z",
      });

      await store.saveConnection(first);
      expect(await store.readConnection()).toEqual(first);
      await store.saveConnection(second);
      expect(await store.readConnection()).toEqual(second);
    });

    const RENEWED = {
      accessExpiresAt: "2026-11-13T16:00:00.000Z",
      updatedAt: "2026-11-13T15:30:00.000Z",
    };

    it("claims a refresh once and renews without moving the login's expiry", async () => {
      const store = createStore();
      const original = storedConnection();
      await store.saveConnection(original);
      const until = "2026-11-13T15:30:30.000Z";

      expect(
        await store.claimRefresh("2026-11-13T15:30:00.000Z", until),
      ).toEqual(original);
      expect(
        await store.claimRefresh(
          "2026-11-13T15:30:01.000Z",
          "2026-11-13T15:30:31.000Z",
        ),
      ).toBeNull();

      const renewed = {
        ...RENEWED,
        accessEnvelope: randomBytes(48),
        refreshEnvelope: randomBytes(48),
      };
      expect(await store.completeRefresh(until, renewed)).toBe(true);
      expect(await store.readConnection()).toEqual({ ...original, ...renewed });

      // El reclamo quedó libre.
      expect(
        await store.claimRefresh(
          "2026-11-13T15:59:30.000Z",
          "2026-11-13T16:00:00.000Z",
        ),
      ).not.toBeNull();
    });

    it("lets two concurrent requests claim, but only one wins", async () => {
      const store = createStore();
      await store.saveConnection(storedConnection());

      const claims = await Promise.all([
        store.claimRefresh(
          "2026-11-13T15:30:00.000Z",
          "2026-11-13T15:30:30.000Z",
        ),
        store.claimRefresh(
          "2026-11-13T15:30:00.000Z",
          "2026-11-13T15:30:30.001Z",
        ),
      ]);
      expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    });

    it("lets a later request take over an expired claim, and fences the late one", async () => {
      const store = createStore();
      await store.saveConnection(storedConnection());
      const stale = "2026-11-13T15:30:30.000Z";
      const fresh = "2026-11-13T15:31:30.000Z";

      await store.claimRefresh("2026-11-13T15:30:00.000Z", stale);
      expect(
        await store.claimRefresh("2026-11-13T15:31:00.000Z", fresh),
      ).not.toBeNull();

      const late = {
        ...RENEWED,
        accessEnvelope: randomBytes(48),
        refreshEnvelope: randomBytes(48),
      };
      expect(await store.completeRefresh(stale, late)).toBe(false);
      expect((await store.readConnection())!.accessExpiresAt).toBe(
        "2026-11-13T15:30:00.000Z",
      );
    });

    it("releases a claim that failed so the next request can try", async () => {
      const store = createStore();
      await store.saveConnection(storedConnection());
      const until = "2026-11-13T15:30:30.000Z";

      await store.claimRefresh("2026-11-13T15:30:00.000Z", until);
      await store.releaseRefresh(until);
      expect(
        await store.claimRefresh(
          "2026-11-13T15:30:01.000Z",
          "2026-11-13T15:30:31.000Z",
        ),
      ).not.toBeNull();
    });

    it("has nothing to claim without a connection", async () => {
      const store = createStore();
      await store.deleteConnection();
      expect(
        await store.claimRefresh(
          "2026-11-13T15:30:00.000Z",
          "2026-11-13T15:30:30.000Z",
        ),
      ).toBeNull();
    });

    it("lists events newest first", async () => {
      const store = createStore();
      const first = randomUUID();
      const second = randomUUID();
      await store.recordEvent({
        eventId: first,
        kind: "connected",
        code: "connected",
        requestId: "req-1",
        occurredAt: "2026-11-13T15:00:00.000Z",
      });
      await store.recordEvent({
        eventId: second,
        kind: "access_refreshed",
        code: "access_refreshed",
        requestId: null,
        occurredAt: "2026-11-13T15:30:00.000Z",
      });

      const events = await store.listEvents(2);
      expect(events.map((event) => event.eventId)).toEqual([second, first]);
    });
  });
}
