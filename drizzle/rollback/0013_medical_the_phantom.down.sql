-- Manual rollback for 0013_medical_the_phantom.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping observation_prunes discards the only record of an irreversible
-- deletion (ADR 0019). The observations it names are gone: without the table,
-- nothing distinguishes "the filer did not report this period" from "the owner
-- pruned it", and the run's selection_anchor_on says the opposite of the truth,
-- because that run did go and fetch what is no longer there.
-- Observations are NOT restored: this rollback undoes the audit, never the prune.
-- The script refuses while any prune is recorded. To roll back anyway, export the
-- table first and clear it on purpose before running it (TM-16).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "observation_prunes") THEN
    RAISE EXCEPTION 'observation_prunes has recorded prunes; export and clear the table before rolling back 0013';
  END IF;
END
$$;
DROP TABLE IF EXISTS "observation_prunes";
COMMIT;
