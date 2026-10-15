-- Manual rollback for 0024_absent_stryfe.sql.
-- Run only against the intended database after verifying backups and dependants.
-- The ledger is the record of what the AI layer spent and why (TM-10, TM-16).
-- The script refuses while any ledger row exists, and while a stored control
-- lowers a spend cap: dropping the column would silently raise that cap back to
-- the declared one. Remove them deliberately first, or keep the schema.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ai_spend_ledger") THEN
    RAISE EXCEPTION 'AI spend ledger rows exist; remove them deliberately before rolling back 0024';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ingestion_source_controls"
    WHERE "daily_spend_limit_nano_usd" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'a source control lowers a spend cap; supersede it before rolling back 0024';
  END IF;
END
$$;
ALTER TABLE "ingestion_source_controls" DROP CONSTRAINT "ingestion_source_controls_spend_limit_check";
ALTER TABLE "ingestion_source_controls" DROP COLUMN "daily_spend_limit_nano_usd";
DROP TABLE "ai_spend_ledger";
DROP TYPE "public"."ai_spend_status";
COMMIT;
