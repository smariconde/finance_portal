import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
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

export const sourceRightsDecision = pgEnum("source_rights_decision", [
  "unknown",
  "allowed",
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
    cursor: varchar("cursor", { length: 512 }),
    nextCursor: varchar("next_cursor", { length: 512 }),
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
  ],
);
