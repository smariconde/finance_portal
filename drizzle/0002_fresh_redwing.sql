CREATE TYPE "public"."observation_period_type" AS ENUM('instant', 'daily', 'monthly', 'quarter', 'annual', 'ttm');--> statement-breakpoint
CREATE TYPE "public"."observation_subject_type" AS ENUM('legal_entity', 'security', 'listing', 'macro_series');--> statement-breakpoint
CREATE TYPE "public"."observation_value_basis" AS ENUM('reported', 'normalized');--> statement-breakpoint
CREATE TYPE "public"."raw_value_status" AS ENUM('stored', 'not_provided', 'license_restricted');--> statement-breakpoint
CREATE TABLE "observations" (
	"observation_id" uuid PRIMARY KEY NOT NULL,
	"subject_type" "observation_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"metric_id" varchar(128) NOT NULL,
	"concept" varchar(128) NOT NULL,
	"as_of" date NOT NULL,
	"period_start" date,
	"period_end" date,
	"period_type" "observation_period_type" NOT NULL,
	"unit" varchar(32) NOT NULL,
	"currency" varchar(3),
	"raw_value" numeric,
	"raw_value_status" "raw_value_status" NOT NULL,
	"normalized_value" numeric,
	"transformation_id" varchar(128),
	"value_basis" "observation_value_basis" NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision_group_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"restatement_of_id" uuid,
	"content_hash" text NOT NULL,
	"quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"dataset_id" varchar(128) NOT NULL,
	"parser_version" varchar(32) NOT NULL,
	"source_document_id" varchar(256),
	"external_id" varchar(256) NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	CONSTRAINT "observations_raw_value_status_check" CHECK (("observations"."raw_value_status" = 'stored' and "observations"."raw_value" is not null) or ("observations"."raw_value_status" <> 'stored' and "observations"."raw_value" is null)),
	CONSTRAINT "observations_normalized_value_check" CHECK ("observations"."normalized_value" is null or "observations"."transformation_id" is not null),
	CONSTRAINT "observations_period_check" CHECK (case when "observations"."period_type" = 'instant' then "observations"."period_start" is null and "observations"."period_end" is null else "observations"."period_start" is not null and "observations"."period_end" is not null and "observations"."period_start" <= "observations"."period_end" end),
	CONSTRAINT "observations_revision_chain_check" CHECK (("observations"."revision_number" = 1) = ("observations"."restatement_of_id" is null) and "observations"."revision_number" >= 1),
	CONSTRAINT "observations_superseded_after_available_check" CHECK ("observations"."superseded_at" is null or "observations"."superseded_at" > "observations"."available_at"),
	CONSTRAINT "observations_content_hash_check" CHECK ("observations"."content_hash" ~ '^[a-f0-9]{64}$' and "observations"."revision_group_id" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "observations_currency_check" CHECK ("observations"."currency" is null or "observations"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "requested_vintage" date;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_ingestion_run_id_ingestion_runs_run_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "observations_revision_uidx" ON "observations" USING btree ("revision_group_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_current_revision_uidx" ON "observations" USING btree ("revision_group_id") WHERE "observations"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "observations_subject_idx" ON "observations" USING btree ("subject_type","subject_id","metric_id","as_of");--> statement-breakpoint
CREATE INDEX "observations_knowledge_idx" ON "observations" USING btree ("available_at","recorded_at");