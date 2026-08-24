CREATE TYPE "public"."ingestion_failure_code" AS ENUM('source_not_registered', 'dataset_not_registered', 'rights_not_approved', 'provider_error', 'provider_contract_invalid', 'unknown_error');--> statement-breakpoint
CREATE TYPE "public"."ingestion_run_status" AS ENUM('running', 'succeeded', 'partial', 'empty', 'duplicate', 'quarantined', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_approval_status" AS ENUM('rights_unreviewed', 'rights_review_pending', 'approved_for_spike', 'approved_personal', 'approved_public_demo', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."source_authentication" AS ENUM('none', 'api_key', 'account', 'other');--> statement-breakpoint
CREATE TYPE "public"."source_rights_decision" AS ENUM('unknown', 'allowed', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."source_technical_status" AS ENUM('proposed', 'technical_reviewed', 'spike_ready', 'integrated', 'suspended');--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"dataset_id" varchar(128) NOT NULL,
	"parser_version" varchar(32) NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_as_of" date,
	"cursor" varchar(512),
	"next_cursor" varchar(512),
	"status" "ingestion_run_status" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"content_hash" text,
	"failure_code" "ingestion_failure_code",
	"failure_message" varchar(240),
	"failure_retryable" boolean,
	"quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"replay_of_run_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_runs_counts_non_negative_check" CHECK ("ingestion_runs"."fetched_count" >= 0 and "ingestion_runs"."accepted_count" >= 0 and "ingestion_runs"."rejected_count" >= 0 and "ingestion_runs"."duplicate_count" >= 0),
	CONSTRAINT "ingestion_runs_counts_balance_check" CHECK ("ingestion_runs"."status" in ('running', 'failed') or "ingestion_runs"."accepted_count" + "ingestion_runs"."rejected_count" + "ingestion_runs"."duplicate_count" = "ingestion_runs"."fetched_count"),
	CONSTRAINT "ingestion_runs_open_run_check" CHECK (("ingestion_runs"."status" = 'running') = ("ingestion_runs"."finished_at" is null)),
	CONSTRAINT "ingestion_runs_finished_after_started_check" CHECK ("ingestion_runs"."finished_at" is null or "ingestion_runs"."finished_at" >= "ingestion_runs"."started_at"),
	CONSTRAINT "ingestion_runs_failure_check" CHECK (("ingestion_runs"."status" = 'failed') = ("ingestion_runs"."failure_code" is not null and "ingestion_runs"."failure_message" is not null and "ingestion_runs"."failure_retryable" is not null)),
	CONSTRAINT "ingestion_runs_content_hash_check" CHECK (case when "ingestion_runs"."status" in ('running', 'failed') then "ingestion_runs"."content_hash" is null else "ingestion_runs"."content_hash" ~ '^[a-f0-9]{64}$' end),
	CONSTRAINT "ingestion_runs_idempotency_key_check" CHECK ("ingestion_runs"."idempotency_key" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "source_registry" (
	"source_id" varchar(64) PRIMARY KEY NOT NULL,
	"display_name" varchar(256) NOT NULL,
	"owner" varchar(256) NOT NULL,
	"canonical_url" text NOT NULL,
	"documentation_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"datasets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"endpoints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"authentication" "source_authentication" NOT NULL,
	"applicable_plan" varchar(256),
	"rate_limit" varchar(256),
	"attribution" varchar(256),
	"expected_cadence" varchar(256) NOT NULL,
	"freshness_target" varchar(256) NOT NULL,
	"timezone" varchar(256),
	"units" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"currencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parser_version" varchar(32),
	"fixture_policy" text NOT NULL,
	"fallback_source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"personal_use_right" "source_rights_decision" DEFAULT 'unknown' NOT NULL,
	"automated_access_right" "source_rights_decision" DEFAULT 'unknown' NOT NULL,
	"raw_storage_right" "source_rights_decision" DEFAULT 'unknown' NOT NULL,
	"normalized_storage_right" "source_rights_decision" DEFAULT 'unknown' NOT NULL,
	"derived_storage_right" "source_rights_decision" DEFAULT 'unknown' NOT NULL,
	"public_display_right" "source_rights_decision" DEFAULT 'unknown' NOT NULL,
	"export_right" "source_rights_decision" DEFAULT 'unknown' NOT NULL,
	"ai_transfer_right" "source_rights_decision" DEFAULT 'unknown' NOT NULL,
	"technical_status" "source_technical_status" NOT NULL,
	"approval_status" "source_approval_status" DEFAULT 'rights_unreviewed' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"rights_reviewed_at" timestamp with time zone,
	"rights_review_due_at" timestamp with time zone,
	"review_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retention_classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quota_policy_id" varchar(256),
	"owner_notes" text DEFAULT '' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_registry_source_id_check" CHECK ("source_registry"."source_id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "source_registry_rights_review_check" CHECK ("source_registry"."approval_status" not in ('approved_for_spike', 'approved_personal', 'approved_public_demo') or "source_registry"."rights_reviewed_at" is not null),
	CONSTRAINT "source_registry_public_display_check" CHECK ("source_registry"."approval_status" <> 'approved_public_demo' or "source_registry"."public_display_right" = 'allowed')
);
--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_dataset_idx" ON "ingestion_runs" USING btree ("source_id","dataset_id","started_at");--> statement-breakpoint
CREATE INDEX "ingestion_runs_idempotency_idx" ON "ingestion_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_runs_publishable_idempotency_uidx" ON "ingestion_runs" USING btree ("idempotency_key") WHERE "ingestion_runs"."status" in ('succeeded', 'partial');--> statement-breakpoint
CREATE INDEX "source_registry_approval_idx" ON "source_registry" USING btree ("approval_status","technical_status");