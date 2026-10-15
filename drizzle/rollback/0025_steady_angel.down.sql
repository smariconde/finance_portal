-- Manual rollback for 0025_steady_angel.sql.
-- Run only against the intended database after verifying backups and dependants.
-- A resolution is the evidence behind a published industry assertion (TM-16):
-- dropping it would leave assertions in classification_assignments citing a
-- resolution that no longer exists. The script refuses while any resolution
-- exists; delete them and their assertions deliberately first, or keep the tables.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "industry_resolutions") THEN
    RAISE EXCEPTION 'industry resolutions exist; remove them and their damodaran-industry assertions deliberately before rolling back 0025';
  END IF;
END
$$;
DROP TABLE "industry_resolution_evidence";
DROP TABLE "industry_resolutions";
DROP TYPE "public"."industry_resolution_outcome";
COMMIT;
