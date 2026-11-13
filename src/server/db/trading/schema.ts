import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Schema de la base de trading
 * ([ADR 0076](../../../../docs/architecture/adr/0076-schwab-read-only-account-trading-journal.md)).
 *
 * Vive aparte del de análisis (`src/server/db/schema.ts`) y migra a su propia
 * carpeta, `drizzle-trading/`, con `pnpm db:trading:generate`. Ninguna tabla
 * cruza las dos bases: cruzar una posición con su valuación se hace en la
 * aplicación.
 *
 * `F11-02` creó la base y el rol de runtime (migración `0000`); `F11-03` suma la
 * conexión con Schwab y el presupuesto de sus fuentes.
 */

function instant(name: string) {
  return timestamp(name, { withTimezone: true, mode: "date" });
}

const bytes = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const sourceStatus = pgEnum("source_status", ["enabled", "disabled"]);

/**
 * Consumo diario de las fuentes de Schwab (ADR 0020 y 0076). Es la misma tabla
 * que la de análisis, en esta base: el presupuesto de la cuenta no puede
 * depender de que la base de análisis responda.
 */
export const sourceBudgets = pgTable(
  "source_budgets",
  {
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    usageOn: date("usage_on", { mode: "string" }).notNull(),
    requests: integer("requests").notNull(),
    firstRequestAt: instant("first_request_at").notNull(),
    lastRequestAt: instant("last_request_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sourceId, table.usageOn],
      name: "source_budgets_pkey",
    }),
    check("source_budgets_requests_check", sql`${table.requests} >= 0`),
    check(
      "source_budgets_timeline_check",
      sql`${table.lastRequestAt} >= ${table.firstRequestAt}`,
    ),
  ],
);

/** Kill switch y tope bajado por el owner, append-only con `superseded_at`. */
export const sourceControls = pgTable(
  "source_controls",
  {
    controlId: uuid("control_id").primaryKey(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    status: sourceStatus("status").notNull(),
    dailyRequestLimit: integer("daily_request_limit"),
    dailySpendLimitNanoUsd: bigint("daily_spend_limit_nano_usd", {
      mode: "number",
    }),
    reason: varchar("reason", { length: 240 }).notNull(),
    actor: varchar("actor", { length: 128 }).notNull(),
    recordedAt: instant("recorded_at").notNull(),
    supersededAt: instant("superseded_at"),
  },
  (table) => [
    uniqueIndex("source_controls_current_uidx")
      .on(table.sourceId)
      .where(sql`${table.supersededAt} is null`),
    index("source_controls_source_idx").on(table.sourceId, table.recordedAt),
    check(
      "source_controls_limit_check",
      sql`${table.dailyRequestLimit} is null or ${table.dailyRequestLimit} >= 0`,
    ),
    check(
      "source_controls_spend_limit_check",
      sql`${table.dailySpendLimitNanoUsd} is null or ${table.dailySpendLimitNanoUsd} >= 0`,
    ),
    check(
      "source_controls_timeline_check",
      sql`${table.supersededAt} is null or ${table.supersededAt} >= ${table.recordedAt}`,
    ),
    check(
      "source_controls_actor_check",
      sql`${table.actor} ~ '^[A-Za-z0-9._:@/-]{1,128}$'`,
    ),
  ],
);

/**
 * Un `state` de OAuth emitido por `connectSchwab` (ADR 0076, sección 6). Sólo su
 * SHA-256: el valor viaja en la cookie y en el query, nunca en la base. Se
 * consume una vez, dentro de su vida.
 */
export const schwabOAuthStates = pgTable(
  "schwab_oauth_states",
  {
    stateHash: bytes("state_hash").primaryKey(),
    createdAt: instant("created_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    consumedAt: instant("consumed_at"),
  },
  (table) => [
    check(
      "schwab_oauth_states_hash_check",
      sql`octet_length(${table.stateHash}) = 32`,
    ),
    check(
      "schwab_oauth_states_lifetime_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "schwab_oauth_states_consumed_check",
      sql`${table.consumedAt} is null or ${table.consumedAt} >= ${table.createdAt}`,
    ),
    index("schwab_oauth_states_expires_idx").on(table.expiresAt),
  ],
);

/**
 * La conexión con Schwab: una sola fila, la del owner. Los tokens van en sobres
 * AES-256-GCM (`schwab-token-envelope-1.0.0`) y nunca en claro. El vencimiento
 * del refresh token se fija al autorizar y no se mueve al renovar
 * (`schwab-refresh-lifetime-1.0.0`).
 */
export const schwabConnections = pgTable(
  "schwab_connections",
  {
    connectionId: varchar("connection_id", { length: 16 }).primaryKey(),
    accessEnvelope: bytes("access_envelope").notNull(),
    accessExpiresAt: instant("access_expires_at").notNull(),
    refreshEnvelope: bytes("refresh_envelope").notNull(),
    authorizedAt: instant("authorized_at").notNull(),
    refreshExpiresAt: instant("refresh_expires_at").notNull(),
    envelopeVersion: varchar("envelope_version", { length: 64 }).notNull(),
    updatedAt: instant("updated_at").notNull(),
    /**
     * Reclamo de la renovación del access token, con vencimiento: quien lo toma
     * renueva y los demás esperan releyendo. No es un lock de transacción, que
     * retendría la única conexión del runtime mientras se llama a Schwab.
     */
    refreshClaimedUntil: instant("refresh_claimed_until"),
  },
  (table) => [
    check(
      "schwab_connections_owner_check",
      sql`${table.connectionId} = 'owner'`,
    ),
    check(
      "schwab_connections_refresh_lifetime_check",
      sql`${table.refreshExpiresAt} > ${table.authorizedAt}`,
    ),
    check(
      "schwab_connections_timeline_check",
      sql`${table.updatedAt} >= ${table.authorizedAt}`,
    ),
  ],
);

export const schwabConnectionEventKind = pgEnum(
  "schwab_connection_event_kind",
  [
    "connected",
    "access_refreshed",
    "refresh_failed",
    "exchange_failed",
    "callback_rejected",
    "disconnected",
  ],
);

/**
 * Log append-only de la conexión (`TM-16`): conectar, renovar, fallar y
 * desconectar, con un código cerrado y el `request_id` del pedido. Nunca un
 * token, un código de autorización ni un `state`.
 */
export const schwabConnectionEvents = pgTable(
  "schwab_connection_events",
  {
    eventId: uuid("event_id").primaryKey(),
    kind: schwabConnectionEventKind("kind").notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    requestId: varchar("request_id", { length: 64 }),
    occurredAt: instant("occurred_at").notNull(),
    detail: text("detail"),
  },
  (table) => [
    index("schwab_connection_events_occurred_idx").on(table.occurredAt),
    check(
      "schwab_connection_events_code_check",
      sql`${table.code} ~ '^[a-z0-9_:.-]{1,64}$'`,
    ),
    check(
      "schwab_connection_events_detail_check",
      sql`${table.detail} is null or length(${table.detail}) <= 512`,
    ),
  ],
);
