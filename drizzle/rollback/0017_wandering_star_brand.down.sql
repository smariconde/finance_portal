-- Manual rollback for 0017_wandering_star_brand.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping the table erases every classification assertion with its taxonomy,
-- version and validity, and those cannot be rebuilt from anything else in the
-- database: the sector is not a column on any entity, which is the whole point
-- of ADR 0025. Re-constituting would recover only what the *current* pin says,
-- losing every superseded assertion and therefore the answer to "what sector was
-- this company in, as known back then" (TM-06).
-- So the script refuses while any assertion exists. Delete them deliberately
-- first if that is really the intent.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "classification_assignments") THEN
    RAISE EXCEPTION
      'classification_assignments holds % row(s); remove them deliberately before rolling back 0017',
      (SELECT count(*) FROM "classification_assignments");
  END IF;
END
$$;
DROP TABLE "classification_assignments";
COMMIT;
