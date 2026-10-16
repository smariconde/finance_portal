-- Manual rollback for 0026_yielding_plazm.sql.
-- Run only against the intended database after verifying backups and dependants.
-- A proposal is the evidence behind an operations-weighted country risk premium
-- in a valuation run (TM-16): dropping it would leave runs citing a mix nobody
-- can read again. The script refuses while any proposal exists; delete them
-- deliberately first, or keep the tables.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "operations_mix_proposals") THEN
    RAISE EXCEPTION 'operations mix proposals exist; remove them deliberately before rolling back 0026';
  END IF;
END
$$;
DROP TABLE "operations_mix_evidence";
DROP TABLE "operations_mix_lines";
DROP TABLE "operations_mix_proposals";
DROP TYPE "public"."operations_mix_outcome";
COMMIT;
