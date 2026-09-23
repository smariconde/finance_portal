import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
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
      "ingestion_source_controls_timeline_check",
      sql`${table.supersededAt} is null or ${table.supersededAt} >= ${table.recordedAt}`,
    ),
    check(
      "ingestion_source_controls_actor_check",
      sql`${table.actor} ~ '^[A-Za-z0-9._:@/-]{1,128}$'`,
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
