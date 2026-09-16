CREATE TYPE "public"."ingestion_job_event_type" AS ENUM('job_created', 'job_paused', 'job_resumed', 'job_cancelled', 'job_completed', 'job_reopened', 'job_backoff', 'lease_acquired', 'lease_taken_over', 'lease_released', 'lease_force_released', 'item_started', 'item_completed', 'item_failed', 'item_retry_scheduled', 'item_poisoned', 'item_deferred', 'item_recovered', 'item_requeued');--> statement-breakpoint
CREATE TYPE "public"."ingestion_job_failure_code" AS ENUM('ingestion_failed', 'subject_rejected', 'executor_error', 'lease_expired', 'source_signal');--> statement-breakpoint
CREATE TYPE "public"."ingestion_job_item_status" AS ENUM('pending', 'running', 'completed', 'failed', 'poisoned');--> statement-breakpoint
CREATE TYPE "public"."ingestion_job_kind" AS ENUM('sec_companyfacts_backfill');--> statement-breakpoint
CREATE TYPE "public"."ingestion_job_status" AS ENUM('open', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "ingestion_job_events" (
	"event_sequence" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingestion_job_events_event_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" uuid NOT NULL,
	"ordinal" integer,
	"event_type" "ingestion_job_event_type" NOT NULL,
	"actor" varchar(128) NOT NULL,
	"lease_token" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "ingestion_job_events_ordinal_check" CHECK ("ingestion_job_events"."ordinal" is null or "ingestion_job_events"."ordinal" >= 0),
	CONSTRAINT "ingestion_job_events_detail_check" CHECK (jsonb_typeof("ingestion_job_events"."detail") = 'object'),
	CONSTRAINT "ingestion_job_events_actor_check" CHECK ("ingestion_job_events"."actor" ~ '^[A-Za-z0-9._:@/-]{1,128}$')
);
--> statement-breakpoint
CREATE TABLE "ingestion_job_items" (
	"job_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"subject_key" varchar(128) NOT NULL,
	"status" "ingestion_job_item_status" NOT NULL,
	"attempts" integer NOT NULL,
	"not_before" timestamp with time zone,
	"lease_token" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"ingestion_run_id" uuid,
	"failure_code" "ingestion_job_failure_code",
	"failure_message" varchar(240),
	"failure_retryable" boolean,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ingestion_job_items_pkey" PRIMARY KEY("job_id","ordinal"),
	CONSTRAINT "ingestion_job_items_ordinal_check" CHECK ("ingestion_job_items"."ordinal" >= 0),
	CONSTRAINT "ingestion_job_items_attempts_check" CHECK ("ingestion_job_items"."attempts" >= 0),
	CONSTRAINT "ingestion_job_items_running_check" CHECK (("ingestion_job_items"."status" = 'running') = ("ingestion_job_items"."lease_token" is not null) and ("ingestion_job_items"."status" <> 'running' or "ingestion_job_items"."started_at" is not null)),
	CONSTRAINT "ingestion_job_items_finished_check" CHECK (("ingestion_job_items"."status" in ('completed', 'failed', 'poisoned')) = ("ingestion_job_items"."finished_at" is not null)),
	CONSTRAINT "ingestion_job_items_completed_run_check" CHECK ("ingestion_job_items"."status" <> 'completed' or "ingestion_job_items"."ingestion_run_id" is not null),
	CONSTRAINT "ingestion_job_items_failure_check" CHECK (("ingestion_job_items"."failure_code" is null) = ("ingestion_job_items"."failure_message" is null) and ("ingestion_job_items"."failure_code" is null) = ("ingestion_job_items"."failure_retryable" is null)
        and ("ingestion_job_items"."status" not in ('failed', 'poisoned') or "ingestion_job_items"."failure_code" is not null)
        and ("ingestion_job_items"."status" <> 'pending' or "ingestion_job_items"."attempts" = 0 or "ingestion_job_items"."failure_code" is not null)),
	CONSTRAINT "ingestion_job_items_not_before_check" CHECK ("ingestion_job_items"."status" = 'pending' or "ingestion_job_items"."not_before" is null)
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"job_kind" "ingestion_job_kind" NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"dataset_id" varchar(128) NOT NULL,
	"parser_version" varchar(32) NOT NULL,
	"selection_version" varchar(64),
	"plan_hash" text NOT NULL,
	"item_count" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"status" "ingestion_job_status" NOT NULL,
	"cursor" integer NOT NULL,
	"not_before" timestamp with time zone,
	"status_reason" varchar(240),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ingestion_jobs_plan_hash_check" CHECK ("ingestion_jobs"."plan_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "ingestion_jobs_item_count_check" CHECK ("ingestion_jobs"."item_count" between 1 and 10000),
	CONSTRAINT "ingestion_jobs_max_attempts_check" CHECK ("ingestion_jobs"."max_attempts" between 1 and 10),
	CONSTRAINT "ingestion_jobs_cursor_check" CHECK ("ingestion_jobs"."cursor" between 0 and "ingestion_jobs"."item_count"),
	CONSTRAINT "ingestion_jobs_finished_check" CHECK (("ingestion_jobs"."status" in ('completed', 'cancelled')) = ("ingestion_jobs"."finished_at" is not null)),
	CONSTRAINT "ingestion_jobs_completion_check" CHECK (case
        when "ingestion_jobs"."status" = 'completed' then "ingestion_jobs"."cursor" = "ingestion_jobs"."item_count"
        when "ingestion_jobs"."status" = 'cancelled' then true
        else "ingestion_jobs"."cursor" < "ingestion_jobs"."item_count"
      end),
	CONSTRAINT "ingestion_jobs_timeline_check" CHECK ("ingestion_jobs"."updated_at" >= "ingestion_jobs"."created_at" and ("ingestion_jobs"."finished_at" is null or "ingestion_jobs"."finished_at" >= "ingestion_jobs"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "ingestion_source_leases" (
	"source_id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"holder" varchar(128) NOT NULL,
	"lease_token" uuid NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ingestion_source_leases_timeline_check" CHECK ("ingestion_source_leases"."acquired_at" <= "ingestion_source_leases"."heartbeat_at" and "ingestion_source_leases"."heartbeat_at" < "ingestion_source_leases"."expires_at"),
	CONSTRAINT "ingestion_source_leases_holder_check" CHECK ("ingestion_source_leases"."holder" ~ '^[A-Za-z0-9._:@/-]{1,128}$')
);
--> statement-breakpoint
ALTER TABLE "ingestion_job_events" ADD CONSTRAINT "ingestion_job_events_job_id_ingestion_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ingestion_jobs"("job_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_job_items" ADD CONSTRAINT "ingestion_job_items_job_id_ingestion_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ingestion_jobs"("job_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_job_items" ADD CONSTRAINT "ingestion_job_items_ingestion_run_id_ingestion_runs_run_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_source_leases" ADD CONSTRAINT "ingestion_source_leases_job_id_ingestion_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ingestion_jobs"("job_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_job_events_job_idx" ON "ingestion_job_events" USING btree ("job_id","event_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_job_items_subject_uidx" ON "ingestion_job_items" USING btree ("job_id","subject_key");--> statement-breakpoint
CREATE INDEX "ingestion_job_items_running_idx" ON "ingestion_job_items" USING btree ("job_id") WHERE "ingestion_job_items"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_jobs_active_plan_uidx" ON "ingestion_jobs" USING btree ("plan_hash") WHERE "ingestion_jobs"."status" in ('open', 'paused');--> statement-breakpoint
CREATE INDEX "ingestion_jobs_source_idx" ON "ingestion_jobs" USING btree ("source_id","status","created_at");