import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
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
    // Publicación de la fuente solicitada: distingue una enmienda posterior de
    // un replay exacto del mismo `as_of`.
    requestedVintage: date("requested_vintage", { mode: "string" }),
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
 */
export const observations = pgTable(
  "observations",
  {
    observationId: uuid("observation_id").primaryKey(),
    subjectType: observationSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    metricId: varchar("metric_id", { length: 128 }).notNull(),
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
    revisionGroupId: text("revision_group_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    restatementOfId: uuid("restatement_of_id"),
    contentHash: text("content_hash").notNull(),
    qualityFlags: jsonb("quality_flags")
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArray),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    datasetId: varchar("dataset_id", { length: 128 }).notNull(),
    parserVersion: varchar("parser_version", { length: 32 }).notNull(),
    sourceDocumentId: varchar("source_document_id", { length: 256 }),
    externalId: varchar("external_id", { length: 256 }).notNull(),
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
    index("observations_subject_idx").on(
      table.subjectType,
      table.subjectId,
      table.metricId,
      table.asOf,
    ),
    index("observations_knowledge_idx").on(table.availableAt, table.recordedAt),
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
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$' and ${table.revisionGroupId} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "observations_currency_check",
      sql`${table.currency} is null or ${table.currency} ~ '^[A-Z]{3}$'`,
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
