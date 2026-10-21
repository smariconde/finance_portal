CREATE TYPE "public"."valuation_job_gap" AS ENUM('unresolved_ticker', 'ambiguous_ticker', 'identity_conflict', 'cik_missing', 'annual_fundamentals', 'unsupported_method', 'snapshot_not_assembled', 'assessment_failed');--> statement-breakpoint
CREATE TYPE "public"."valuation_job_identity" AS ENUM('resolved', 'ambiguous', 'not_found', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."valuation_job_status" AS ENUM('queued', 'running', 'completed');--> statement-breakpoint
CREATE TABLE "valuation_jobs" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"ticker" varchar(16) NOT NULL,
	"status" "valuation_job_status" NOT NULL,
	"known_at" timestamp with time zone NOT NULL,
	"rule_version" varchar(64) NOT NULL,
	"identity_status" "valuation_job_identity",
	"legal_entity_id" uuid,
	"security_id" uuid,
	"listing_id" uuid,
	"gap" "valuation_job_gap",
	"method_status" varchar(32),
	"asset_profile" varchar(32),
	"method" varchar(64),
	"rigor" varchar(16),
	"unsupported_reason" varchar(64),
	"claim_token" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "valuation_jobs_ticker_check" CHECK ("valuation_jobs"."ticker" ~ '^[A-Z][A-Z0-9.-]{0,15}$'),
	CONSTRAINT "valuation_jobs_rule_check" CHECK ("valuation_jobs"."rule_version" = 'valuation-job-1.0.0'),
	CONSTRAINT "valuation_jobs_phase_check" CHECK (case "valuation_jobs"."status"
        when 'queued' then "valuation_jobs"."started_at" is null and "valuation_jobs"."finished_at" is null and "valuation_jobs"."gap" is null and "valuation_jobs"."claim_token" is null and "valuation_jobs"."identity_status" is null and "valuation_jobs"."legal_entity_id" is null
        when 'running' then "valuation_jobs"."started_at" is not null and "valuation_jobs"."finished_at" is null and "valuation_jobs"."gap" is null and "valuation_jobs"."claim_token" is not null and "valuation_jobs"."identity_status" is null and "valuation_jobs"."legal_entity_id" is null
        else "valuation_jobs"."started_at" is not null and "valuation_jobs"."finished_at" is not null and "valuation_jobs"."gap" is not null and "valuation_jobs"."claim_token" is null
      end),
	CONSTRAINT "valuation_jobs_timeline_check" CHECK ("valuation_jobs"."known_at" <= "valuation_jobs"."created_at"
        and ("valuation_jobs"."started_at" is null or "valuation_jobs"."started_at" >= "valuation_jobs"."created_at")
        and ("valuation_jobs"."finished_at" is null or ("valuation_jobs"."started_at" is not null and "valuation_jobs"."finished_at" >= "valuation_jobs"."started_at"))),
	CONSTRAINT "valuation_jobs_identity_check" CHECK (("valuation_jobs"."gap" = 'unresolved_ticker') = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'not_found')
        and ("valuation_jobs"."gap" = 'ambiguous_ticker') = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'ambiguous')
        and ("valuation_jobs"."gap" = 'identity_conflict') = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'conflict')
        and ("valuation_jobs"."legal_entity_id" is not null) = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'resolved')
        and ("valuation_jobs"."security_id" is null or "valuation_jobs"."legal_entity_id" is not null)
        and ("valuation_jobs"."listing_id" is null or "valuation_jobs"."security_id" is not null)
        and ("valuation_jobs"."gap" is null or "valuation_jobs"."gap" in ('unresolved_ticker', 'ambiguous_ticker', 'identity_conflict', 'assessment_failed') or "valuation_jobs"."legal_entity_id" is not null)),
	CONSTRAINT "valuation_jobs_method_check" CHECK (("valuation_jobs"."method_status" is null or "valuation_jobs"."method_status" in ('selected', 'unsupported_method'))
        and ("valuation_jobs"."asset_profile" is null or "valuation_jobs"."asset_profile" in ('non_financial_mature', 'high_growth', 'loss_making', 'bank', 'insurer', 'reit', 'cyclical', 'commodity', 'holding', 'distressed'))
        and ("valuation_jobs"."method" is null or "valuation_jobs"."method" in ('fcff_base', 'fcff_three_stage', 'revenue_margin_survival', 'excess_return', 'affo_nav', 'normalized_fcff', 'sotp_nav', 'apv_scenarios'))
        and ("valuation_jobs"."rigor" is null or "valuation_jobs"."rigor" in ('full', 'standard', 'screening', 'unsupported'))
        and ("valuation_jobs"."unsupported_reason" is null or "valuation_jobs"."unsupported_reason" in ('missing_classification_evidence', 'conflicting_evidence', 'method_not_implemented', 'missing_required_input'))
        and (("valuation_jobs"."gap" = 'snapshot_not_assembled') is not distinct from ("valuation_jobs"."method_status" = 'selected' and "valuation_jobs"."method" is not null and "valuation_jobs"."asset_profile" is not null and "valuation_jobs"."rigor" is not null and "valuation_jobs"."unsupported_reason" is null) or "valuation_jobs"."gap" is distinct from 'snapshot_not_assembled')
        and (("valuation_jobs"."gap" = 'unsupported_method') is not distinct from ("valuation_jobs"."method_status" = 'unsupported_method' and "valuation_jobs"."unsupported_reason" is not null) or "valuation_jobs"."gap" is distinct from 'unsupported_method')
        and ("valuation_jobs"."method_status" is null or "valuation_jobs"."gap" in ('snapshot_not_assembled', 'unsupported_method', 'annual_fundamentals'))
        and ("valuation_jobs"."method_status" is not null or ("valuation_jobs"."method" is null and "valuation_jobs"."asset_profile" is null and "valuation_jobs"."rigor" is null and "valuation_jobs"."unsupported_reason" is null)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "valuation_jobs_open_ticker_uidx" ON "valuation_jobs" USING btree ("ticker") WHERE "valuation_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "valuation_jobs_ticker_idx" ON "valuation_jobs" USING btree ("ticker","created_at");