-- Manual rollback for 0033_pale_mattie_franklin.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Removes the AI market-expectations readings (F6-11, ADR 0050). Refuses while a
-- reading exists: each row is the audit of a paid call to the model ladder,
-- joined to ai_spend_ledger by task_run_id (TM-16). Delete them deliberately
-- first.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "market_expectations_readings") THEN
    RAISE EXCEPTION 'market expectations readings exist; remove them deliberately before rolling back 0033';
  END IF;
END
$$;
DROP TABLE "market_expectations_evidence";
DROP TABLE "market_expectations_readings";
DROP TYPE "public"."market_expectations_outcome";
COMMIT;
