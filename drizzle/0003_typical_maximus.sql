CREATE TYPE "public"."valuation_failure_code" AS ENUM('invalid_decimal', 'non_finite_value', 'division_by_zero', 'policy_check_failed', 'unsupported_method');--> statement-breakpoint
CREATE TYPE "public"."valuation_run_status" AS ENUM('computed', 'requires_review', 'rejected');--> statement-breakpoint
CREATE TABLE "valuation_runs" (
	"valuation_run_id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"listing_id" uuid,
	"depositary_program_id" uuid,
	"as_of" date NOT NULL,
	"currency" varchar(3) NOT NULL,
	"asset_profile" varchar(32) NOT NULL,
	"method" varchar(64) NOT NULL,
	"engine_version" varchar(32) NOT NULL,
	"methodology_version" varchar(32) NOT NULL,
	"decimal_precision" integer NOT NULL,
	"decimal_rounding" varchar(32) NOT NULL,
	"status" "valuation_run_status" NOT NULL,
	"input_hash" text NOT NULL,
	"result_hash" text,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"failure_code" "valuation_failure_code",
	"failure_message" varchar(240),
	"failure_subjects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valuation_runs_hash_check" CHECK ("valuation_runs"."input_hash" ~ '^[a-f0-9]{64}$' and ("valuation_runs"."result_hash" is null or "valuation_runs"."result_hash" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "valuation_runs_outcome_check" CHECK (("valuation_runs"."status" = 'rejected') = ("valuation_runs"."result" is null and "valuation_runs"."result_hash" is null and "valuation_runs"."failure_code" is not null and "valuation_runs"."failure_message" is not null)),
	CONSTRAINT "valuation_runs_finished_after_started_check" CHECK ("valuation_runs"."finished_at" >= "valuation_runs"."started_at"),
	CONSTRAINT "valuation_runs_currency_check" CHECK ("valuation_runs"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "valuation_runs_decimal_policy_check" CHECK ("valuation_runs"."decimal_precision" > 0 and "valuation_runs"."decimal_rounding" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "valuation_runs_replay_uidx" ON "valuation_runs" USING btree ("input_hash","engine_version","methodology_version");--> statement-breakpoint
CREATE INDEX "valuation_runs_subject_idx" ON "valuation_runs" USING btree ("legal_entity_id","security_id","as_of");