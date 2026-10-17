-- Manual rollback for 0027_thick_selene.sql.
-- Run only against the intended database after verifying backups and dependants.
-- An eval attempt counts against the same spend caps as a task (ADR 0035):
-- dropping the column would relabel it as production spend and blend deliberate
-- injections into the layer's rejection rate. The script refuses while any eval
-- attempt exists; delete them deliberately first, or keep the column.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ai_spend_ledger" WHERE "purpose" = 'eval') THEN
    RAISE EXCEPTION 'eval attempts exist in ai_spend_ledger; remove them deliberately before rolling back 0027';
  END IF;
END
$$;
ALTER TABLE "ai_spend_ledger" DROP COLUMN "purpose";
DROP TYPE "public"."ai_spend_purpose";
COMMIT;
