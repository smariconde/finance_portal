-- Manual rollback for 0031_ancient_riptide.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Drops the ticker-valuation jobs. Refuses while a row exists: the row is the
-- audit of what was asked and how it ended (TM-16). Delete those jobs
-- deliberately first.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "valuation_jobs") THEN
    RAISE EXCEPTION 'a valuation job exists; remove it deliberately before rolling back 0031';
  END IF;
END
$$;
DROP TABLE "valuation_jobs";
DROP TYPE "public"."valuation_job_gap";
DROP TYPE "public"."valuation_job_identity";
DROP TYPE "public"."valuation_job_status";
COMMIT;
