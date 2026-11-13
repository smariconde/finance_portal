import "server-only";

import { and, desc, eq, gt, isNull, lt, lte, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type {
  SchwabConnectionEvent,
  SchwabConnectionStore,
  StoredSchwabConnection,
} from "@/modules/trading/application/schwab-connection-store";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

const OWNER = "owner";

function toStored(
  row: typeof schema.schwabConnections.$inferSelect,
): StoredSchwabConnection {
  return {
    accessEnvelope: Buffer.from(row.accessEnvelope),
    accessExpiresAt: row.accessExpiresAt.toISOString(),
    refreshEnvelope: Buffer.from(row.refreshEnvelope),
    authorizedAt: row.authorizedAt.toISOString(),
    refreshExpiresAt: row.refreshExpiresAt.toISOString(),
    envelopeVersion: row.envelopeVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Conexión con Schwab en la base de trading (ADR 0076). Cada operación que
 * decide algo —consumir un `state`, reclamar una renovación, escribirla— es
 * una sola sentencia condicionada, sin transacción abierta mientras se llama a
 * Schwab: el runtime tiene una sola conexión.
 */
export function createPostgresSchwabConnectionStore(
  database: Database,
): SchwabConnectionStore {
  return {
    async issueState({ stateHash, createdAt, expiresAt }) {
      const created = new Date(createdAt);
      await database
        .delete(schema.schwabOAuthStates)
        .where(
          lt(
            schema.schwabOAuthStates.expiresAt,
            new Date(created.getTime() - 24 * 60 * 60 * 1000),
          ),
        );
      await database.insert(schema.schwabOAuthStates).values({
        stateHash,
        createdAt: created,
        expiresAt: new Date(expiresAt),
        consumedAt: null,
      });
    },
    async consumeState(stateHash, now) {
      const at = new Date(now);
      const rows = await database
        .update(schema.schwabOAuthStates)
        .set({ consumedAt: at })
        .where(
          and(
            eq(schema.schwabOAuthStates.stateHash, stateHash),
            isNull(schema.schwabOAuthStates.consumedAt),
            gt(schema.schwabOAuthStates.expiresAt, at),
          ),
        )
        .returning({ stateHash: schema.schwabOAuthStates.stateHash });
      return rows.length === 1;
    },
    async readConnection() {
      const [row] = await database
        .select()
        .from(schema.schwabConnections)
        .where(eq(schema.schwabConnections.connectionId, OWNER))
        .limit(1);
      return row ? toStored(row) : null;
    },
    async saveConnection(connection) {
      const values = {
        accessEnvelope: connection.accessEnvelope,
        accessExpiresAt: new Date(connection.accessExpiresAt),
        refreshEnvelope: connection.refreshEnvelope,
        authorizedAt: new Date(connection.authorizedAt),
        refreshExpiresAt: new Date(connection.refreshExpiresAt),
        envelopeVersion: connection.envelopeVersion,
        updatedAt: new Date(connection.updatedAt),
        refreshClaimedUntil: null,
      };
      await database
        .insert(schema.schwabConnections)
        .values({ connectionId: OWNER, ...values })
        .onConflictDoUpdate({
          target: schema.schwabConnections.connectionId,
          set: values,
        });
    },
    async deleteConnection() {
      await database
        .delete(schema.schwabConnections)
        .where(eq(schema.schwabConnections.connectionId, OWNER));
    },
    async claimRefresh(now, until) {
      const at = new Date(now);
      const [row] = await database
        .update(schema.schwabConnections)
        .set({ refreshClaimedUntil: new Date(until) })
        .where(
          and(
            eq(schema.schwabConnections.connectionId, OWNER),
            or(
              isNull(schema.schwabConnections.refreshClaimedUntil),
              lte(schema.schwabConnections.refreshClaimedUntil, at),
            ),
          ),
        )
        .returning();
      return row ? toStored(row) : null;
    },
    async completeRefresh(claimedUntil, renewed) {
      const rows = await database
        .update(schema.schwabConnections)
        .set({
          accessEnvelope: renewed.accessEnvelope,
          accessExpiresAt: new Date(renewed.accessExpiresAt),
          refreshEnvelope: renewed.refreshEnvelope,
          updatedAt: new Date(renewed.updatedAt),
          refreshClaimedUntil: null,
        })
        .where(
          and(
            eq(schema.schwabConnections.connectionId, OWNER),
            eq(
              schema.schwabConnections.refreshClaimedUntil,
              new Date(claimedUntil),
            ),
          ),
        )
        .returning({ connectionId: schema.schwabConnections.connectionId });
      return rows.length === 1;
    },
    async releaseRefresh(claimedUntil) {
      await database
        .update(schema.schwabConnections)
        .set({ refreshClaimedUntil: null })
        .where(
          and(
            eq(schema.schwabConnections.connectionId, OWNER),
            eq(
              schema.schwabConnections.refreshClaimedUntil,
              new Date(claimedUntil),
            ),
          ),
        );
    },
    async recordEvent(event) {
      await database.insert(schema.schwabConnectionEvents).values({
        eventId: event.eventId,
        kind: event.kind,
        code: event.code,
        requestId: event.requestId,
        occurredAt: new Date(event.occurredAt),
        detail: null,
      });
    },
    async listEvents(limit) {
      const rows = await database
        .select()
        .from(schema.schwabConnectionEvents)
        .orderBy(desc(schema.schwabConnectionEvents.occurredAt))
        .limit(Math.min(Math.max(limit, 1), 200));
      return rows.map((row): SchwabConnectionEvent => ({
        eventId: row.eventId,
        kind: row.kind,
        code: row.code,
        requestId: row.requestId,
        occurredAt: row.occurredAt.toISOString(),
      }));
    },
  };
}
