-- Manual rollback for 0056_followed_filer_constitution.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Removes the refusal code of a ticker that could not be constituted and
-- restores the identity check as 0055 left it (F6-33, ADR 0084). Refuses while
-- a job records a constitution or a refusal: it says what the job did (TM-16).
-- Delete those jobs deliberately first. PostgreSQL cannot drop an enum value:
-- `identity_constituted` stays in the type, unused, and the restored check
-- forbids it; 0056 adds the value with IF NOT EXISTS, so it reapplies cleanly.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "valuation_jobs"
    WHERE "gap"::text = 'identity_constituted' OR "identity_refusal" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'a job records a constitution or a refusal; remove it deliberately before rolling back 0056';
  END IF;
END
$$;
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_identity_check";
ALTER TABLE "valuation_jobs" DROP CONSTRAINT "valuation_jobs_identity_refusal_check";
ALTER TABLE "valuation_jobs" DROP COLUMN "identity_refusal";
ALTER TABLE "valuation_jobs" ADD CONSTRAINT "valuation_jobs_identity_check" CHECK (("valuation_jobs"."gap" = 'unresolved_ticker') = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'not_found')
        and ("valuation_jobs"."gap" = 'ambiguous_ticker') = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'ambiguous')
        and ("valuation_jobs"."gap" = 'identity_conflict') = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'conflict')
        and ("valuation_jobs"."legal_entity_id" is not null) = ("valuation_jobs"."identity_status" is not null and "valuation_jobs"."identity_status" = 'resolved')
        and ("valuation_jobs"."security_id" is null or "valuation_jobs"."legal_entity_id" is not null)
        and ("valuation_jobs"."listing_id" is null or "valuation_jobs"."security_id" is not null)
        and ("valuation_jobs"."gap" is null or "valuation_jobs"."gap" in ('unresolved_ticker', 'ambiguous_ticker', 'identity_conflict', 'assessment_failed') or "valuation_jobs"."legal_entity_id" is not null));
COMMIT;
