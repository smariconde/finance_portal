import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const snapshotManifestStatus = pgEnum("snapshot_manifest_status", [
  "stored",
  "not_provided",
  "license_restricted",
]);

export const datasetSnapshots = pgTable(
  "dataset_snapshots",
  {
    snapshotId: uuid("snapshot_id").primaryKey(),
    datasetId: varchar("dataset_id", { length: 128 }).notNull(),
    version: varchar("version", { length: 64 }).notNull(),
    validFrom: timestamp("valid_from", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true, mode: "date" }),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    supersededAt: timestamp("superseded_at", {
      withTimezone: true,
      mode: "date",
    }),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>(),
    manifestStatus: snapshotManifestStatus("manifest_status").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    uniqueIndex("dataset_snapshots_dataset_version_uidx").on(
      table.datasetId,
      table.version,
    ),
    index("dataset_snapshots_temporal_idx").on(
      table.datasetId,
      table.validFrom,
      table.availableAt,
    ),
    check(
      "dataset_snapshots_valid_interval_check",
      sql`${table.validTo} is null or ${table.validFrom} < ${table.validTo}`,
    ),
    check(
      "dataset_snapshots_manifest_status_check",
      sql`(${table.manifestStatus} = 'stored' and ${table.manifest} is not null) or (${table.manifestStatus} <> 'stored' and ${table.manifest} is null)`,
    ),
    check(
      "dataset_snapshots_content_hash_check",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

/**
 * `owner_accepted` (ADR 0026) dice que ninguna fuente concede el uso y que el
 * owner decidió proceder igual. Existe para que `allowed` siga significando «una
 * fuente primaria lo cubre»: si los dos casos compartieran valor, el gate de
 * derechos dejaría de distinguirlos.
 */
export const sourceRightsDecision = pgEnum("source_rights_decision", [
  "unknown",
  "allowed",
  "owner_accepted",
  "restricted",
]);

export const sourceTechnicalStatus = pgEnum("source_technical_status", [
  "proposed",
  "technical_reviewed",
  "spike_ready",
  "integrated",
  "suspended",
]);

export const sourceApprovalStatus = pgEnum("source_approval_status", [
  "rights_unreviewed",
  "rights_review_pending",
  "approved_for_spike",
  "approved_personal",
  "approved_public_demo",
  "rejected",
]);

export const sourceAuthentication = pgEnum("source_authentication", [
  "none",
  "api_key",
  "account",
  "other",
]);

const emptyJsonArray = sql`'[]'::jsonb`;

const SHA256_HEX = /^[a-f0-9]{64}$/u;

/**
 * SHA-256 en sus 32 bytes. El dominio lo sigue viendo en hex, como el resto de
 * los hashes: la conversión ocurre en este borde y nunca adivina un valor mal
 * formado (ADR 0018).
 */
const sha256 = customType<{ data: string; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver(value) {
    if (!SHA256_HEX.test(value)) {
      throw new TypeError("A SHA-256 column takes 64 lowercase hex digits.");
    }

    return Buffer.from(value, "hex");
  },
  fromDriver(value) {
    return Buffer.from(value).toString("hex");
  },
});

/**
 * Registro de fuentes. Cada derecho es una columna propia con default
 * `unknown`: omitir un derecho bloquea la ingesta en vez de habilitarla.
 */
export const sourceRegistry = pgTable(
  "source_registry",
  {
    sourceId: varchar("source_id", { length: 64 }).primaryKey(),
    displayName: varchar("display_name", { length: 256 }).notNull(),
    owner: varchar("owner", { length: 256 }).notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    documentationUrls: jsonb("documentation_urls")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    datasets: jsonb("datasets")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    endpoints: jsonb("endpoints")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    authentication: sourceAuthentication("authentication").notNull(),
    applicablePlan: varchar("applicable_plan", { length: 256 }),
    rateLimit: varchar("rate_limit", { length: 256 }),
    attribution: varchar("attribution", { length: 256 }),
    expectedCadence: varchar("expected_cadence", { length: 256 }).notNull(),
    freshnessTarget: varchar("freshness_target", { length: 256 }).notNull(),
    timezone: varchar("timezone", { length: 256 }),
    units: jsonb("units").$type<string[]>().notNull().default(emptyJsonArray),
    currencies: jsonb("currencies")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    parserVersion: varchar("parser_version", { length: 32 }),
    fixturePolicy: text("fixture_policy").notNull(),
    fallbackSourceIds: jsonb("fallback_source_ids")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    personalUseRight: sourceRightsDecision("personal_use_right")
      .notNull()
      .default("unknown"),
    automatedAccessRight: sourceRightsDecision("automated_access_right")
      .notNull()
      .default("unknown"),
    rawStorageRight: sourceRightsDecision("raw_storage_right")
      .notNull()
      .default("unknown"),
    normalizedStorageRight: sourceRightsDecision("normalized_storage_right")
      .notNull()
      .default("unknown"),
    derivedStorageRight: sourceRightsDecision("derived_storage_right")
      .notNull()
      .default("unknown"),
    publicDisplayRight: sourceRightsDecision("public_display_right")
      .notNull()
      .default("unknown"),
    exportRight: sourceRightsDecision("export_right")
      .notNull()
      .default("unknown"),
    aiTransferRight: sourceRightsDecision("ai_transfer_right")
      .notNull()
      .default("unknown"),
    technicalStatus: sourceTechnicalStatus("technical_status").notNull(),
    approvalStatus: sourceApprovalStatus("approval_status")
      .notNull()
      .default("rights_unreviewed"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    rightsReviewedAt: timestamp("rights_reviewed_at", {
      withTimezone: true,
      mode: "date",
    }),
    rightsReviewDueAt: timestamp("rights_review_due_at", {
      withTimezone: true,
      mode: "date",
    }),
    reviewEvidence: jsonb("review_evidence")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    retentionClasses: jsonb("retention_classes")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    quotaPolicyId: varchar("quota_policy_id", { length: 256 }),
    ownerNotes: text("owner_notes").notNull().default(""),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("source_registry_approval_idx").on(
      table.approvalStatus,
      table.technicalStatus,
    ),
    check(
      "source_registry_source_id_check",
      sql`${table.sourceId} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "source_registry_rights_review_check",
      sql`${table.approvalStatus} not in ('approved_for_spike', 'approved_personal', 'approved_public_demo') or ${table.rightsReviewedAt} is not null`,
    ),
    check(
      "source_registry_public_display_check",
      sql`${table.approvalStatus} <> 'approved_public_demo' or ${table.publicDisplayRight} = 'allowed'`,
    ),
  ],
);

export const ingestionRunStatus = pgEnum("ingestion_run_status", [
  "running",
  "succeeded",
  "partial",
  "empty",
  "duplicate",
  "quarantined",
  "failed",
]);

export const ingestionFailureCode = pgEnum("ingestion_failure_code", [
  "source_not_registered",
  "dataset_not_registered",
  "rights_not_approved",
  "provider_error",
  "provider_contract_invalid",
  "unknown_error",
]);

/**
 * Corridas de ingesta: registro append-only que explica qué se intentó, con qué
 * parser, con qué resultado y con qué error seguro (`TM-16`). No guarda payload
 * ni mensajes sin redactar.
 */
export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    runId: uuid("run_id").primaryKey(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    datasetId: varchar("dataset_id", { length: 128 }).notNull(),
    parserVersion: varchar("parser_version", { length: 32 }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    // Fecha calendaria sin hora: no se convierte a medianoche UTC.
    requestedAsOf: date("requested_as_of", { mode: "string" }),
    // Publicación de la fuente solicitada: distingue una enmienda posterior de
    // un replay exacto del mismo `as_of`.
    requestedVintage: date("requested_vintage", { mode: "string" }),
    cursor: varchar("cursor", { length: 512 }),
    nextCursor: varchar("next_cursor", { length: 512 }),
    // Sujeto en el esquema de la fuente (un CIK): una corrida por documento de
    // empresa no se explica sin él. `null` en fuentes paginadas por dataset.
    subjectKey: varchar("subject_key", { length: 128 }),
    // Qué parte del documento se ingirió. Distingue «la empresa no lo reporta»
    // de «esta corrida no fue a buscarlo».
    selectionVersion: varchar("selection_version", { length: 64 }),
    // Ancla de una selección que depende del documento (la ventana de historia
    // de la SEC): con la versión, dice qué períodos se fueron a buscar.
    selectionAnchorOn: date("selection_anchor_on", { mode: "string" }),
    status: ingestionRunStatus("status").notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    fetchedCount: integer("fetched_count").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    contentHash: text("content_hash"),
    failureCode: ingestionFailureCode("failure_code"),
    failureMessage: varchar("failure_message", { length: 240 }),
    failureRetryable: boolean("failure_retryable"),
    qualityFlags: jsonb("quality_flags")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    replayOfRunId: uuid("replay_of_run_id"),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ingestion_runs_source_dataset_idx").on(
      table.sourceId,
      table.datasetId,
      table.startedAt,
    ),
    index("ingestion_runs_idempotency_idx").on(table.idempotencyKey),
    index("ingestion_runs_subject_idx").on(
      table.sourceId,
      table.datasetId,
      table.subjectKey,
      table.startedAt,
    ),
    // A lo sumo una corrida publicable por clave: un replay exacto no vuelve a
    // publicar, pero los reintentos no publicables sí quedan registrados.
    uniqueIndex("ingestion_runs_publishable_idempotency_uidx")
      .on(table.idempotencyKey)
      .where(sql`${table.status} in ('succeeded', 'partial')`),
    check(
      "ingestion_runs_counts_non_negative_check",
      sql`${table.fetchedCount} >= 0 and ${table.acceptedCount} >= 0 and ${table.rejectedCount} >= 0 and ${table.duplicateCount} >= 0`,
    ),
    check(
      "ingestion_runs_counts_balance_check",
      sql`${table.status} in ('running', 'failed') or ${table.acceptedCount} + ${table.rejectedCount} + ${table.duplicateCount} = ${table.fetchedCount}`,
    ),
    check(
      "ingestion_runs_open_run_check",
      sql`(${table.status} = 'running') = (${table.finishedAt} is null)`,
    ),
    check(
      "ingestion_runs_finished_after_started_check",
      sql`${table.finishedAt} is null or ${table.finishedAt} >= ${table.startedAt}`,
    ),
    check(
      "ingestion_runs_failure_check",
      sql`(${table.status} = 'failed') = (${table.failureCode} is not null and ${table.failureMessage} is not null and ${table.failureRetryable} is not null)`,
    ),
    check(
      "ingestion_runs_content_hash_check",
      sql`case when ${table.status} in ('running', 'failed') then ${table.contentHash} is null else ${table.contentHash} ~ '^[a-f0-9]{64}$' end`,
    ),
    check(
      "ingestion_runs_idempotency_key_check",
      sql`${table.idempotencyKey} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "ingestion_runs_selection_anchor_check",
      sql`${table.selectionAnchorOn} is null or ${table.selectionVersion} is not null`,
    ),
  ],
);

export const ingestionJobKind = pgEnum("ingestion_job_kind", [
  "sec_companyfacts_backfill",
  // Refresh del conjunto seguido (ADR 0021). Es un kind propio y no un backfill
  // con otro plan: el item empieza por un sondeo y sólo a veces baja.
  "sec_companyfacts_refresh",
  // Precios de un sector al abrir su matriz (ADR 0030): sólo lo atrasado.
  "yahoo_prices_refresh",
]);

export const ingestionJobStatus = pgEnum("ingestion_job_status", [
  "open",
  "paused",
  "completed",
  "cancelled",
]);

export const ingestionJobItemStatus = pgEnum("ingestion_job_item_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "poisoned",
]);

export const ingestionJobFailureCode = pgEnum("ingestion_job_failure_code", [
  "ingestion_failed",
  "subject_rejected",
  "executor_error",
  "lease_expired",
  "source_signal",
]);

export const ingestionJobEventType = pgEnum("ingestion_job_event_type", [
  "job_created",
  "job_paused",
  "job_resumed",
  "job_cancelled",
  "job_completed",
  "job_reopened",
  "job_backoff",
  "lease_acquired",
  "lease_taken_over",
  "lease_released",
  "lease_force_released",
  "item_started",
  "item_completed",
  "item_failed",
  "item_retry_scheduled",
  "item_poisoned",
  "item_deferred",
  "item_recovered",
  "item_requeued",
]);

function instant(name: string) {
  return timestamp(name, { withTimezone: true, mode: "date" });
}

/**
 * Jobs durables de ingesta (ADR 0015): un plan fijo de sujetos que se procesa en
 * orden. `cursor` es el ordinal del primer item no terminal.
 *
 * Los instantes los escribe la aplicación con su reloj inyectado, no
 * `defaultNow()`: así un test mueve el tiempo y una fila nunca mezcla dos relojes.
 * El índice único parcial es la idempotencia del pedido (`TM-11`): a lo sumo un
 * job abierto o pausado por plan.
 */
export const ingestionJobs = pgTable(
  "ingestion_jobs",
  {
    jobId: uuid("job_id").primaryKey(),
    jobKind: ingestionJobKind("job_kind").notNull(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    datasetId: varchar("dataset_id", { length: 128 }).notNull(),
    parserVersion: varchar("parser_version", { length: 32 }).notNull(),
    selectionVersion: varchar("selection_version", { length: 64 }),
    planHash: text("plan_hash").notNull(),
    itemCount: integer("item_count").notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    status: ingestionJobStatus("status").notNull(),
    cursor: integer("cursor").notNull(),
    notBefore: instant("not_before"),
    statusReason: varchar("status_reason", { length: 240 }),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    finishedAt: instant("finished_at"),
  },
  (table) => [
    uniqueIndex("ingestion_jobs_active_plan_uidx")
      .on(table.planHash)
      .where(sql`${table.status} in ('open', 'paused')`),
    index("ingestion_jobs_source_idx").on(
      table.sourceId,
      table.status,
      table.createdAt,
    ),
    check(
      "ingestion_jobs_plan_hash_check",
      sql`${table.planHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "ingestion_jobs_item_count_check",
      sql`${table.itemCount} between 1 and 10000`,
    ),
    check(
      "ingestion_jobs_max_attempts_check",
      sql`${table.maxAttempts} between 1 and 10`,
    ),
    check(
      "ingestion_jobs_cursor_check",
      sql`${table.cursor} between 0 and ${table.itemCount}`,
    ),
    check(
      "ingestion_jobs_finished_check",
      sql`(${table.status} in ('completed', 'cancelled')) = (${table.finishedAt} is not null)`,
    ),
    // Completo es exactamente «no queda nada»; abierto o pausado, «queda algo».
    check(
      "ingestion_jobs_completion_check",
      sql`case
        when ${table.status} = 'completed' then ${table.cursor} = ${table.itemCount}
        when ${table.status} = 'cancelled' then true
        else ${table.cursor} < ${table.itemCount}
      end`,
    ),
    check(
      "ingestion_jobs_timeline_check",
      sql`${table.updatedAt} >= ${table.createdAt} and (${table.finishedAt} is null or ${table.finishedAt} >= ${table.createdAt})`,
    ),
  ],
);

/**
 * Un item por sujeto del plan. `lease_token` es el cercado del intento en curso:
 * un item `running` cuyo token no es el del lease de su fuente es huérfano.
 */
export const ingestionJobItems = pgTable(
  "ingestion_job_items",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => ingestionJobs.jobId),
    ordinal: integer("ordinal").notNull(),
    subjectKey: varchar("subject_key", { length: 128 }).notNull(),
    status: ingestionJobItemStatus("status").notNull(),
    attempts: integer("attempts").notNull(),
    notBefore: instant("not_before"),
    leaseToken: uuid("lease_token"),
    startedAt: instant("started_at"),
    finishedAt: instant("finished_at"),
    ingestionRunId: uuid("ingestion_run_id").references(
      () => ingestionRuns.runId,
    ),
    failureCode: ingestionJobFailureCode("failure_code"),
    failureMessage: varchar("failure_message", { length: 240 }),
    failureRetryable: boolean("failure_retryable"),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "ingestion_job_items_pkey",
      columns: [table.jobId, table.ordinal],
    }),
    uniqueIndex("ingestion_job_items_subject_uidx").on(
      table.jobId,
      table.subjectKey,
    ),
    index("ingestion_job_items_running_idx")
      .on(table.jobId)
      .where(sql`${table.status} = 'running'`),
    check("ingestion_job_items_ordinal_check", sql`${table.ordinal} >= 0`),
    check("ingestion_job_items_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "ingestion_job_items_running_check",
      sql`(${table.status} = 'running') = (${table.leaseToken} is not null) and (${table.status} <> 'running' or ${table.startedAt} is not null)`,
    ),
    check(
      "ingestion_job_items_finished_check",
      sql`(${table.status} in ('completed', 'failed', 'poisoned')) = (${table.finishedAt} is not null)`,
    ),
    check(
      "ingestion_job_items_completed_run_check",
      sql`${table.status} <> 'completed' or ${table.ingestionRunId} is not null`,
    ),
    check(
      "ingestion_job_items_failure_check",
      sql`(${table.failureCode} is null) = (${table.failureMessage} is null) and (${table.failureCode} is null) = (${table.failureRetryable} is null)
        and (${table.status} not in ('failed', 'poisoned') or ${table.failureCode} is not null)
        and (${table.status} <> 'pending' or ${table.attempts} = 0 or ${table.failureCode} is not null)`,
    ),
    check(
      "ingestion_job_items_not_before_check",
      sql`${table.status} = 'pending' or ${table.notBefore} is null`,
    ),
  ],
);

/**
 * Un lease por fuente: el permiso para gastar su cuota. Vencer habilita que otro
 * proceso lo tome; mientras nadie lo tome, el token sigue siendo del holder.
 */
export const ingestionSourceLeases = pgTable(
  "ingestion_source_leases",
  {
    sourceId: varchar("source_id", { length: 64 }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => ingestionJobs.jobId),
    holder: varchar("holder", { length: 128 }).notNull(),
    leaseToken: uuid("lease_token").notNull(),
    acquiredAt: instant("acquired_at").notNull(),
    heartbeatAt: instant("heartbeat_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
  },
  (table) => [
    check(
      "ingestion_source_leases_timeline_check",
      sql`${table.acquiredAt} <= ${table.heartbeatAt} and ${table.heartbeatAt} < ${table.expiresAt}`,
    ),
    check(
      "ingestion_source_leases_holder_check",
      sql`${table.holder} ~ '^[A-Za-z0-9._:@/-]{1,128}$'`,
    ),
  ],
);

/**
 * Bitácora append-only de jobs (`TM-16`): quién tomó, soltó o forzó un lease, qué
 * decidió cada intento y cada acción manual con su motivo. `event_sequence` es el
 * orden total; con un reloj fijo varios eventos comparten instante.
 */
export const ingestionJobEvents = pgTable(
  "ingestion_job_events",
  {
    eventSequence: bigint("event_sequence", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => ingestionJobs.jobId),
    ordinal: integer("ordinal"),
    eventType: ingestionJobEventType("event_type").notNull(),
    actor: varchar("actor", { length: 128 }).notNull(),
    leaseToken: uuid("lease_token"),
    occurredAt: instant("occurred_at").notNull(),
    detail: jsonb("detail")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    index("ingestion_job_events_job_idx").on(table.jobId, table.eventSequence),
    check(
      "ingestion_job_events_ordinal_check",
      sql`${table.ordinal} is null or ${table.ordinal} >= 0`,
    ),
    check(
      "ingestion_job_events_detail_check",
      sql`jsonb_typeof(${table.detail}) = 'object'`,
    ),
    check(
      "ingestion_job_events_actor_check",
      sql`${table.actor} ~ '^[A-Za-z0-9._:@/-]{1,128}$'`,
    ),
  ],
);

export const ingestionSourceStatus = pgEnum("ingestion_source_status", [
  "enabled",
  "disabled",
]);

/**
 * Consumo diario de cada fuente (ADR 0020). Una fila por fuente y día UTC, y el
 * contador se gasta al intentar.
 *
 * Es lo que hace que el tope sea de la **fuente** y no del proceso: el
 * presupuesto por corrida se repone con cada comando, y éste no. El incremento
 * se hace condicionado al tope en una sola sentencia, así que dos procesos
 * concurrentes no pueden pasarse: PostgreSQL serializa el upsert sobre la misma
 * clave y el que llega tarde no recibe fila.
 */
export const ingestionSourceBudgets = pgTable(
  "ingestion_source_budgets",
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
      name: "ingestion_source_budgets_pkey",
    }),
    check(
      "ingestion_source_budgets_requests_check",
      sql`${table.requests} >= 0`,
    ),
    check(
      "ingestion_source_budgets_timeline_check",
      sql`${table.lastRequestAt} >= ${table.firstRequestAt}`,
    ),
  ],
);

/**
 * Estado operativo de una fuente: el kill switch y, si el owner lo bajó, el tope
 * del día (ADR 0020).
 *
 * Append-only con `superseded_at`, como las versiones del grafo: la fila abierta
 * es el estado vigente y las cerradas son la historia de quién cambió qué y por
 * qué (`TM-16`). No es una columna de `source_registry` porque esa tabla es un
 * documento declarado que `syncDeclaredSourceRegistry` reescribe desde el
 * código: una decisión operativa ahí duraría hasta el próximo comando.
 *
 * El tope guardado sólo puede **bajar** el declarado; subir la cuota de una
 * fuente es un diff revisable, y el dominio lo resuelve con un mínimo.
 */
export const ingestionSourceControls = pgTable(
  "ingestion_source_controls",
  {
    controlId: uuid("control_id").primaryKey(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    status: ingestionSourceStatus("status").notNull(),
    dailyRequestLimit: integer("daily_request_limit"),
    // Tope de gasto del día para una fuente que cobra por llamada (ADR 0033).
    dailySpendLimitNanoUsd: bigint("daily_spend_limit_nano_usd", {
      mode: "number",
    }),
    reason: varchar("reason", { length: 240 }).notNull(),
    actor: varchar("actor", { length: 128 }).notNull(),
    recordedAt: instant("recorded_at").notNull(),
    supersededAt: instant("superseded_at"),
  },
  (table) => [
    // A lo sumo un control vigente por fuente: dos serían dos respuestas
    // simultáneas a «¿se puede hablar con esta fuente?».
    uniqueIndex("ingestion_source_controls_current_uidx")
      .on(table.sourceId)
      .where(sql`${table.supersededAt} is null`),
    index("ingestion_source_controls_source_idx").on(
      table.sourceId,
      table.recordedAt,
    ),
    check(
      "ingestion_source_controls_limit_check",
      sql`${table.dailyRequestLimit} is null or ${table.dailyRequestLimit} >= 0`,
    ),
    check(
      "ingestion_source_controls_spend_limit_check",
      sql`${table.dailySpendLimitNanoUsd} is null or ${table.dailySpendLimitNanoUsd} >= 0`,
    ),
    check(
      "ingestion_source_controls_timeline_check",
      sql`${table.supersededAt} is null or ${table.supersededAt} >= ${table.recordedAt}`,
    ),
    check(
      "ingestion_source_controls_actor_check",
      sql`${table.actor} ~ '^[A-Za-z0-9._:@/-]{1,128}$'`,
    ),
  ],
);

export const aiSpendStatus = pgEnum("ai_spend_status", [
  "reserved",
  "charged",
  "uncharged",
  "unsettled",
]);

export const aiSpendPurpose = pgEnum("ai_spend_purpose", ["task", "eval"]);

/**
 * Libro de gasto en dólares de la capa IA (ADR 0033): una fila por intento de
 * llamar a un modelo.
 *
 * La fila se escribe **antes** de la llamada con su peor caso (`reserved`) y se
 * liquida después con lo que pasó. Lo que cuenta contra los topes es lo cobrado
 * si se conoce y la reserva si no: una llamada en vuelo, un proceso muerto o un
 * transporte cortado siguen contando su peor caso, porque nadie sabe si se
 * cobraron. Es también la métrica de la capa —modelo pedido y respondido,
 * tokens, latencia, motivo— y por eso no se borra.
 *
 * Los importes son nanodólares enteros: los precios de la escalera son enteros
 * en esa unidad y la suma no pasa por un decimal.
 *
 * `purpose` separa los evals de `F5-07` (ADR 0035): cuentan contra los mismos
 * topes, pero no son la métrica de producción.
 */
export const aiSpendLedger = pgTable(
  "ai_spend_ledger",
  {
    reservationId: uuid("reservation_id").primaryKey(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    taskRunId: uuid("task_run_id").notNull(),
    purpose: aiSpendPurpose("purpose").notNull().default("task"),
    taskVersion: varchar("task_version", { length: 64 }).notNull(),
    ladderVersion: varchar("ladder_version", { length: 64 }).notNull(),
    rung: integer("rung").notNull(),
    requestedModel: varchar("requested_model", { length: 128 }).notNull(),
    respondedModel: varchar("responded_model", { length: 128 }),
    spendOn: date("spend_on", { mode: "string" }).notNull(),
    status: aiSpendStatus("status").notNull(),
    reservedNanoUsd: bigint("reserved_nano_usd", { mode: "number" }).notNull(),
    chargedNanoUsd: bigint("charged_nano_usd", { mode: "number" }),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    latencyMs: integer("latency_ms"),
    outcome: varchar("outcome", { length: 64 }),
    reservedAt: instant("reserved_at").notNull(),
    settledAt: instant("settled_at"),
  },
  (table) => [
    index("ai_spend_ledger_day_idx").on(table.sourceId, table.spendOn),
    index("ai_spend_ledger_task_idx").on(table.taskRunId, table.reservedAt),
    check("ai_spend_ledger_reserved_check", sql`${table.reservedNanoUsd} > 0`),
    check("ai_spend_ledger_rung_check", sql`${table.rung} between 1 and 16`),
    // Una reserva abierta no tiene liquidación, y una liquidada sí.
    check(
      "ai_spend_ledger_settlement_check",
      sql`(${table.status} = 'reserved') = (${table.settledAt} is null)`,
    ),
    // Un cobro se registra exactamente cuando la fila dice que se cobró.
    check(
      "ai_spend_ledger_charge_check",
      sql`(${table.status} = 'charged') = (${table.chargedNanoUsd} is not null) and (${table.chargedNanoUsd} is null or ${table.chargedNanoUsd} >= 0)`,
    ),
    check(
      "ai_spend_ledger_timeline_check",
      sql`${table.settledAt} is null or ${table.settledAt} >= ${table.reservedAt}`,
    ),
    check(
      "ai_spend_ledger_day_check",
      sql`${table.spendOn} = (${table.reservedAt} at time zone 'UTC')::date`,
    ),
  ],
);

export const industryResolutionOutcome = pgEnum("industry_resolution_outcome", [
  "resolved",
  "abstained",
  "stopped",
]);

/**
 * Resoluciones de industria de la capa IA (`F5-03`, ADR 0033): una fila por
 * vez que se le preguntó a la escalera, con la respuesta que haya dado.
 *
 * Se guarda también la abstención y el freno, no sólo el acierto: una empresa
 * que sigue `ambiguous` tiene que poder decir por qué. `resolution_id` es el
 * `task_run_id` de sus intentos en `ai_spend_ledger`, así que el costo de cada
 * resolución se lee de ahí y no se copia. Una resolución aceptada se publica
 * aparte, como aserción en `classification_assignments`; esta tabla es su
 * evidencia, y no se borra.
 */
export const industryResolutions = pgTable(
  "industry_resolutions",
  {
    resolutionId: uuid("resolution_id").primaryKey(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    cik: char("cik", { length: 10 }).notNull(),
    sic: char("sic", { length: 4 }).notNull(),
    candidates: jsonb("candidates").$type<string[]>().notNull(),
    taskVersion: varchar("task_version", { length: 64 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 64 }).notNull(),
    ladderVersion: varchar("ladder_version", { length: 64 }).notNull(),
    sectionsVersion: varchar("sections_version", { length: 64 }).notNull(),
    outcome: industryResolutionOutcome("outcome").notNull(),
    industryKey: varchar("industry_key", { length: 64 }),
    confidence: varchar("confidence", { length: 8 }),
    rationale: text("rationale"),
    reason: varchar("reason", { length: 64 }),
    acceptedRung: integer("accepted_rung"),
    respondedModel: varchar("responded_model", { length: 128 }),
    citedEvidenceIds: jsonb("cited_evidence_ids").$type<string[]>().notNull(),
    resolvedAt: instant("resolved_at").notNull(),
    recordedAt: instant("recorded_at").notNull(),
  },
  (table) => [
    index("industry_resolutions_subject_idx").on(
      table.legalEntityId,
      table.resolvedAt,
    ),
    check(
      "industry_resolutions_outcome_check",
      sql`(${table.outcome} = 'resolved') = (${table.industryKey} is not null) and (${table.outcome} = 'resolved') = (${table.reason} is null)`,
    ),
    check(
      "industry_resolutions_confidence_check",
      sql`${table.confidence} is null or ${table.confidence} in ('high', 'medium', 'low')`,
    ),
    check(
      "industry_resolutions_timeline_check",
      sql`${table.recordedAt} >= ${table.resolvedAt}`,
    ),
  ],
);

/**
 * Cada extracto que se le mandó al modelo, con el documento de la SEC del que
 * salió y su hash. Es lo que el modelo pudo citar: una cita a un ID que no está
 * acá la rechazó la policy.
 */
export const industryResolutionEvidence = pgTable(
  "industry_resolution_evidence",
  {
    resolutionId: uuid("resolution_id").notNull(),
    evidenceId: varchar("evidence_id", { length: 8 }).notNull(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    section: varchar("section", { length: 32 }).notNull(),
    documentUrl: text("document_url").notNull(),
    /** `null` para un resultado de búsqueda web (`F5-04`): no tiene filing. */
    accessionNumber: varchar("accession_number", { length: 20 }),
    documentAcceptedAt: instant("document_accepted_at"),
    sha256: char("sha256", { length: 64 }).notNull(),
    byteLength: integer("byte_length").notNull(),
    truncated: boolean("truncated").notNull(),
    excerpt: text("excerpt").notNull(),
  },
  (table) => [
    // Un extracto de un filing nombra su filing; un resultado web, ninguno.
    check(
      "industry_resolution_evidence_filing_check",
      sql`(${table.section} = 'web_search') = (${table.accessionNumber} is null) and (${table.section} = 'web_search') = (${table.documentAcceptedAt} is null)`,
    ),
    primaryKey({
      name: "industry_resolution_evidence_pkey",
      columns: [table.resolutionId, table.evidenceId],
    }),
    foreignKey({
      name: "industry_resolution_evidence_resolution_fk",
      columns: [table.resolutionId],
      foreignColumns: [industryResolutions.resolutionId],
    }),
    check(
      "industry_resolution_evidence_bytes_check",
      sql`${table.byteLength} > 0`,
    ),
  ],
);

export const operationsMixOutcome = pgEnum("operations_mix_outcome", [
  "accepted",
  "abstained",
  "stopped",
]);

/**
 * Propuestas de mix de operaciones de la capa IA (`F5-05`, ADR 0034): una fila
 * por vez que se le preguntó a la escalera por la tabla geográfica de un 10-K.
 *
 * Como `industry_resolutions`, se guarda también la abstención y el freno.
 * `proposal_id` es el `task_run_id` de sus intentos en `ai_spend_ledger`. No
 * publica una aserción: la evaluación lee la aceptada más reciente al corte.
 * Es la evidencia de un supuesto de una corrida, y no se borra.
 */
export const operationsMixProposals = pgTable(
  "operations_mix_proposals",
  {
    proposalId: uuid("proposal_id").primaryKey(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    cik: char("cik", { length: 10 }).notNull(),
    accessionNumber: varchar("accession_number", { length: 20 }).notNull(),
    fiscalYearEnd: date("fiscal_year_end", { mode: "string" }).notNull(),
    taskVersion: varchar("task_version", { length: 64 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 64 }).notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    ladderVersion: varchar("ladder_version", { length: 64 }).notNull(),
    extractVersion: varchar("extract_version", { length: 64 }).notNull(),
    countryReleaseId: uuid("country_release_id").notNull(),
    regionReleaseId: uuid("region_release_id").notNull(),
    outcome: operationsMixOutcome("outcome").notNull(),
    unit: varchar("unit", { length: 16 }),
    printedTotal: varchar("printed_total", { length: 32 }),
    expectedRevenue: numeric("expected_revenue", { mode: "string" }).notNull(),
    confidence: varchar("confidence", { length: 8 }),
    rationale: text("rationale"),
    reason: varchar("reason", { length: 64 }),
    acceptedRung: integer("accepted_rung"),
    respondedModel: varchar("responded_model", { length: 128 }),
    proposedAt: instant("proposed_at").notNull(),
    recordedAt: instant("recorded_at").notNull(),
  },
  (table) => [
    index("operations_mix_proposals_subject_idx").on(
      table.legalEntityId,
      table.proposedAt,
    ),
    check(
      "operations_mix_proposals_outcome_check",
      sql`(${table.outcome} = 'accepted') = (${table.reason} is null) and (${table.outcome} = 'accepted') = (${table.unit} is not null and ${table.printedTotal} is not null)`,
    ),
    check(
      "operations_mix_proposals_unit_check",
      sql`${table.unit} is null or ${table.unit} in ('units', 'thousands', 'millions', 'billions')`,
    ),
    check(
      "operations_mix_proposals_confidence_check",
      sql`${table.confidence} is null or ${table.confidence} in ('high', 'medium', 'low')`,
    ),
    check(
      "operations_mix_proposals_accession_check",
      sql`${table.accessionNumber} ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'`,
    ),
    check(
      "operations_mix_proposals_timeline_check",
      sql`${table.recordedAt} >= ${table.proposedAt}`,
    ),
  ],
);

/**
 * Las líneas de una propuesta aceptada: la etiqueta y el monto como se
 * imprimieron, el monto exacto que leyó la policy, la base del mapeo y las
 * claves de Damodaran. Los pesos no se guardan: se recalculan de acá.
 */
export const operationsMixLines = pgTable(
  "operations_mix_lines",
  {
    proposalId: uuid("proposal_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    printedAmount: varchar("printed_amount", { length: 32 }).notNull(),
    amount: numeric("amount", { mode: "string" }).notNull(),
    basis: varchar("basis", { length: 24 }).notNull(),
    exposureKeys: jsonb("exposure_keys").$type<string[]>().notNull(),
    quote: text("quote").notNull(),
    evidenceId: varchar("evidence_id", { length: 8 }).notNull(),
    definitionQuote: text("definition_quote"),
  },
  (table) => [
    primaryKey({
      name: "operations_mix_lines_pkey",
      columns: [table.proposalId, table.ordinal],
    }),
    foreignKey({
      name: "operations_mix_lines_proposal_fk",
      columns: [table.proposalId],
      foreignColumns: [operationsMixProposals.proposalId],
    }),
    check(
      "operations_mix_lines_basis_check",
      sql`${table.basis} in ('name_match', 'filing_definition', 'rest_of_world', 'unallocated')`,
    ),
    check(
      "operations_mix_lines_definition_check",
      sql`${table.basis} <> 'filing_definition' or ${table.definitionQuote} is not null`,
    ),
  ],
);

/** Cada extracto que se le mandó al modelo, como en las resoluciones de industria. */
export const operationsMixEvidence = pgTable(
  "operations_mix_evidence",
  {
    proposalId: uuid("proposal_id").notNull(),
    evidenceId: varchar("evidence_id", { length: 8 }).notNull(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    section: varchar("section", { length: 32 }).notNull(),
    documentUrl: text("document_url").notNull(),
    accessionNumber: varchar("accession_number", { length: 20 }).notNull(),
    documentAcceptedAt: instant("document_accepted_at").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    byteLength: integer("byte_length").notNull(),
    truncated: boolean("truncated").notNull(),
    excerpt: text("excerpt").notNull(),
  },
  (table) => [
    primaryKey({
      name: "operations_mix_evidence_pkey",
      columns: [table.proposalId, table.evidenceId],
    }),
    foreignKey({
      name: "operations_mix_evidence_proposal_fk",
      columns: [table.proposalId],
      foreignColumns: [operationsMixProposals.proposalId],
    }),
    check("operations_mix_evidence_bytes_check", sql`${table.byteLength} > 0`),
  ],
);

export const employeeEquityOutcome = pgEnum("employee_equity_outcome", [
  "accepted",
  "abstained",
  "stopped",
]);

/**
 * Transcripciones de opciones y unidades de empleados de la capa IA (`F4-05`,
 * ADR 0040): una fila por vez que se le preguntó a la escalera por la nota de
 * compensación en acciones de un 10-K.
 *
 * Como los mixes, se guarda también la abstención y el freno, y
 * `proposal_id` es el `task_run_id` de sus intentos en `ai_spend_ledger`. La
 * transcripción aceptada se guarda tal cual la validó la policy: la lectura
 * —escala, plazo en años, suma de unidades— se recalcula de ella. Los valores
 * XBRL son con qué se corroboró. No se borra.
 */
export const employeeEquityProposals = pgTable(
  "employee_equity_proposals",
  {
    proposalId: uuid("proposal_id").primaryKey(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    cik: char("cik", { length: 10 }).notNull(),
    accessionNumber: varchar("accession_number", { length: 20 }).notNull(),
    fiscalYearEnd: date("fiscal_year_end", { mode: "string" }).notNull(),
    taskVersion: varchar("task_version", { length: 64 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 64 }).notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    ladderVersion: varchar("ladder_version", { length: 64 }).notNull(),
    extractVersion: varchar("extract_version", { length: 64 }).notNull(),
    xbrlOptionsOutstanding: numeric("xbrl_options_outstanding", {
      mode: "string",
    }),
    xbrlWeightedStrike: numeric("xbrl_weighted_strike", { mode: "string" }),
    outcome: employeeEquityOutcome("outcome").notNull(),
    transcription: jsonb("transcription").$type<Record<string, unknown>>(),
    reason: varchar("reason", { length: 64 }),
    acceptedRung: integer("accepted_rung"),
    respondedModel: varchar("responded_model", { length: 128 }),
    proposedAt: instant("proposed_at").notNull(),
    recordedAt: instant("recorded_at").notNull(),
  },
  (table) => [
    index("employee_equity_proposals_subject_idx").on(
      table.legalEntityId,
      table.proposedAt,
    ),
    check(
      "employee_equity_proposals_outcome_check",
      sql`(${table.outcome} = 'accepted') = (${table.reason} is null) and (${table.outcome} = 'accepted') = (${table.transcription} is not null)`,
    ),
    check(
      "employee_equity_proposals_accession_check",
      sql`${table.accessionNumber} ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'`,
    ),
    check(
      "employee_equity_proposals_xbrl_check",
      sql`(${table.xbrlOptionsOutstanding} is null or ${table.xbrlOptionsOutstanding} >= 0) and (${table.xbrlWeightedStrike} is null or ${table.xbrlWeightedStrike} >= 0)`,
    ),
    check(
      "employee_equity_proposals_timeline_check",
      sql`${table.recordedAt} >= ${table.proposedAt}`,
    ),
  ],
);

/** La nota que se le mandó al modelo: una por propuesta. */
export const employeeEquityEvidence = pgTable(
  "employee_equity_evidence",
  {
    proposalId: uuid("proposal_id").primaryKey(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    documentUrl: text("document_url").notNull(),
    accessionNumber: varchar("accession_number", { length: 20 }).notNull(),
    documentAcceptedAt: instant("document_accepted_at").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    byteLength: integer("byte_length").notNull(),
    truncated: boolean("truncated").notNull(),
    excerpt: text("excerpt").notNull(),
  },
  (table) => [
    foreignKey({
      name: "employee_equity_evidence_proposal_fk",
      columns: [table.proposalId],
      foreignColumns: [employeeEquityProposals.proposalId],
    }),
    check("employee_equity_evidence_bytes_check", sql`${table.byteLength} > 0`),
  ],
);

export const marketExpectationsOutcome = pgEnum("market_expectations_outcome", [
  "accepted",
  "abstained",
  "stopped",
]);

/**
 * Lecturas de expectativas de la capa IA (`F6-11`, ADR 0050): una fila por
 * vez que se le preguntó a la escalera qué sostiene un 10-K sobre crecimiento,
 * margen y ventaja competitiva.
 *
 * Como las demás propuestas, se guarda también la abstención y el freno, y
 * `reading_id` es el `task_run_id` de sus intentos en `ai_spend_ledger`. La
 * lectura aceptada se guarda tal cual la validó la policy; nunca entra a un
 * cálculo. No se borra.
 */
export const marketExpectationsReadings = pgTable(
  "market_expectations_readings",
  {
    readingId: uuid("reading_id").primaryKey(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    cik: char("cik", { length: 10 }).notNull(),
    accessionNumber: varchar("accession_number", { length: 20 }).notNull(),
    fiscalYearEnd: date("fiscal_year_end", { mode: "string" }).notNull(),
    taskVersion: varchar("task_version", { length: 64 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 64 }).notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    ladderVersion: varchar("ladder_version", { length: 64 }).notNull(),
    extractVersion: varchar("extract_version", { length: 64 }).notNull(),
    outcome: marketExpectationsOutcome("outcome").notNull(),
    reading: jsonb("reading").$type<Record<string, unknown>>(),
    reason: varchar("reason", { length: 64 }),
    acceptedRung: integer("accepted_rung"),
    respondedModel: varchar("responded_model", { length: 128 }),
    proposedAt: instant("proposed_at").notNull(),
    recordedAt: instant("recorded_at").notNull(),
  },
  (table) => [
    index("market_expectations_readings_subject_idx").on(
      table.legalEntityId,
      table.fiscalYearEnd,
      table.proposedAt,
    ),
    check(
      "market_expectations_readings_outcome_check",
      sql`(${table.outcome} = 'accepted') = (${table.reason} is null) and (${table.outcome} = 'accepted') = (${table.reading} is not null)`,
    ),
    check(
      "market_expectations_readings_accession_check",
      sql`${table.accessionNumber} ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'`,
    ),
    check(
      "market_expectations_readings_timeline_check",
      sql`${table.recordedAt} >= ${table.proposedAt}`,
    ),
  ],
);

/** Las secciones del 10-K que se le mandaron al modelo, una fila por bloque. */
export const marketExpectationsEvidence = pgTable(
  "market_expectations_evidence",
  {
    readingId: uuid("reading_id").notNull(),
    evidenceId: varchar("evidence_id", { length: 8 }).notNull(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    section: varchar("section", { length: 48 }).notNull(),
    documentUrl: text("document_url").notNull(),
    accessionNumber: varchar("accession_number", { length: 20 }).notNull(),
    documentAcceptedAt: instant("document_accepted_at").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    byteLength: integer("byte_length").notNull(),
    truncated: boolean("truncated").notNull(),
    excerpt: text("excerpt").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.readingId, table.evidenceId] }),
    foreignKey({
      name: "market_expectations_evidence_reading_fk",
      columns: [table.readingId],
      foreignColumns: [marketExpectationsReadings.readingId],
    }),
    check(
      "market_expectations_evidence_bytes_check",
      sql`${table.byteLength} > 0`,
    ),
  ],
);

/**
 * Marca de agua del refresh (ADR 0021): hasta qué presentación miró el sondeo a
 * cada sujeto, y cuándo lo miró.
 *
 * Es estado, no bitácora. La corrida del sondeo queda igual en `ingestion_runs`
 * y es la que explica cada vuelta; esta fila es la respuesta directa a «¿qué
 * sabía el portal la última vez?», que el plan necesita leer sin red y sin
 * reconstruirla desde el log.
 *
 * La fila se escribe **después** de que el refresh terminó, así que la marca
 * puede quedar atrás de la realidad —y entonces la vuelta siguiente vuelve a
 * bajar, que deduplica por contenido— pero nunca adelante de un refresh que no
 * ocurrió.
 */
export const ingestionRefreshState = pgTable(
  "ingestion_refresh_state",
  {
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    datasetId: varchar("dataset_id", { length: 128 }).notNull(),
    subjectKey: varchar("subject_key", { length: 128 }).notNull(),
    // Par `(aceptación, accession)` de la presentación relevante más nueva que
    // el sondeo vio: el accession desempata dos aceptadas en el mismo segundo.
    watermarkAcceptedAt: instant("watermark_accepted_at").notNull(),
    watermarkAccession: varchar("watermark_accession", {
      length: 64,
    }).notNull(),
    formSelectionVersion: varchar("form_selection_version", {
      length: 64,
    }).notNull(),
    probeVersion: varchar("probe_version", { length: 64 }).notNull(),
    lastCheckedAt: instant("last_checked_at").notNull(),
    lastChangedAt: instant("last_changed_at").notNull(),
    probeRunId: uuid("probe_run_id")
      .notNull()
      .references(() => ingestionRuns.runId),
    refreshRunId: uuid("refresh_run_id")
      .notNull()
      .references(() => ingestionRuns.runId),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "ingestion_refresh_state_pkey",
      columns: [table.sourceId, table.datasetId, table.subjectKey],
    }),
    index("ingestion_refresh_state_dataset_idx").on(
      table.sourceId,
      table.datasetId,
      table.lastCheckedAt,
    ),
    check(
      "ingestion_refresh_state_accession_check",
      sql`${table.watermarkAccession} ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'`,
    ),
    // Una fila nace de un refresh efectivo y después sólo avanza el «cuándo se
    // miró»: mirar no puede ser anterior a haber cambiado.
    check(
      "ingestion_refresh_state_timeline_check",
      sql`${table.lastChangedAt} <= ${table.lastCheckedAt} and ${table.updatedAt} >= ${table.lastCheckedAt}`,
    ),
  ],
);

export const observationSubjectType = pgEnum("observation_subject_type", [
  "legal_entity",
  "security",
  "listing",
  "macro_series",
]);

export const observationPeriodType = pgEnum("observation_period_type", [
  "instant",
  "daily",
  "monthly",
  "quarter",
  "year_to_date",
  "annual",
  "ttm",
]);

export const rawValueStatus = pgEnum("raw_value_status", [
  "stored",
  "not_provided",
  "license_restricted",
]);

export const observationValueBasis = pgEnum("observation_value_basis", [
  "reported",
  "normalized",
]);

/**
 * Observaciones publicadas: la forma persistida del contrato point-in-time.
 *
 * El sujeto es un ID interno opaco, nunca un ticker. Cada fila conserva tiempo
 * efectivo (`as_of`, período), tiempo de conocimiento público (`available_at`,
 * `superseded_at`), tiempo de sistema (`fetched_at`, `recorded_at`) y su
 * lineage hasta la corrida que la publicó (`TM-06`, `TM-16`). Los valores
 * viajan como `numeric` para no perder exactitud y un faltante queda `null` con
 * su motivo en `raw_value_status` (`TM-05`).
 *
 * La fila no guarda lo que puede reconstruir sin pérdida (ADR 0018): fuente,
 * dataset y parser son los de su corrida; `metric_id` nulo es el propio
 * concepto; `late_ingestion` sale de `available_at` y `recorded_at`; y el ID
 * externo de staging sale del documento, el concepto, la unidad, el período y
 * el sujeto de la corrida. Los dos hashes van en binario.
 */
export const observations = pgTable(
  "observations",
  {
    observationId: uuid("observation_id").primaryKey(),
    subjectType: observationSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    // `null` mientras la métrica sea el concepto reportado: nunca una copia.
    metricId: varchar("metric_id", { length: 128 }),
    concept: varchar("concept", { length: 128 }).notNull(),
    // Fechas calendarias: conservan el calendario de la fuente.
    asOf: date("as_of", { mode: "string" }).notNull(),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    periodType: observationPeriodType("period_type").notNull(),
    unit: varchar("unit", { length: 32 }).notNull(),
    currency: varchar("currency", { length: 3 }),
    rawValue: numeric("raw_value", { mode: "string" }),
    rawValueStatus: rawValueStatus("raw_value_status").notNull(),
    normalizedValue: numeric("normalized_value", { mode: "string" }),
    transformationId: varchar("transformation_id", { length: 128 }),
    valueBasis: observationValueBasis("value_basis").notNull(),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    supersededAt: timestamp("superseded_at", {
      withTimezone: true,
      mode: "date",
    }),
    fetchedAt: timestamp("fetched_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    revisionGroupId: sha256("revision_group_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    restatementOfId: uuid("restatement_of_id"),
    contentHash: sha256("content_hash").notNull(),
    // Flags de la fuente; `late_ingestion` se deriva al leer.
    qualityFlags: jsonb("quality_flags")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    sourceDocumentId: varchar("source_document_id", { length: 256 }),
    ingestionRunId: uuid("ingestion_run_id")
      .notNull()
      .references(() => ingestionRuns.runId),
  },
  (table) => [
    uniqueIndex("observations_revision_uidx").on(
      table.revisionGroupId,
      table.revisionNumber,
    ),
    // A lo sumo una revisión vigente por cadena: dos vigentes serían dos
    // respuestas simultáneas para el mismo hecho.
    uniqueIndex("observations_current_revision_uidx")
      .on(table.revisionGroupId)
      .where(sql`${table.supersededAt} is null`),
    // Sin `as_of`: las lecturas ordenan por cadena y la selección temporal corre
    // en el dominio. Así las claves se repiten y PostgreSQL las deduplica.
    index("observations_subject_idx").on(
      table.subjectType,
      table.subjectId,
      sql`coalesce(${table.metricId}, ${table.concept})`,
    ),
    check(
      "observations_raw_value_status_check",
      sql`(${table.rawValueStatus} = 'stored' and ${table.rawValue} is not null) or (${table.rawValueStatus} <> 'stored' and ${table.rawValue} is null)`,
    ),
    check(
      "observations_normalized_value_check",
      sql`${table.normalizedValue} is null or ${table.transformationId} is not null`,
    ),
    check(
      "observations_period_check",
      sql`case when ${table.periodType} = 'instant' then ${table.periodStart} is null and ${table.periodEnd} is null else ${table.periodStart} is not null and ${table.periodEnd} is not null and ${table.periodStart} <= ${table.periodEnd} end`,
    ),
    check(
      "observations_revision_chain_check",
      sql`(${table.revisionNumber} = 1) = (${table.restatementOfId} is null) and ${table.revisionNumber} >= 1`,
    ),
    check(
      "observations_superseded_after_available_check",
      sql`${table.supersededAt} is null or ${table.supersededAt} > ${table.availableAt}`,
    ),
    check(
      "observations_content_hash_check",
      sql`octet_length(${table.contentHash}) = 32 and octet_length(${table.revisionGroupId}) = 32`,
    ),
    check(
      "observations_metric_id_check",
      sql`${table.metricId} is null or ${table.metricId} <> ${table.concept}`,
    ),
    check(
      "observations_derived_flags_check",
      sql`jsonb_typeof(${table.qualityFlags}) = 'array' and not ${table.qualityFlags} @> '["late_ingestion"]'::jsonb`,
    ),
    check(
      "observations_currency_check",
      sql`${table.currency} is null or ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

/**
 * Podas de historia publicada (ADR 0019).
 *
 * Append-only y sin foreign key a las observaciones que borró, por definición:
 * describe filas que ya no existen. Es la contracara de
 * `ingestion_runs.selection_anchor_on`: la corrida dice hasta dónde fue a
 * buscar, la poda hasta dónde quedó lo que trajo, y para un sujeto podado la
 * segunda es la respuesta a «¿por qué falta este período?» (`TM-16`).
 *
 * Los checks sostienen que el registro se pueda leer sin el código que lo
 * escribió: nada posterior al corte se borró, el corte no es más nuevo que su
 * ancla y el de evidencia nunca es más nuevo que el general.
 */
export const observationPrunes = pgTable(
  "observation_prunes",
  {
    pruneId: uuid("prune_id").primaryKey(),
    ruleVersion: varchar("rule_version", { length: 64 }).notNull(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    datasetId: varchar("dataset_id", { length: 128 }).notNull(),
    subjectType: observationSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    selectionVersion: varchar("selection_version", { length: 64 }).notNull(),
    selectionAnchorOn: date("selection_anchor_on", {
      mode: "string",
    }).notNull(),
    anchorRunId: uuid("anchor_run_id")
      .notNull()
      .references(() => ingestionRuns.runId),
    periodsEndingBefore: date("periods_ending_before", {
      mode: "string",
    }).notNull(),
    evidencePeriodsEndingBefore: date("evidence_periods_ending_before", {
      mode: "string",
    }).notNull(),
    // La lista completa, para que el registro no dependa de leer el código de
    // la versión de la regla dentro de cinco años.
    evidenceConcepts: jsonb("evidence_concepts")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    // Cortes más anchos por grupo de conceptos (`sec-history-prune-1.1.0`,
    // ADR 0037). Las podas de `1.0.0` lo tienen vacío.
    conceptCuts: jsonb("concept_cuts")
      .$type<{ periodsEndingBefore: string; concepts: string[] }[]>()
      .notNull()
      .default(emptyJsonArray),
    deletedCount: integer("deleted_count").notNull(),
    keptCount: integer("kept_count").notNull(),
    deletedMinAsOf: date("deleted_min_as_of", { mode: "string" }),
    deletedMaxAsOf: date("deleted_max_as_of", { mode: "string" }),
    actor: varchar("actor", { length: 128 }).notNull(),
    reason: varchar("reason", { length: 240 }).notNull(),
    executedAt: timestamp("executed_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    index("observation_prunes_subject_idx").on(
      table.subjectType,
      table.subjectId,
      table.executedAt,
    ),
    check(
      "observation_prunes_counts_check",
      sql`${table.deletedCount} >= 0 and ${table.keptCount} >= 0`,
    ),
    check(
      "observation_prunes_deleted_range_check",
      sql`(${table.deletedCount} = 0) = (${table.deletedMinAsOf} is null)
        and (${table.deletedCount} = 0) = (${table.deletedMaxAsOf} is null)
        and (${table.deletedMinAsOf} is null or ${table.deletedMinAsOf} <= ${table.deletedMaxAsOf})`,
    ),
    check(
      "observation_prunes_cuts_check",
      sql`${table.evidencePeriodsEndingBefore} <= ${table.periodsEndingBefore}
        and ${table.periodsEndingBefore} <= ${table.selectionAnchorOn}`,
    ),
    // Nada que la ventana conserva pudo haberse borrado.
    check(
      "observation_prunes_within_cut_check",
      sql`${table.deletedMaxAsOf} is null or ${table.deletedMaxAsOf} < ${table.periodsEndingBefore}`,
    ),
    check(
      "observation_prunes_evidence_concepts_check",
      sql`jsonb_typeof(${table.evidenceConcepts}) = 'array'`,
    ),
    check(
      "observation_prunes_concept_cuts_check",
      sql`jsonb_typeof(${table.conceptCuts}) = 'array'`,
    ),
    check(
      "observation_prunes_actor_check",
      sql`${table.actor} ~ '^[A-Za-z0-9._:@/-]{1,128}$'`,
    ),
  ],
);

/**
 * Documentos de fuente: el evento inmutable que publicó observaciones. Para la
 * SEC, una presentación con su accession, formulario, fecha de filing, instante
 * de aceptación y foco fiscal (`docs/data/point-in-time-contract.md`, "Eventos").
 *
 * La observación referencia el documento por `source_document_id` sin foreign
 * key compuesta, igual que antes de que esta tabla existiera: las observaciones
 * de la fixture sintética no tienen documento, y exigirlo reescribiría historia.
 *
 * Inmutable: la clave primaria es la identidad del documento en su fuente y el
 * repositorio no actualiza. Una descripción distinta de la misma accession es un
 * conflicto que se reporta (`TM-05`).
 */
export const sourceDocuments = pgTable(
  "source_documents",
  {
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    sourceDocumentId: varchar("source_document_id", { length: 256 }).notNull(),
    documentType: varchar("document_type", { length: 32 }).notNull(),
    subjectType: observationSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    // Fechas calendarias de la fuente: no se convierten a medianoche UTC.
    publishedOn: date("published_on", { mode: "string" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    availabilityRule: varchar("availability_rule", { length: 64 }).notNull(),
    periodEndOn: date("period_end_on", { mode: "string" }),
    fiscalYear: integer("fiscal_year"),
    fiscalPeriod: varchar("fiscal_period", { length: 4 }),
    contentHash: text("content_hash").notNull(),
    ingestionRunId: uuid("ingestion_run_id")
      .notNull()
      .references(() => ingestionRuns.runId),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "source_documents_pkey",
      columns: [table.sourceId, table.sourceDocumentId],
    }),
    index("source_documents_subject_idx").on(
      table.subjectType,
      table.subjectId,
      table.availableAt,
    ),
    check(
      "source_documents_content_hash_check",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    // Un documento no puede ser conocible antes de su aceptación.
    check(
      "source_documents_available_after_accepted_check",
      sql`${table.acceptedAt} is null or ${table.availableAt} >= ${table.acceptedAt}`,
    ),
    check(
      "source_documents_fiscal_year_check",
      sql`${table.fiscalYear} is null or ${table.fiscalYear} between 1900 and 2200`,
    ),
  ],
);

export const valuationRunStatus = pgEnum("valuation_run_status", [
  "computed",
  "requires_review",
  "rejected",
]);

export const valuationFailureCode = pgEnum("valuation_failure_code", [
  "invalid_decimal",
  "non_finite_value",
  "division_by_zero",
  "policy_check_failed",
  "unsupported_method",
]);

/**
 * Corridas de valuación: registro append-only de qué snapshot se valuó, con qué
 * motor y con qué resultado (`TM-16`).
 *
 * Una corrida rechazada también se persiste, porque explicar por qué un valor
 * **no** se calculó es parte del audit trail. El índice único sobre
 * `input_hash` más las versiones hace que un replay exacto sea la misma corrida
 * y no una fila nueva: el motor es determinista, así que recalcular no puede
 * producir otro resultado. Los decimales viajan dentro del JSON como strings
 * canónicos y la política numérica queda registrada por fila, de modo que
 * cambiarla no reescriba corridas históricas.
 */
export const valuationRuns = pgTable(
  "valuation_runs",
  {
    valuationRunId: uuid("valuation_run_id").primaryKey(),
    // Identidad no colapsada: nunca un ticker.
    legalEntityId: uuid("legal_entity_id").notNull(),
    securityId: uuid("security_id").notNull(),
    listingId: uuid("listing_id"),
    depositaryProgramId: uuid("depositary_program_id"),
    asOf: date("as_of", { mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    assetProfile: varchar("asset_profile", { length: 32 }).notNull(),
    method: varchar("method", { length: 64 }).notNull(),
    engineVersion: varchar("engine_version", { length: 32 }).notNull(),
    methodologyVersion: varchar("methodology_version", {
      length: 32,
    }).notNull(),
    decimalPrecision: integer("decimal_precision").notNull(),
    decimalRounding: varchar("decimal_rounding", { length: 32 }).notNull(),
    status: valuationRunStatus("status").notNull(),
    inputHash: text("input_hash").notNull(),
    resultHash: text("result_hash"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    failureCode: valuationFailureCode("failure_code"),
    failureMessage: varchar("failure_message", { length: 240 }),
    failureSubjects: jsonb("failure_subjects")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    sourceIds: jsonb("source_ids")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    observationIds: jsonb("observation_ids")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    finishedAt: timestamp("finished_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // El mismo snapshot bajo el mismo motor es la misma corrida. Un cambio de
    // versión sí produce otra, porque el resultado puede diferir.
    uniqueIndex("valuation_runs_replay_uidx").on(
      table.inputHash,
      table.engineVersion,
      table.methodologyVersion,
    ),
    index("valuation_runs_subject_idx").on(
      table.legalEntityId,
      table.securityId,
      table.asOf,
    ),
    check(
      "valuation_runs_hash_check",
      sql`${table.inputHash} ~ '^[a-f0-9]{64}$' and (${table.resultHash} is null or ${table.resultHash} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      "valuation_runs_outcome_check",
      sql`(${table.status} = 'rejected') = (${table.result} is null and ${table.resultHash} is null and ${table.failureCode} is not null and ${table.failureMessage} is not null)`,
    ),
    check(
      "valuation_runs_finished_after_started_check",
      sql`${table.finishedAt} >= ${table.startedAt}`,
    ),
    check(
      "valuation_runs_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "valuation_runs_decimal_policy_check",
      sql`${table.decimalPrecision} > 0 and ${table.decimalRounding} <> ''`,
    ),
  ],
);

export const valuationJobStatus = pgEnum("valuation_job_status", [
  "queued",
  "running",
  "completed",
]);

export const valuationJobIdentity = pgEnum("valuation_job_identity", [
  "resolved",
  "ambiguous",
  "not_found",
  "conflict",
]);

export const valuationJobGap = pgEnum("valuation_job_gap", [
  "unresolved_ticker",
  "ambiguous_ticker",
  "identity_conflict",
  "cik_missing",
  "annual_fundamentals",
  "unsupported_method",
  "snapshot_not_assembled",
  "assessment_failed",
  "run_recorded",
  "data_ingested",
  "ingestion_pending",
  "ingestion_failed",
  "point_in_time_audit_failed",
  "qualitative_resolved",
]);

/**
 * Corrida por ticker encolada (`F6-01`, ADR 0045).
 *
 * No es un job de ingesta: no tiene fuente ni lease. Una fila es un pedido del
 * owner. El índice único parcial impide dos abiertos para el mismo ticker, y
 * el token cerca el cierre para que un worker reemplazado no escriba tarde.
 * Los instantes los pone la aplicación.
 */
export const valuationJobs = pgTable(
  "valuation_jobs",
  {
    jobId: uuid("job_id").primaryKey(),
    ticker: varchar("ticker", { length: 16 }).notNull(),
    status: valuationJobStatus("status").notNull(),
    knownAt: instant("known_at").notNull(),
    ruleVersion: varchar("rule_version", { length: 64 }).notNull(),
    identityStatus: valuationJobIdentity("identity_status"),
    legalEntityId: uuid("legal_entity_id"),
    securityId: uuid("security_id"),
    listingId: uuid("listing_id"),
    gap: valuationJobGap("gap"),
    methodStatus: varchar("method_status", { length: 32 }),
    assetProfile: varchar("asset_profile", { length: 32 }),
    method: varchar("method", { length: 64 }),
    rigor: varchar("rigor", { length: 16 }),
    unsupportedReason: varchar("unsupported_reason", { length: 64 }),
    /** Por qué no se armó el snapshot (`F6-07`, ADR 0046). */
    snapshotGap: varchar("snapshot_gap", { length: 64 }),
    /** La corrida que registró el job: `valuation_runs` es append-only. */
    valuationRunId: uuid("valuation_run_id"),
    runStatus: varchar("run_status", { length: 16 }),
    /**
     * Qué bajó y auditó el job antes de valuar (`F6-05`, ADR 0051). El dominio
     * lo valida con `valuation-data-1.0.0`; acá sólo se exige que exista
     * cuando el gap lo nombra.
     */
    dataStep: jsonb("data_step"),
    /**
     * Qué le preguntó el job a la IA (`F6-13`, ADR 0052). El dominio lo valida
     * con `valuation-qualitative-1.0.0`.
     */
    qualitativeStep: jsonb("qualitative_step"),
    /**
     * El job que éste continúa con un corte nuevo, después de bajar datos o de
     * una decisión aceptada de la IA.
     */
    followsJobId: uuid("follows_job_id"),
    claimToken: uuid("claim_token"),
    createdAt: instant("created_at").notNull(),
    startedAt: instant("started_at"),
    /** Último latido del reclamo: un job viejo se mide desde acá. */
    heartbeatAt: instant("heartbeat_at"),
    finishedAt: instant("finished_at"),
  },
  (table) => [
    uniqueIndex("valuation_jobs_open_ticker_uidx")
      .on(table.ticker)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("valuation_jobs_ticker_idx").on(table.ticker, table.createdAt),
    uniqueIndex("valuation_jobs_follows_uidx")
      .on(table.followsJobId)
      .where(sql`${table.followsJobId} is not null`),
    check(
      "valuation_jobs_ticker_check",
      sql`${table.ticker} ~ '^[A-Z][A-Z0-9.-]{0,15}$'`,
    ),
    check(
      "valuation_jobs_rule_check",
      sql`${table.ruleVersion} in ('valuation-job-1.0.0', 'valuation-job-1.1.0', 'valuation-job-1.2.0', 'valuation-job-1.3.0')`,
    ),
    check(
      "valuation_jobs_phase_check",
      sql`case ${table.status}
        when 'queued' then ${table.startedAt} is null and ${table.finishedAt} is null and ${table.gap} is null and ${table.claimToken} is null and ${table.identityStatus} is null and ${table.legalEntityId} is null
        when 'running' then ${table.startedAt} is not null and ${table.finishedAt} is null and ${table.gap} is null and ${table.claimToken} is not null and ${table.identityStatus} is null and ${table.legalEntityId} is null
        else ${table.startedAt} is not null and ${table.finishedAt} is not null and ${table.gap} is not null and ${table.claimToken} is null
      end`,
    ),
    check(
      "valuation_jobs_timeline_check",
      sql`${table.knownAt} <= ${table.createdAt}
        and (${table.startedAt} is null or ${table.startedAt} >= ${table.createdAt})
        and (${table.finishedAt} is null or (${table.startedAt} is not null and ${table.finishedAt} >= ${table.startedAt}))`,
    ),
    check(
      "valuation_jobs_identity_check",
      sql`(${table.gap} = 'unresolved_ticker') = (${table.identityStatus} is not null and ${table.identityStatus} = 'not_found')
        and (${table.gap} = 'ambiguous_ticker') = (${table.identityStatus} is not null and ${table.identityStatus} = 'ambiguous')
        and (${table.gap} = 'identity_conflict') = (${table.identityStatus} is not null and ${table.identityStatus} = 'conflict')
        and (${table.legalEntityId} is not null) = (${table.identityStatus} is not null and ${table.identityStatus} = 'resolved')
        and (${table.securityId} is null or ${table.legalEntityId} is not null)
        and (${table.listingId} is null or ${table.securityId} is not null)
        and (${table.gap} is null or ${table.gap} in ('unresolved_ticker', 'ambiguous_ticker', 'identity_conflict', 'assessment_failed') or ${table.legalEntityId} is not null)`,
    ),
    check(
      "valuation_jobs_method_check",
      sql`(${table.methodStatus} is null or ${table.methodStatus} in ('selected', 'unsupported_method'))
        and (${table.assetProfile} is null or ${table.assetProfile} in ('non_financial_mature', 'high_growth', 'loss_making', 'bank', 'insurer', 'reit', 'cyclical', 'commodity', 'holding', 'distressed'))
        and (${table.method} is null or ${table.method} in ('fcff_base', 'fcff_three_stage', 'revenue_margin_survival', 'excess_return', 'affo_nav', 'normalized_fcff', 'sotp_nav', 'apv_scenarios'))
        and (${table.rigor} is null or ${table.rigor} in ('full', 'standard', 'screening', 'unsupported'))
        and (${table.unsupportedReason} is null or ${table.unsupportedReason} in ('missing_classification_evidence', 'conflicting_evidence', 'method_not_implemented', 'missing_required_input'))
        and ((${table.gap} = 'snapshot_not_assembled') is not distinct from (${table.methodStatus} = 'selected' and ${table.method} is not null and ${table.assetProfile} is not null and ${table.rigor} is not null and ${table.unsupportedReason} is null) or ${table.gap} is distinct from 'snapshot_not_assembled')
        and ((${table.gap} = 'unsupported_method') is not distinct from (${table.methodStatus} = 'unsupported_method' and ${table.unsupportedReason} is not null) or ${table.gap} is distinct from 'unsupported_method')
        and (${table.methodStatus} is null or ${table.gap}::text in ('snapshot_not_assembled', 'unsupported_method', 'annual_fundamentals', 'run_recorded'))
        and (${table.methodStatus} is not null or (${table.method} is null and ${table.assetProfile} is null and ${table.rigor} is null and ${table.unsupportedReason} is null))`,
    ),
    // `run_recorded` se compara como texto: el valor se agrega al enum en la
    // misma transacción de la migración, y PostgreSQL no deja usarlo ahí.
    check(
      "valuation_jobs_run_check",
      sql`(${table.valuationRunId} is null) = (${table.runStatus} is null)
        and (${table.runStatus} is null or ${table.runStatus} in ('computed', 'requires_review', 'rejected'))
        and (${table.valuationRunId} is not null) = (${table.gap} is not null and ${table.gap}::text = 'run_recorded')
        and (${table.valuationRunId} is null or (${table.methodStatus} = 'selected' and ${table.method} in ('fcff_base', 'normalized_fcff', 'excess_return', 'fcff_three_stage', 'revenue_margin_survival')))
        and (${table.snapshotGap} is null or ${table.gap}::text = 'snapshot_not_assembled')
        and (${table.snapshotGap} is null or ${table.snapshotGap} in ('method_not_derived', 'security_missing', 'cost_of_capital_unavailable', 'normalization_unavailable', 'revenue_history_insufficient', 'revenue_history_non_positive', 'base_margin_unavailable', 'sales_to_capital_unavailable', 'tax_rate_unavailable', 'employee_equity_not_proposed', 'shares_outstanding_unavailable', 'market_unavailable', 'financial_base_unavailable', 'financial_base_stale', 'financial_declaration_missing', 'financial_filing_evidence_missing', 'growth_revenue_history_unavailable', 'growth_margin_unavailable', 'growth_tax_note_missing', 'growth_tax_jurisdictions_not_reconciled', 'growth_tax_pool_not_reconciled'))
        and (${table.ruleVersion} = 'valuation-job-1.0.0' or ${table.gap} is null or ${table.gap}::text <> 'snapshot_not_assembled' or ${table.snapshotGap} is not null)
        and (${table.ruleVersion} <> 'valuation-job-1.0.0' or (${table.snapshotGap} is null and ${table.valuationRunId} is null))`,
    ),
    // Los gaps nuevos se comparan como texto, por la misma razón que
    // `run_recorded`.
    check(
      "valuation_jobs_data_check",
      sql`(${table.dataStep} is null or (${table.ruleVersion} in ('valuation-job-1.2.0', 'valuation-job-1.3.0') and ${table.status} = 'completed' and jsonb_typeof(${table.dataStep}) = 'object'))
        and (${table.followsJobId} is null or (${table.ruleVersion} in ('valuation-job-1.2.0', 'valuation-job-1.3.0') and ${table.followsJobId} <> ${table.jobId}))
        and (${table.gap} is null or ${table.gap}::text not in ('data_ingested', 'ingestion_pending', 'ingestion_failed', 'point_in_time_audit_failed') or (${table.dataStep} is not null and ${table.methodStatus} is null))
        and (${table.heartbeatAt} is null or (${table.startedAt} is not null and ${table.heartbeatAt} >= ${table.startedAt}))`,
    ),
    // `qualitative_resolved` se compara como texto, por la misma razón.
    check(
      "valuation_jobs_qualitative_check",
      sql`(${table.qualitativeStep} is null or (${table.ruleVersion} = 'valuation-job-1.3.0' and ${table.status} = 'completed' and jsonb_typeof(${table.qualitativeStep}) = 'object' and ${table.gap}::text in ('qualitative_resolved', 'snapshot_not_assembled', 'run_recorded')))
        and (${table.gap} is null or ${table.gap}::text <> 'qualitative_resolved' or (${table.qualitativeStep} is not null and ${table.dataStep} is not null and ${table.methodStatus} is null))`,
    ),
    foreignKey({
      name: "valuation_jobs_run_fk",
      columns: [table.valuationRunId],
      foreignColumns: [valuationRuns.valuationRunId],
    }),
    foreignKey({
      name: "valuation_jobs_follows_fk",
      columns: [table.followsJobId],
      foreignColumns: [table.jobId],
    }),
  ],
);

/**
 * Grafo de identidad persistido (`F2-02`).
 *
 * Cada nivel se guarda en dos tablas y no en una: un **registro** que sólo
 * declara que el ID existe, y una tabla de **versiones** con los atributos y su
 * vigencia. La separación no es ceremonia: es lo que permite que una foreign key
 * apunte a la identidad —que es inmutable— y no a una fila que cambia cada vez
 * que la empresa se renombra. Sin ella, `securities.issuer_legal_entity_id` no
 * tendría a qué referenciar, porque en la tabla versionada el mismo emisor
 * aparece muchas veces.
 *
 * La clave primaria de cada versión es `(id, valid_from)`, que es exactamente su
 * clave natural: un sujeto y el instante desde el que esa versión aplica. No hay
 * un surrogate inventado, y cerrar una versión es un update dirigido a esa clave.
 *
 * Los índices únicos parciales espejan en PostgreSQL las invariantes que el
 * dominio ya prueba: una sola versión abierta por sujeto, un solo símbolo
 * vigente por listing y tipo, un identificador autoritativo que no puede quedar
 * abierto para dos sujetos, y una security que no está dos veces en el mismo
 * índice a la vez (`TM-06`).
 */
const temporalVersionColumns = () => ({
  validFrom: timestamp("valid_from", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  validTo: timestamp("valid_to", { withTimezone: true, mode: "date" }),
  availableAt: timestamp("available_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  supersededAt: timestamp("superseded_at", {
    withTimezone: true,
    mode: "date",
  }),
  sourceId: varchar("source_id", { length: 64 }).notNull(),
  sourceDocumentId: varchar("source_document_id", { length: 256 }),
  contentHash: text("content_hash").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

type TemporalColumns = {
  validFrom: AnyPgColumn;
  validTo: AnyPgColumn;
  availableAt: AnyPgColumn;
  supersededAt: AnyPgColumn;
  contentHash: AnyPgColumn;
};

function temporalVersionChecks(prefix: string, table: TemporalColumns) {
  return [
    // `valid_to` igual a `valid_from` sería un intervalo vacío, no un instante.
    check(
      `${prefix}_valid_interval_check`,
      sql`${table.validTo} is null or ${table.validFrom} < ${table.validTo}`,
    ),
    check(
      `${prefix}_superseded_after_available_check`,
      sql`${table.supersededAt} is null or ${table.supersededAt} > ${table.availableAt}`,
    ),
    check(
      `${prefix}_content_hash_check`,
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ];
}

const openVersion = (table: TemporalColumns) =>
  sql`${table.validTo} is null and ${table.supersededAt} is null`;

export const legalEntityType = pgEnum("legal_entity_type", [
  "operating_company",
  "holding_company",
  "bank",
  "insurer",
  "fund",
  "trust",
  "depositary",
  "other",
]);

export const legalEntityStatus = pgEnum("legal_entity_status", [
  "active",
  "inactive",
  "merged",
  "dissolved",
  "unknown",
]);

export const securityType = pgEnum("security_type", [
  "common_equity",
  "preferred_equity",
  "depositary_receipt",
  "fund_unit",
  "etf_share",
  "debt",
  "other",
]);

export const securityStatus = pgEnum("security_status", [
  "active",
  "inactive",
  "converted",
  "cancelled",
  "unknown",
]);

export const listingStatus = pgEnum("listing_status", [
  "active",
  "suspended",
  "delisted",
  "unknown",
]);

export const listingSymbolType = pgEnum("listing_symbol_type", [
  "ticker",
  "local_code",
  "vendor_symbol",
]);

export const identifierSubjectType = pgEnum("identifier_subject_type", [
  "legal_entity",
  "security",
  "listing",
]);

export const identifierConfidence = pgEnum("identifier_confidence", [
  "authoritative",
  "confirmed",
  "candidate",
  "rejected",
]);

/** Identidad opaca e inmutable del emisor: no contiene CIK, nombre ni ticker. */
export const legalEntities = pgTable("legal_entities", {
  legalEntityId: uuid("legal_entity_id").primaryKey(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export const legalEntityVersions = pgTable(
  "legal_entity_versions",
  {
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.legalEntityId),
    legalName: varchar("legal_name", { length: 256 }).notNull(),
    entityType: legalEntityType("entity_type").notNull(),
    jurisdiction: char("jurisdiction", { length: 2 }),
    status: legalEntityStatus("status").notNull(),
    ...temporalVersionColumns(),
  },
  (table) => [
    primaryKey({
      name: "legal_entity_versions_pkey",
      columns: [table.legalEntityId, table.validFrom],
    }),
    uniqueIndex("legal_entity_versions_open_uidx")
      .on(table.legalEntityId)
      .where(openVersion(table)),
    ...temporalVersionChecks("legal_entity_versions", table),
    check(
      "legal_entity_versions_jurisdiction_check",
      sql`${table.jurisdiction} is null or ${table.jurisdiction} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

export const securities = pgTable("securities", {
  securityId: uuid("security_id").primaryKey(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export const securityVersions = pgTable(
  "security_versions",
  {
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.securityId),
    // El emisor viaja en la versión, no en el registro: una reorganización lo
    // cambia sin que el instrumento deje de ser el mismo.
    issuerLegalEntityId: uuid("issuer_legal_entity_id")
      .notNull()
      .references(() => legalEntities.legalEntityId),
    securityType: securityType("security_type").notNull(),
    shareClass: varchar("share_class", { length: 256 }),
    economicCurrency: char("economic_currency", { length: 3 }),
    status: securityStatus("status").notNull(),
    ...temporalVersionColumns(),
  },
  (table) => [
    primaryKey({
      name: "security_versions_pkey",
      columns: [table.securityId, table.validFrom],
    }),
    uniqueIndex("security_versions_open_uidx")
      .on(table.securityId)
      .where(openVersion(table)),
    index("security_versions_issuer_idx").on(table.issuerLegalEntityId),
    ...temporalVersionChecks("security_versions", table),
    check(
      "security_versions_currency_check",
      sql`${table.economicCurrency} is null or ${table.economicCurrency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

export const listings = pgTable("listings", {
  listingId: uuid("listing_id").primaryKey(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export const listingVersions = pgTable(
  "listing_versions",
  {
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.listingId),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.securityId),
    mic: char("mic", { length: 4 }).notNull(),
    quoteCurrency: char("quote_currency", { length: 3 }).notNull(),
    country: char("country", { length: 2 }).notNull(),
    status: listingStatus("status").notNull(),
    primaryListing: boolean("primary_listing").notNull(),
    ...temporalVersionColumns(),
  },
  (table) => [
    primaryKey({
      name: "listing_versions_pkey",
      columns: [table.listingId, table.validFrom],
    }),
    uniqueIndex("listing_versions_open_uidx")
      .on(table.listingId)
      .where(openVersion(table)),
    index("listing_versions_venue_idx").on(table.mic, table.securityId),
    ...temporalVersionChecks("listing_versions", table),
    check(
      "listing_versions_codes_check",
      sql`${table.mic} ~ '^[A-Z0-9]{4}$' and ${table.quoteCurrency} ~ '^[A-Z]{3}$' and ${table.country} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

/**
 * Símbolo asignado a un listing durante un intervalo. `normalized_symbol` es una
 * clave de búsqueda derivada, no una identidad: un ticker sin MIC y sin fecha
 * sigue siendo una consulta, no una empresa.
 */
export const listingSymbols = pgTable(
  "listing_symbols",
  {
    listingSymbolId: uuid("listing_symbol_id").notNull(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.listingId),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    normalizedSymbol: varchar("normalized_symbol", { length: 32 }).notNull(),
    symbolType: listingSymbolType("symbol_type").notNull(),
    ...temporalVersionColumns(),
  },
  (table) => [
    primaryKey({
      name: "listing_symbols_pkey",
      columns: [table.listingSymbolId, table.validFrom],
    }),
    // Un listing puede tener a la vez un ticker y un código local, pero no dos
    // tickers vigentes: eso sería un cambio de símbolo sin cerrar el anterior.
    uniqueIndex("listing_symbols_open_uidx")
      .on(table.listingId, table.symbolType)
      .where(openVersion(table)),
    index("listing_symbols_lookup_idx").on(
      table.normalizedSymbol,
      table.validFrom,
    ),
    ...temporalVersionChecks("listing_symbols", table),
  ],
);

/**
 * Asignaciones de identificadores externos. El sujeto es polimórfico por diseño:
 * un CIK identifica a la entidad legal y un ISIN al instrumento, y guardarlos en
 * la misma tabla con `subject_type` explícito evita la tentación de copiar el
 * CIK a la security "para que el join sea más cómodo".
 */
export const identifierAssignments = pgTable(
  "identifier_assignments",
  {
    identifierAssignmentId: uuid("identifier_assignment_id").notNull(),
    subjectType: identifierSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    identifierType: varchar("identifier_type", { length: 64 }).notNull(),
    identifierValue: varchar("identifier_value", { length: 128 }).notNull(),
    normalizedValue: varchar("normalized_value", { length: 128 }).notNull(),
    scope: varchar("scope", { length: 256 }).notNull(),
    issuingAuthority: varchar("issuing_authority", { length: 256 }),
    confidence: identifierConfidence("confidence").notNull(),
    ...temporalVersionColumns(),
  },
  (table) => [
    primaryKey({
      name: "identifier_assignments_pkey",
      columns: [table.identifierAssignmentId, table.validFrom],
    }),
    // Un identificador autoritativo no puede estar abierto para dos sujetos: eso
    // es el conflicto que el resolver manda a revisión manual, no un estado
    // válido de la base.
    uniqueIndex("identifier_assignments_authoritative_uidx")
      .on(table.identifierType, table.normalizedValue, table.scope)
      .where(
        sql`${table.confidence} = 'authoritative' and ${table.validTo} is null and ${table.supersededAt} is null`,
      ),
    index("identifier_assignments_lookup_idx").on(
      table.identifierType,
      table.normalizedValue,
      table.scope,
    ),
    index("identifier_assignments_subject_idx").on(
      table.subjectType,
      table.subjectId,
    ),
    ...temporalVersionChecks("identifier_assignments", table),
    check(
      "identifier_assignments_type_check",
      sql`${table.identifierType} ~ '^[a-z0-9]+(_[a-z0-9]+)*$'`,
    ),
  ],
);

/**
 * Pertenencia a un índice, colgada de la security. Una salida cierra el
 * intervalo: preguntar por el universo de una fecha pasada sigue siendo
 * respondible después de cada rebalanceo (`TM-06`).
 */
export const indexMemberships = pgTable(
  "index_memberships",
  {
    indexMembershipId: uuid("index_membership_id").notNull(),
    indexId: varchar("index_id", { length: 64 }).notNull(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.securityId),
    ...temporalVersionColumns(),
  },
  (table) => [
    primaryKey({
      name: "index_memberships_pkey",
      columns: [table.indexMembershipId, table.validFrom],
    }),
    uniqueIndex("index_memberships_open_uidx")
      .on(table.indexId, table.securityId)
      .where(openVersion(table)),
    index("index_memberships_index_idx").on(table.indexId, table.validFrom),
    ...temporalVersionChecks("index_memberships", table),
    check(
      "index_memberships_index_id_check",
      sql`${table.indexId} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
  ],
);

/**
 * Clasificaciones declaradas (`F7-02`, ADR 0025): de qué sector, arquetipo o
 * industria es un sujeto, según una taxonomía nombrada y en una versión.
 *
 * La tabla es **agnóstica de taxonomía** porque van a convivir al menos tres
 * respuestas distintas a «qué tipo de empresa es ésta» —el sector de las
 * matrices, el arquetipo de valuación (`F3-01`) y la industria de Damodaran
 * (`F3-05`)— y no son la misma pregunta. Sumar una es insertar filas con otra
 * `taxonomy_id`, no migrar el schema.
 *
 * `taxonomy_version` dice qué release de la fuente hizo la aserción: para la
 * taxonomía del paquete PDDL es el commit pineado, que es reproducible y
 * revisable en un diff. El `available_at` es el `committed_at` de ese commit y
 * no el instante de la descarga, que es lo que hace que un `as_known` anterior
 * al commit no vea la clasificación (`TM-06`).
 *
 * El índice único es la invariante central: un sujeto no puede tener dos
 * aserciones vigentes en la misma taxonomía. Puede tener una por taxonomía, que
 * es justamente el punto.
 */
export const classificationAssignments = pgTable(
  "classification_assignments",
  {
    classificationAssignmentId: uuid("classification_assignment_id").notNull(),
    subjectType: identifierSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    taxonomyId: varchar("taxonomy_id", { length: 64 }).notNull(),
    taxonomyVersion: varchar("taxonomy_version", { length: 128 }).notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    ...temporalVersionColumns(),
  },
  (table) => [
    primaryKey({
      name: "classification_assignments_pkey",
      columns: [table.classificationAssignmentId, table.validFrom],
    }),
    uniqueIndex("classification_assignments_open_uidx")
      .on(table.subjectType, table.subjectId, table.taxonomyId)
      .where(openVersion(table)),
    index("classification_assignments_taxonomy_idx").on(
      table.taxonomyId,
      table.code,
    ),
    index("classification_assignments_subject_idx").on(
      table.subjectType,
      table.subjectId,
    ),
    ...temporalVersionChecks("classification_assignments", table),
    check(
      "classification_assignments_taxonomy_id_check",
      sql`${table.taxonomyId} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "classification_assignments_code_check",
      sql`${table.code} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
  ],
);

export const priceEventType = pgEnum("price_event_type", ["split", "dividend"]);

/**
 * Cierres diarios crudos (`F7-01`, ADR 0026).
 *
 * **Crudo** es la decisión: la fuente publica la serie ajustada por los splits
 * posteriores y la reescribe hacia atrás cada vez que hay uno nuevo, así que
 * guardarla tal cual metería look-ahead en la base y haría que una fila dejara
 * de coincidir consigo misma después del próximo split. Guardando lo que se
 * operó, la fila es inmutable y la re-descarga es idempotente; el ajuste vuelve
 * a ser una política de lectura, como en la ADR 0012.
 *
 * La fila no guarda apertura, máximo, mínimo ni volumen: lo que las matrices y
 * las divergencias piden es cierre contra cierre, y no hay screener que
 * justifique el resto (ADR 0016). Tampoco guarda fuente, dataset ni parser —los
 * trae su corrida— ni el factor de des-ajuste, que se reconstruye con los
 * eventos de `price_events`: es la regla de la ADR 0018 aplicada a la tabla más
 * grande del proyecto, donde cada columna de más se multiplica por ~630.000.
 *
 * La clave es natural —(security, fecha)— y con eso una rueda no puede tener dos
 * cierres.
 */
export const securityPrices = pgTable(
  "security_prices",
  {
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.securityId),
    marketDate: date("market_date", { mode: "string" }).notNull(),
    close: numeric("close", { mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    ingestionRunId: uuid("ingestion_run_id")
      .notNull()
      .references(() => ingestionRuns.runId),
  },
  (table) => [
    primaryKey({
      name: "security_prices_pkey",
      columns: [table.securityId, table.marketDate],
    }),
    check("security_prices_close_check", sql`${table.close} >= 0`),
    check(
      "security_prices_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

/**
 * Eventos de la serie, fechados y **no aplicados** (ADR 0026).
 *
 * Los splits son la base de ajuste de las lecturas y la evidencia de cómo se
 * des-ajustó la serie al ingerirla. Los dividendos se guardan sin aplicar
 * porque la base de retorno de las matrices —reinvertidos o sólo precio— es un
 * parámetro abierto de `F7-04`: aplicarlos en la ingesta lo dejaría decidido a
 * espaldas de quien lo tiene que decidir.
 *
 * Estos eventos son los de la **fuente de precios**, y no reemplazan a los
 * splits verificados por regla contra la SEC de la ADR 0012: son otra fuente
 * diciendo lo mismo, y donde las dos existen, cruzarlas es una reconciliación.
 */
export const priceEvents = pgTable(
  "price_events",
  {
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.securityId),
    eventType: priceEventType("event_type").notNull(),
    effectiveOn: date("effective_on", { mode: "string" }).notNull(),
    /** Ratio decimal en un split; importe por acción en un dividendo. */
    value: numeric("value", { mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }),
    ingestionRunId: uuid("ingestion_run_id")
      .notNull()
      .references(() => ingestionRuns.runId),
  },
  (table) => [
    primaryKey({
      name: "price_events_pkey",
      columns: [table.securityId, table.eventType, table.effectiveOn],
    }),
    check("price_events_value_check", sql`${table.value} > 0`),
    // Un dividendo es un importe y necesita su moneda; un split es un ratio y
    // no tiene ninguna.
    check(
      "price_events_currency_check",
      sql`(${table.eventType} = 'dividend' and ${table.currency} is not null)
        or (${table.eventType} = 'split' and ${table.currency} is null)`,
    ),
  ],
);

/**
 * Nivel diario de una serie de referencia declarada (`F7-05`, ADR 0029).
 *
 * No es `security_prices` porque un índice no es una security: no tiene emisor,
 * y el grafo exige uno. La clave es el ID declarado en código
 * (`declared-benchmarks.ts`), no el símbolo de la fuente, que es un valor de
 * búsqueda. La fila es tan liviana como la de una security: fecha, nivel, moneda
 * y la corrida que aporta fuente y parser.
 */
export const benchmarkPrices = pgTable(
  "benchmark_prices",
  {
    benchmarkId: varchar("benchmark_id", { length: 64 }).notNull(),
    marketDate: date("market_date", { mode: "string" }).notNull(),
    close: numeric("close", { mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    ingestionRunId: uuid("ingestion_run_id")
      .notNull()
      .references(() => ingestionRuns.runId),
  },
  (table) => [
    primaryKey({
      name: "benchmark_prices_pkey",
      columns: [table.benchmarkId, table.marketDate],
    }),
    check("benchmark_prices_close_check", sql`${table.close} >= 0`),
    check(
      "benchmark_prices_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "benchmark_prices_benchmark_id_check",
      sql`${table.benchmarkId} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
  ],
);

/**
 * Releases de datasets de referencia (`F3-04`, ADR 0032): una tabla publicada
 * —las betas por industria de Damodaran, su riesgo país— observada entera en un
 * instante. Es una versión temporal: `valid_from` y `available_at` son la
 * observación, y una observación con otro contenido supersede a la vigente.
 */
export const referenceDatasetReleases = pgTable(
  "reference_dataset_releases",
  {
    releaseId: uuid("release_id").primaryKey(),
    datasetId: varchar("dataset_id", { length: 64 }).notNull(),
    publishedLabel: varchar("published_label", { length: 64 }),
    parserVersion: varchar("parser_version", { length: 64 }).notNull(),
    rowCount: integer("row_count").notNull(),
    ingestionRunId: uuid("ingestion_run_id").notNull(),
    ...temporalVersionColumns(),
  },
  (table) => [
    // Nombre explícito: el generado pasa los 63 caracteres de PostgreSQL.
    foreignKey({
      name: "reference_dataset_releases_run_fk",
      columns: [table.ingestionRunId],
      foreignColumns: [ingestionRuns.runId],
    }),
    uniqueIndex("reference_dataset_releases_open_uidx")
      .on(table.datasetId)
      .where(openVersion(table)),
    ...temporalVersionChecks("reference_dataset_releases", table),
    check(
      "reference_dataset_releases_dataset_id_check",
      sql`${table.datasetId} ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'`,
    ),
    check(
      "reference_dataset_releases_row_count_check",
      sql`${table.rowCount} between 1 and 5000`,
    ),
  ],
);

/**
 * Filas de una release: una industria, un país, un año o una banda de rating,
 * con sus valores como decimales canónicos o texto corto. Inmutables: una
 * corrección de la fuente es otra release, nunca un update.
 */
export const referenceDatasetRows = pgTable(
  "reference_dataset_rows",
  {
    releaseId: uuid("release_id").notNull(),
    rowKey: varchar("row_key", { length: 128 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    values: jsonb("values").$type<Record<string, string | null>>().notNull(),
  },
  (table) => [
    primaryKey({
      name: "reference_dataset_rows_pkey",
      columns: [table.releaseId, table.rowKey],
    }),
    // Nombre explícito: el que genera Drizzle pasa los 63 caracteres y
    // PostgreSQL lo trunca, así que una migración futura no lo encontraría.
    foreignKey({
      name: "reference_dataset_rows_release_fk",
      columns: [table.releaseId],
      foreignColumns: [referenceDatasetReleases.releaseId],
    }),
    check(
      "reference_dataset_rows_row_key_check",
      sql`${table.rowKey} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "reference_dataset_rows_values_check",
      sql`jsonb_typeof(${table.values}) = 'object'`,
    ),
  ],
);

export const depositaryProgramType = pgEnum("depositary_program_type", [
  "cedear",
  "adr",
  "gdr",
  "other",
]);

export const depositaryProgramStatus = pgEnum("depositary_program_status", [
  "active",
  "suspended",
  "terminated",
  "unknown",
]);

/**
 * Registro de programas depositarios (`F7-03`, ADR 0027): sólo declara que el
 * ID existe, como los registros de la migración `0004`. Hace falta porque el
 * ratio se versiona **aparte** del programa y tiene que poder apuntarle: en una
 * tabla versionada el mismo programa aparece una vez por versión.
 */
export const depositaryPrograms = pgTable("depositary_programs", {
  depositaryProgramId: uuid("depositary_program_id").primaryKey(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

/**
 * Versiones de un programa: la security del CEDEAR, su subyacente, el
 * depositario, el estado y el alcance.
 *
 * Las dos securities son filas distintas de `securities` y el check lo exige:
 * un programa **vincula** instrumentos, no los fusiona (`TM-06`). La evidencia
 * de la resolución —el ticker y el ISIN subyacente que la fuente declaró— se
 * guarda porque es lo único que permitiría detectar después una resolución
 * equivocada; no es identidad.
 */
export const depositaryProgramVersions = pgTable(
  "depositary_program_versions",
  {
    depositaryProgramId: uuid("depositary_program_id")
      .notNull()
      .references(() => depositaryPrograms.depositaryProgramId),
    programType: depositaryProgramType("program_type").notNull(),
    depositarySecurityId: uuid("depositary_security_id")
      .notNull()
      .references(() => securities.securityId),
    underlyingSecurityId: uuid("underlying_security_id")
      .notNull()
      .references(() => securities.securityId),
    depositaryLegalEntityId: uuid("depositary_legal_entity_id").references(
      () => legalEntities.legalEntityId,
    ),
    sponsorLegalEntityId: uuid("sponsor_legal_entity_id").references(
      () => legalEntities.legalEntityId,
    ),
    investorScope: varchar("investor_scope", { length: 256 }),
    status: depositaryProgramStatus("status").notNull(),
    reportedUnderlyingSymbol: varchar("reported_underlying_symbol", {
      length: 32,
    }),
    reportedUnderlyingIsin: char("reported_underlying_isin", { length: 12 }),
    ...temporalVersionColumns(),
  },
  (table) => [
    primaryKey({
      name: "depositary_program_versions_pkey",
      columns: [table.depositaryProgramId, table.validFrom],
    }),
    uniqueIndex("depositary_program_versions_open_uidx")
      .on(table.depositaryProgramId)
      .where(openVersion(table)),
    // Un CEDEAR es un programa: dos vigentes para la misma security serían dos
    // respuestas a «qué representa este instrumento».
    uniqueIndex("depositary_program_versions_depositary_open_uidx")
      .on(table.depositarySecurityId)
      .where(openVersion(table)),
    index("depositary_program_versions_underlying_idx").on(
      table.underlyingSecurityId,
    ),
    index("depositary_program_versions_depositary_entity_idx").on(
      table.depositaryLegalEntityId,
    ),
    ...temporalVersionChecks("depositary_program_versions", table),
    check(
      "depositary_program_versions_distinct_securities_check",
      sql`${table.depositarySecurityId} <> ${table.underlyingSecurityId}`,
    ),
    check(
      "depositary_program_versions_isin_check",
      sql`${table.reportedUnderlyingIsin} is null or ${table.reportedUnderlyingIsin} ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'`,
    ),
  ],
);

/**
 * Ratio del programa como fracción exacta, versionado **aparte** del programa
 * (ADR 0027, decisión 5): un cambio de ratio supersede sólo al ratio, y la
 * existencia del programa sobrevive. `numeric` guarda la fracción tal como el
 * emisor la escribe, sin pasar por un binario.
 */
export const depositaryRatios = pgTable(
  "depositary_ratios",
  {
    depositaryRatioId: uuid("depositary_ratio_id").notNull(),
    depositaryProgramId: uuid("depositary_program_id")
      .notNull()
      .references(() => depositaryPrograms.depositaryProgramId),
    depositaryUnits: numeric("depositary_units", { mode: "string" }).notNull(),
    underlyingUnits: numeric("underlying_units", { mode: "string" }).notNull(),
    announcedAt: timestamp("announced_at", {
      withTimezone: true,
      mode: "date",
    }),
    ...temporalVersionColumns(),
  },
  (table) => [
    primaryKey({
      name: "depositary_ratios_pkey",
      columns: [table.depositaryRatioId, table.validFrom],
    }),
    uniqueIndex("depositary_ratios_open_uidx")
      .on(table.depositaryProgramId)
      .where(openVersion(table)),
    ...temporalVersionChecks("depositary_ratios", table),
    check(
      "depositary_ratios_units_check",
      sql`${table.depositaryUnits} > 0 and ${table.underlyingUnits} > 0`,
    ),
  ],
);

export const corporateActionType = pgEnum("corporate_action_type", [
  "successor_issuer",
  "split",
  "reverse_split",
  "listing_transfer",
  "delisting",
  "acquisition",
  "symbol_change",
]);

export const legalEntityRelationshipType = pgEnum(
  "legal_entity_relationship_type",
  ["reporting_successor", "acquired_by"],
);

export const identityDecisionMaker = pgEnum("identity_decision_maker", [
  "rule",
  "owner",
]);

/**
 * Corporate actions (`F2-04`): el evento inmutable que cambia una relación o una
 * serie, con la presentación que lo hizo público.
 *
 * El sujeto es polimórfico como en `identifier_assignments` y reusa ese mismo
 * tipo. La fecha efectiva es calendaria, la de la fuente; el instante de vigencia
 * vive en la relación que el evento abre. Una accession describe a lo sumo un
 * evento de cada tipo: una segunda descripción es un conflicto, no una fila más.
 *
 * Un split (ADR 0012) es de la entidad legal: cambia la base accionaria de los
 * hechos que ese filer reporta, y no dice qué clase de acciones se dividió.
 * `corporate_actions_split_terms_check` espeja el schema de dominio: sujeto
 * entidad legal, ratio decimal canónico en `terms`, mayor que uno para `split` y
 * entre cero y uno para `reverse_split`. El `CASE` fija el orden de evaluación
 * para que el cast a `numeric` sólo corra sobre un texto que ya pasó el patrón, y
 * el tipo se compara como texto porque un valor de enum agregado en la misma
 * transacción no puede usarse como literal.
 *
 * Un traspaso de mercado y un delisting (ADR 0013) cambian listings:
 * `corporate_actions_listing_terms_check` exige security y dos MIC distintos para
 * el traspaso, y listing con su MIC para el delisting.
 */
export const corporateActions = pgTable(
  "corporate_actions",
  {
    corporateActionId: uuid("corporate_action_id").primaryKey(),
    actionType: corporateActionType("action_type").notNull(),
    subjectType: identifierSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    announcedAt: timestamp("announced_at", {
      withTimezone: true,
      mode: "date",
    }),
    effectiveOn: date("effective_on", { mode: "string" }).notNull(),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    sourceDocumentId: varchar("source_document_id", { length: 256 }).notNull(),
    terms: jsonb("terms")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    contentHash: text("content_hash").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("corporate_actions_source_document_uidx").on(
      table.sourceId,
      table.sourceDocumentId,
      table.actionType,
    ),
    index("corporate_actions_subject_idx").on(
      table.subjectType,
      table.subjectId,
      table.effectiveOn,
    ),
    check(
      "corporate_actions_content_hash_check",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "corporate_actions_announced_before_available_check",
      sql`${table.announcedAt} is null or ${table.announcedAt} <= ${table.availableAt}`,
    ),
    check(
      "corporate_actions_terms_object_check",
      sql`jsonb_typeof(${table.terms}) = 'object'`,
    ),
    check(
      "corporate_actions_split_terms_check",
      sql`case
        when ${table.actionType}::text not in ('split', 'reverse_split') then true
        when ${table.subjectType}::text <> 'legal_entity' then false
        when coalesce(${table.terms}->>'ratio', '') !~ '^(0|[1-9][0-9]*)([.][0-9]+)?$' then false
        when ${table.actionType}::text = 'split' then (${table.terms}->>'ratio')::numeric > 1
        else (${table.terms}->>'ratio')::numeric > 0 and (${table.terms}->>'ratio')::numeric < 1
      end`,
    ),
    check(
      "corporate_actions_declared_terms_check",
      sql`case when ${table.actionType}::text in ('acquisition', 'symbol_change') then
        coalesce(${table.terms}->>'decidedBy', '') = 'owner'
        and coalesce(${table.terms}->>'decidedAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{3})?Z$'
        and coalesce(${table.terms}->>'declarationHash', '') ~ '^[a-f0-9]{64}$'
        and length(coalesce(${table.terms}->>'rationale', '')) > 0
        and length(coalesce(${table.terms}->>'ruleVersion', '')) > 0
        and case when ${table.actionType}::text = 'acquisition' then
          ${table.subjectType}::text = 'legal_entity'
          and coalesce(${table.terms}->>'acquirerLegalEntityId', '') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
          and ${table.terms}->>'acquirerLegalEntityId' <> ${table.subjectId}::text
        else ${table.subjectType}::text = 'listing'
          and coalesce(${table.terms}->>'mic', '') ~ '^[A-Z0-9]{4}$'
          and coalesce(${table.terms}->>'fromSymbol', '') ~ '^[A-Z0-9][A-Z0-9.-]{0,31}$'
          and coalesce(${table.terms}->>'toSymbol', '') ~ '^[A-Z0-9][A-Z0-9.-]{0,31}$'
          and ${table.terms}->>'fromSymbol' <> ${table.terms}->>'toSymbol'
        end
      else true end`,
    ),
    check(
      "corporate_actions_listing_terms_check",
      sql`case
        when ${table.actionType}::text = 'listing_transfer' then ${table.subjectType}::text = 'security'
          and coalesce(${table.terms}->>'fromMic', '') ~ '^[A-Z0-9]{4}$'
          and coalesce(${table.terms}->>'toMic', '') ~ '^[A-Z0-9]{4}$'
          and ${table.terms}->>'fromMic' <> ${table.terms}->>'toMic'
        when ${table.actionType}::text = 'delisting' then ${table.subjectType}::text = 'listing'
          and coalesce(${table.terms}->>'mic', '') ~ '^[A-Z0-9]{4}$'
        else true
      end`,
    ),
  ],
);

/**
 * Vínculos versionados entre entidades legales. Las dos puntas referencian el
 * registro de la identidad, que es inmutable: un antecesor y un sucesor
 * conservan sus IDs y nunca se funden (invariante 9 del modelo de identidad).
 *
 * `reporting_successor` es el único tipo que une historias de reporte. Los
 * índices únicos parciales espejan lo que el linaje necesita para no tener que
 * elegir: un solo antecesor abierto por sucesor y un solo sucesor abierto por
 * antecesor. Los ciclos se rechazan en el dominio.
 *
 * `valid_from` es `effective_on` a las 00:00 de Nueva York: el check lo calcula
 * con la base de zonas de PostgreSQL y rechaza cualquier otra lectura de la fecha,
 * incluida medianoche UTC.
 */
export const legalEntityRelationships = pgTable(
  "legal_entity_relationships",
  {
    relationshipId: uuid("relationship_id").notNull(),
    relationshipType:
      legalEntityRelationshipType("relationship_type").notNull(),
    predecessorLegalEntityId: uuid("predecessor_legal_entity_id")
      .notNull()
      .references(() => legalEntities.legalEntityId),
    successorLegalEntityId: uuid("successor_legal_entity_id")
      .notNull()
      .references(() => legalEntities.legalEntityId),
    corporateActionId: uuid("corporate_action_id")
      .notNull()
      .references(() => corporateActions.corporateActionId),
    effectiveOn: date("effective_on", { mode: "string" }).notNull(),
    decidedBy: identityDecisionMaker("decided_by").notNull(),
    decisionRuleVersion: varchar("decision_rule_version", {
      length: 64,
    }).notNull(),
    ...temporalVersionColumns(),
  },
  (table) => [
    primaryKey({
      name: "legal_entity_relationships_pkey",
      columns: [table.relationshipId, table.validFrom],
    }),
    uniqueIndex("legal_entity_relationships_successor_open_uidx")
      .on(table.relationshipType, table.successorLegalEntityId)
      .where(
        sql`${openVersion(table)} and ${table.relationshipType} = 'reporting_successor'`,
      ),
    uniqueIndex("legal_entity_relationships_predecessor_open_uidx")
      .on(table.relationshipType, table.predecessorLegalEntityId)
      .where(openVersion(table)),
    index("legal_entity_relationships_predecessor_idx").on(
      table.predecessorLegalEntityId,
    ),
    ...temporalVersionChecks("legal_entity_relationships", table),
    check(
      "legal_entity_relationships_distinct_entities_check",
      sql`${table.predecessorLegalEntityId} <> ${table.successorLegalEntityId}`,
    ),
    check(
      "legal_entity_relationships_valid_from_check",
      sql`${table.validFrom} = (${table.effectiveOn}::timestamp at time zone 'America/New_York')`,
    ),
  ],
);
