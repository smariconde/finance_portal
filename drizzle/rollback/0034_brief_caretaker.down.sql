-- Manual rollback for 0034_brief_caretaker.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Removes the data step, the follow-up link and the heartbeat from the
-- ticker-valuation jobs (F6-05, ADR 0051). Refuses while a valuation-job-1.2.0
-- row exists: it records what a job downloaded and audited (TM-16), and
-- rewriting it as 1.1.0 would say something it never said. Delete those jobs
-- deliberately first. PostgreSQL cannot drop an enum value, so the gap type is
-- rebuilt, and the checks that compare it are dropped and restored as 0032 left
-- them.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "valuation_jobs" WHERE "rule_version" = 'valuation-job-1.2.0'
  ) THEN
    RAISE EXCEPTION 'a valuation-job-1.2.0 job exists; remove it deliberately before rolling back 0034';
  END IF;
END
$$;
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_data_check";
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_follows_fk";
DROP INDEX "valuation_jobs_follows_uidx";
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_rule_check";
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_run_check";
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_method_check";
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_identity_check";
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_phase_check";
ALTER TABLE "valuation_jobs" DROP COLUMN "heartbeat_at";
ALTER TABLE "valuation_jobs" DROP COLUMN "follows_job_id";
ALTER TABLE "valuation_jobs" DROP COLUMN "data_step";
ALTER TABLE "valuation_jobs" ALTER COLUMN "gap" TYPE text;
DROP TYPE "public"."valuation_job_gap";
CREATE TYPE "public"."valuation_job_gap" AS ENUM('unresolved_ticker', 'ambiguous_ticker', 'identity_conflict', 'cik_missing', 'annual_fundamentals', 'unsupported_method', 'snapshot_not_assembled', 'assessment_failed', 'run_recorded');
ALTER TABLE "valuation_jobs"
  ALTER COLUMN "gap" TYPE "public"."valuation_job_gap"
  USING "gap"::"public"."valuation_job_gap";
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_rule_check" CHECK ("valuation_jobs"."rule_version" in ('valuation-job-1.0.0', 'valuation-job-1.1.0'));
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_phase_check" CHECK (case "valuation_jobs"."status"
        when 'queued' then "valuation_jobs"."started_at" is null and "valuation_jobs"."finished_at" is null and "valuation_jobs"."gap" is null and "valuation_jobs"."claim_token" is null and "valuation_jobs"."identity_status" is null and "valuation_jobs"."legal_entity_id" is null
        when 'running' then "valuation_jobs"."started_at" is not null and "valuation_jobs"."finished_at" is null and "valuation_jobs"."gap" is null and "valuation_jobs"."claim_token" is not null and "valuation_jobs"."identity_status" is null and "valuation_jobs"."legal_entity_id" is null
        else "valuation_jobs"."started_at" is not null and "valuation_jobs"."finished_at" is not null and "valuation_jobs"."gap" is not null and "valuation_jobs"."claim_token" is null
      end);
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_identity_check" CHECK (("valuation_jobs"."gap" = 'unresolved_ticker') = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'not_found')
        and ("valuation_jobs"."gap" = 'ambiguous_ticker') = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'ambiguous')
        and ("valuation_jobs"."gap" = 'identity_conflict') = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'conflict')
        and ("valuation_jobs"."legal_entity_id" is not null) = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'resolved')
        and ("valuation_jobs"."security_id" is null or "valuation_jobs"."legal_entity_id" is not null)
        and ("valuation_jobs"."listing_id" is null or "valuation_jobs"."security_id" is not null)
        and ("valuation_jobs"."gap" is null or "valuation_jobs"."gap" in ('unresolved_ticker', 'ambiguous_ticker', 'identity_conflict', 'assessment_failed') or "valuation_jobs"."legal_entity_id" is not null));
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_method_check" CHECK (("valuation_jobs"."method_status" is null or "valuation_jobs"."method_status" in ('selected', 'unsupported_method'))
        and ("valuation_jobs"."asset_profile" is null or "valuation_jobs"."asset_profile" in ('non_financial_mature', 'high_growth', 'loss_making', 'bank', 'insurer', 'reit', 'cyclical', 'commodity', 'holding', 'distressed'))
        and ("valuation_jobs"."method" is null or "valuation_jobs"."method" in ('fcff_base', 'fcff_three_stage', 'revenue_margin_survival', 'excess_return', 'affo_nav', 'normalized_fcff', 'sotp_nav', 'apv_scenarios'))
        and ("valuation_jobs"."rigor" is null or "valuation_jobs"."rigor" in ('full', 'standard', 'screening', 'unsupported'))
        and ("valuation_jobs"."unsupported_reason" is null or "valuation_jobs"."unsupported_reason" in ('missing_classification_evidence', 'conflicting_evidence', 'method_not_implemented', 'missing_required_input'))
        and (("valuation_jobs"."gap" = 'snapshot_not_assembled') is not distinct from ("valuation_jobs"."method_status" = 'selected' and "valuation_jobs"."method" is not null and "valuation_jobs"."asset_profile" is not null and "valuation_jobs"."rigor" is not null and "valuation_jobs"."unsupported_reason" is null) or "valuation_jobs"."gap" is distinct from 'snapshot_not_assembled')
        and (("valuation_jobs"."gap" = 'unsupported_method') is not distinct from ("valuation_jobs"."method_status" = 'unsupported_method' and "valuation_jobs"."unsupported_reason" is not null) or "valuation_jobs"."gap" is distinct from 'unsupported_method')
        and ("valuation_jobs"."method_status" is null or "valuation_jobs"."gap" in ('snapshot_not_assembled', 'unsupported_method', 'annual_fundamentals', 'run_recorded'))
        and ("valuation_jobs"."method_status" is not null or ("valuation_jobs"."method" is null and "valuation_jobs"."asset_profile" is null and "valuation_jobs"."rigor" is null and "valuation_jobs"."unsupported_reason" is null)));
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_run_check" CHECK (("valuation_jobs"."valuation_run_id" is null) = ("valuation_jobs"."run_status" is null)
        and ("valuation_jobs"."run_status" is null or "valuation_jobs"."run_status" in ('computed', 'requires_review', 'rejected'))
        and ("valuation_jobs"."valuation_run_id" is not null) = ("valuation_jobs"."gap" is not null and "valuation_jobs"."gap" = 'run_recorded')
        and ("valuation_jobs"."valuation_run_id" is null or ("valuation_jobs"."method_status" = 'selected' and "valuation_jobs"."method" = 'fcff_base'))
        and ("valuation_jobs"."snapshot_gap" is null or "valuation_jobs"."gap" = 'snapshot_not_assembled')
        and ("valuation_jobs"."snapshot_gap" is null or "valuation_jobs"."snapshot_gap" in ('method_not_derived', 'security_missing', 'cost_of_capital_unavailable', 'normalization_unavailable', 'revenue_history_insufficient', 'revenue_history_non_positive', 'base_margin_unavailable', 'sales_to_capital_unavailable', 'tax_rate_unavailable', 'employee_equity_not_proposed', 'shares_outstanding_unavailable', 'market_unavailable'))
        and ("valuation_jobs"."rule_version" = 'valuation-job-1.0.0' or "valuation_jobs"."gap" is null or "valuation_jobs"."gap" <> 'snapshot_not_assembled' or "valuation_jobs"."snapshot_gap" is not null)
        and ("valuation_jobs"."rule_version" = 'valuation-job-1.1.0' or ("valuation_jobs"."snapshot_gap" is null and "valuation_jobs"."valuation_run_id" is null)));
COMMIT;
