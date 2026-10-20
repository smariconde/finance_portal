-- Manual rollback for 0030_good_spacker_dave.sql.
-- Run only against the intended database after verifying backups and dependants.
-- An employee equity proposal is the evidence behind the options and units a
-- valuation run may carry (TM-16), and every attempt is in ai_spend_ledger under
-- its proposal_id. The script refuses while any proposal exists; delete them
-- deliberately first, or keep 0030.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "employee_equity_proposals") THEN
    RAISE EXCEPTION 'employee equity proposals exist; remove them deliberately before rolling back 0030';
  END IF;
END
$$;
DROP TABLE "employee_equity_evidence";
DROP TABLE "employee_equity_proposals";
DROP TYPE "public"."employee_equity_outcome";
COMMIT;
