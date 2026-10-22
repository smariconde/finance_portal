ALTER TYPE "public"."valuation_job_gap" ADD VALUE 'data_ingested';--> statement-breakpoint
ALTER TYPE "public"."valuation_job_gap" ADD VALUE 'ingestion_pending';--> statement-breakpoint
ALTER TYPE "public"."valuation_job_gap" ADD VALUE 'ingestion_failed';--> statement-breakpoint
ALTER TYPE "public"."valuation_job_gap" ADD VALUE 'point_in_time_audit_failed';--> statement-breakpoint
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_rule_check";--> statement-breakpoint
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_run_check";--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD COLUMN "data_step" jsonb;--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD COLUMN "follows_job_id" uuid;--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_follows_fk" FOREIGN KEY ("follows_job_id") REFERENCES "public"."valuation_jobs"("job_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valuation_jobs_follows_uidx" ON "valuation_jobs" USING btree ("follows_job_id") WHERE "valuation_jobs"."follows_job_id" is not null;--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_data_check" CHECK (("valuation_jobs"."data_step" is null or ("valuation_jobs"."rule_version" = 'valuation-job-1.2.0' and "valuation_jobs"."status" = 'completed' and jsonb_typeof("valuation_jobs"."data_step") = 'object'))
        and ("valuation_jobs"."follows_job_id" is null or ("valuation_jobs"."rule_version" = 'valuation-job-1.2.0' and "valuation_jobs"."follows_job_id" <> "valuation_jobs"."job_id"))
        and ("valuation_jobs"."gap" is null or "valuation_jobs"."gap"::text not in ('data_ingested', 'ingestion_pending', 'ingestion_failed', 'point_in_time_audit_failed') or ("valuation_jobs"."data_step" is not null and "valuation_jobs"."method_status" is null))
        and ("valuation_jobs"."heartbeat_at" is null or ("valuation_jobs"."started_at" is not null and "valuation_jobs"."heartbeat_at" >= "valuation_jobs"."started_at")));--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_rule_check" CHECK ("valuation_jobs"."rule_version" in ('valuation-job-1.0.0', 'valuation-job-1.1.0', 'valuation-job-1.2.0'));--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_run_check" CHECK (("valuation_jobs"."valuation_run_id" is null) = ("valuation_jobs"."run_status" is null)
        and ("valuation_jobs"."run_status" is null or "valuation_jobs"."run_status" in ('computed', 'requires_review', 'rejected'))
        and ("valuation_jobs"."valuation_run_id" is not null) = ("valuation_jobs"."gap" is not null and "valuation_jobs"."gap"::text = 'run_recorded')
        and ("valuation_jobs"."valuation_run_id" is null or ("valuation_jobs"."method_status" = 'selected' and "valuation_jobs"."method" = 'fcff_base'))
        and ("valuation_jobs"."snapshot_gap" is null or "valuation_jobs"."gap"::text = 'snapshot_not_assembled')
        and ("valuation_jobs"."snapshot_gap" is null or "valuation_jobs"."snapshot_gap" in ('method_not_derived', 'security_missing', 'cost_of_capital_unavailable', 'normalization_unavailable', 'revenue_history_insufficient', 'revenue_history_non_positive', 'base_margin_unavailable', 'sales_to_capital_unavailable', 'tax_rate_unavailable', 'employee_equity_not_proposed', 'shares_outstanding_unavailable', 'market_unavailable'))
        and ("valuation_jobs"."rule_version" = 'valuation-job-1.0.0' or "valuation_jobs"."gap" is null or "valuation_jobs"."gap"::text <> 'snapshot_not_assembled' or "valuation_jobs"."snapshot_gap" is not null)
        and ("valuation_jobs"."rule_version" <> 'valuation-job-1.0.0' or ("valuation_jobs"."snapshot_gap" is null and "valuation_jobs"."valuation_run_id" is null)));