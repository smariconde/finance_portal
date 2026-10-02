-- Manual rollback for 0023_outstanding_lorna_dane.sql.
-- Run only against the intended database after verifying backups and dependants.
-- The releases are audited parameters: a valuation that cited an ERP or a beta
-- has to be able to find it again (TM-16). The script refuses while any release
-- exists; delete them deliberately first, or keep the tables.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "reference_dataset_releases") THEN
    RAISE EXCEPTION 'reference dataset releases exist; remove them deliberately before rolling back 0023';
  END IF;
END
$$;
DROP TABLE "reference_dataset_rows";
DROP TABLE "reference_dataset_releases";
COMMIT;
