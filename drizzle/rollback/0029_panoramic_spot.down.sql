-- Manual rollback for 0029_panoramic_spot.sql.
-- Run only against the intended database after verifying backups and dependants.
-- A prune recorded under sec-history-prune-1.1.0 says which concepts kept a wider
-- cut (TM-16): dropping the column would leave its row claiming that those rows
-- were pruned at the general cut. The script refuses while any prune carries
-- concept cuts; keep 0029, or delete those audit rows deliberately first.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "observation_prunes" WHERE "concept_cuts" <> '[]'::jsonb) THEN
    RAISE EXCEPTION 'prunes with concept cuts exist; remove them deliberately before rolling back 0029';
  END IF;
END
$$;
ALTER TABLE "observation_prunes" DROP CONSTRAINT "observation_prunes_concept_cuts_check";
ALTER TABLE "observation_prunes" DROP COLUMN "concept_cuts";
COMMIT;
