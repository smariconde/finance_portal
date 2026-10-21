-- Manual rollback for 0032_gifted_fat_cobra.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Removes the snapshot gap and the recorded run from the ticker-valuation jobs
-- (F6-07, ADR 0046). Refuses while a valuation-job-1.1.0 row exists: it is the
-- audit of a job that recorded a run or named why it could not (TM-16), and
-- rewriting it as 1.0.0 would say something it never said. Delete those jobs
-- deliberately first. PostgreSQL cannot drop an enum value, so the gap type is
-- rebuilt.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "valuation_jobs" WHERE "rule_version" = 'valuation-job-1.1.0'
  ) THEN
    RAISE EXCEPTION 'a valuation-job-1.1.0 job exists; remove it deliberately before rolling back 0032';
  END IF;
END
$$;
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_run_check";
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_run_fk";
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_rule_check";
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_method_check";
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_identity_check";
ALTER TABLE "valuation_jobs" DROP COLUMN "run_status";
ALTER TABLE "valuation_jobs" DROP COLUMN "valuation_run_id";
ALTER TABLE "valuation_jobs" DROP COLUMN "snapshot_gap";
ALTER TABLE "valuation_jobs" ALTER COLUMN "gap" TYPE text;
DROP TYPE "public"."valuation_job_gap";
CREATE TYPE "public"."valuation_job_gap" AS ENUM('unresolved_ticker', 'ambiguous_ticker', 'identity_conflict', 'cik_missing', 'annual_fundamentals', 'unsupported_method', 'snapshot_not_assembled', 'assessment_failed');
ALTER TABLE "valuation_jobs"
  ALTER COLUMN "gap" TYPE "public"."valuation_job_gap"
  USING "gap"::"public"."valuation_job_gap";
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_rule_check" CHECK ("valuation_jobs"."rule_version" = 'valuation-job-1.0.0');
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
        and ("valuation_jobs"."method_status" is null or "valuation_jobs"."gap" in ('snapshot_not_assembled', 'unsupported_method', 'annual_fundamentals'))
        and ("valuation_jobs"."method_status" is not null or ("valuation_jobs"."method" is null and "valuation_jobs"."asset_profile" is null and "valuation_jobs"."rigor" is null and "valuation_jobs"."unsupported_reason" is null)));
COMMIT;
