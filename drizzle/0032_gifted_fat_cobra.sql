ALTER TYPE "public"."valuation_job_gap" ADD VALUE 'run_recorded';--> statement-breakpoint
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_rule_check";--> statement-breakpoint
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_method_check";--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD COLUMN "snapshot_gap" varchar(64);--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD COLUMN "valuation_run_id" uuid;--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD COLUMN "run_status" varchar(16);--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_run_fk" FOREIGN KEY ("valuation_run_id") REFERENCES "public"."valuation_runs"("valuation_run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_run_check" CHECK (("valuation_jobs"."valuation_run_id" is null) = ("valuation_jobs"."run_status" is null)
        and ("valuation_jobs"."run_status" is null or "valuation_jobs"."run_status" in ('computed', 'requires_review', 'rejected'))
        and ("valuation_jobs"."valuation_run_id" is not null) = ("valuation_jobs"."gap" is not null and "valuation_jobs"."gap"::text = 'run_recorded')
        and ("valuation_jobs"."valuation_run_id" is null or ("valuation_jobs"."method_status" = 'selected' and "valuation_jobs"."method" = 'fcff_base'))
        and ("valuation_jobs"."snapshot_gap" is null or "valuation_jobs"."gap"::text = 'snapshot_not_assembled')
        and ("valuation_jobs"."snapshot_gap" is null or "valuation_jobs"."snapshot_gap" in ('method_not_derived', 'security_missing', 'cost_of_capital_unavailable', 'normalization_unavailable', 'revenue_history_insufficient', 'revenue_history_non_positive', 'base_margin_unavailable', 'sales_to_capital_unavailable', 'tax_rate_unavailable', 'employee_equity_not_proposed', 'shares_outstanding_unavailable', 'market_unavailable'))
        and ("valuation_jobs"."rule_version" = 'valuation-job-1.0.0' or "valuation_jobs"."gap" is null or "valuation_jobs"."gap"::text <> 'snapshot_not_assembled' or "valuation_jobs"."snapshot_gap" is not null)
        and ("valuation_jobs"."rule_version" = 'valuation-job-1.1.0' or ("valuation_jobs"."snapshot_gap" is null and "valuation_jobs"."valuation_run_id" is null)));--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_rule_check" CHECK ("valuation_jobs"."rule_version" in ('valuation-job-1.0.0', 'valuation-job-1.1.0'));--> statement-breakpoint
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_method_check" CHECK (("valuation_jobs"."method_status" is null or "valuation_jobs"."method_status" in ('selected', 'unsupported_method'))
        and ("valuation_jobs"."asset_profile" is null or "valuation_jobs"."asset_profile" in ('non_financial_mature', 'high_growth', 'loss_making', 'bank', 'insurer', 'reit', 'cyclical', 'commodity', 'holding', 'distressed'))
        and ("valuation_jobs"."method" is null or "valuation_jobs"."method" in ('fcff_base', 'fcff_three_stage', 'revenue_margin_survival', 'excess_return', 'affo_nav', 'normalized_fcff', 'sotp_nav', 'apv_scenarios'))
        and ("valuation_jobs"."rigor" is null or "valuation_jobs"."rigor" in ('full', 'standard', 'screening', 'unsupported'))
        and ("valuation_jobs"."unsupported_reason" is null or "valuation_jobs"."unsupported_reason" in ('missing_classification_evidence', 'conflicting_evidence', 'method_not_implemented', 'missing_required_input'))
        and (("valuation_jobs"."gap" = 'snapshot_not_assembled') is not distinct from ("valuation_jobs"."method_status" = 'selected' and "valuation_jobs"."method" is not null and "valuation_jobs"."asset_profile" is not null and "valuation_jobs"."rigor" is not null and "valuation_jobs"."unsupported_reason" is null) or "valuation_jobs"."gap" is distinct from 'snapshot_not_assembled')
        and (("valuation_jobs"."gap" = 'unsupported_method') is not distinct from ("valuation_jobs"."method_status" = 'unsupported_method' and "valuation_jobs"."unsupported_reason" is not null) or "valuation_jobs"."gap" is distinct from 'unsupported_method')
        and ("valuation_jobs"."method_status" is null or "valuation_jobs"."gap"::text in ('snapshot_not_assembled', 'unsupported_method', 'annual_fundamentals', 'run_recorded'))
        and ("valuation_jobs"."method_status" is not null or ("valuation_jobs"."method" is null and "valuation_jobs"."asset_profile" is null and "valuation_jobs"."rigor" is null and "valuation_jobs"."unsupported_reason" is null)));