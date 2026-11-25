-- Manual rollback for 0057_business_mix_proposals.sql.
-- Run only against the intended database after verifying backups and dependants.
-- A proposal is the evidence behind a business-mix beta in a valuation run
-- (F6-48, ADR 0086, TM-16): dropping it would leave runs citing a mix nobody
-- can read again. The script refuses while any proposal exists; delete them
-- deliberately first, or keep the tables.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "business_mix_proposals") THEN
    RAISE EXCEPTION 'business mix proposals exist; remove them deliberately before rolling back 0057';
  END IF;
END
$$;
DROP TABLE "business_mix_evidence";
DROP TABLE "business_mix_lines";
DROP TABLE "business_mix_proposals";
DROP TYPE "public"."business_mix_outcome";
COMMIT;
