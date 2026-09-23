-- Manual rollback for 0020_famous_catseye.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping these tables erases the CEDEAR registry: every program, every ratio
-- and every superseded version of both (ADR 0027). Re-recording would recover
-- only what the issuers publish *today*, losing every ratio change and every
-- withdrawal the registry observed, and with them the answer to "which ratio
-- applied, as known back then" (TM-06). The two sources publish no history.
-- So the script refuses while any row exists. Delete them deliberately first if
-- that is really the intent.
-- It does not touch the identity graph: the depositary entities and the CEDEAR
-- securities with their ISIN and Caja de Valores code live in tables that 0020
-- did not create, and removing them is a separate, deliberate decision.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "depositary_program_versions") THEN
    RAISE EXCEPTION
      'depositary_program_versions holds % row(s); remove them deliberately before rolling back 0020',
      (SELECT count(*) FROM "depositary_program_versions");
  END IF;

  IF EXISTS (SELECT 1 FROM "depositary_ratios") THEN
    RAISE EXCEPTION
      'depositary_ratios holds % row(s); remove them deliberately before rolling back 0020',
      (SELECT count(*) FROM "depositary_ratios");
  END IF;
END
$$;
DROP TABLE "depositary_ratios";
DROP TABLE "depositary_program_versions";
DROP TABLE "depositary_programs";
DROP TYPE "public"."depositary_program_type";
DROP TYPE "public"."depositary_program_status";
COMMIT;
