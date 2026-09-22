-- Manual rollback for 0018_rapid_lester.sql.
-- Run only against the intended database after verifying backups and dependants.
-- PostgreSQL cannot drop a value from an enum, so undoing `owner_accepted`
-- (ADR 0026) means rebuilding the type. The script refuses while any source
-- still carries that verdict on any of its eight rights: rewriting it to
-- `allowed` would turn "nobody granted this and the owner decided anyway" into
-- "a primary source covers this use", which is exactly the distinction the value
-- was added to keep; rewriting it to `restricted` would silently block a source
-- the owner deliberately enabled. Decide per source first, or keep the value —
-- an unused enum value costs nothing.
--
-- Rebuilding the type means detaching everything that depends on it first: the
-- eight column defaults and the public-display check. All of them are restored
-- identical at the end, inside the same transaction.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "source_registry"
    -- Las columnas son del enum y el literal es `text`: el cast es necesario.
    WHERE 'owner_accepted' IN (
      "personal_use_right"::text,
      "automated_access_right"::text,
      "raw_storage_right"::text,
      "normalized_storage_right"::text,
      "derived_storage_right"::text,
      "public_display_right"::text,
      "export_right"::text,
      "ai_transfer_right"::text
    )
  ) THEN
    RAISE EXCEPTION
      'a source still declares owner_accepted; resolve those rights deliberately before rolling back 0018';
  END IF;
END
$$;
ALTER TABLE "source_registry" DROP CONSTRAINT "source_registry_public_display_check";
ALTER TABLE "source_registry"
  ALTER COLUMN "personal_use_right" DROP DEFAULT,
  ALTER COLUMN "automated_access_right" DROP DEFAULT,
  ALTER COLUMN "raw_storage_right" DROP DEFAULT,
  ALTER COLUMN "normalized_storage_right" DROP DEFAULT,
  ALTER COLUMN "derived_storage_right" DROP DEFAULT,
  ALTER COLUMN "public_display_right" DROP DEFAULT,
  ALTER COLUMN "export_right" DROP DEFAULT,
  ALTER COLUMN "ai_transfer_right" DROP DEFAULT;
ALTER TABLE "source_registry"
  ALTER COLUMN "personal_use_right" TYPE text,
  ALTER COLUMN "automated_access_right" TYPE text,
  ALTER COLUMN "raw_storage_right" TYPE text,
  ALTER COLUMN "normalized_storage_right" TYPE text,
  ALTER COLUMN "derived_storage_right" TYPE text,
  ALTER COLUMN "public_display_right" TYPE text,
  ALTER COLUMN "export_right" TYPE text,
  ALTER COLUMN "ai_transfer_right" TYPE text;
DROP TYPE "public"."source_rights_decision";
CREATE TYPE "public"."source_rights_decision" AS ENUM('unknown', 'allowed', 'restricted');
ALTER TABLE "source_registry"
  ALTER COLUMN "personal_use_right" TYPE "public"."source_rights_decision" USING "personal_use_right"::"public"."source_rights_decision",
  ALTER COLUMN "automated_access_right" TYPE "public"."source_rights_decision" USING "automated_access_right"::"public"."source_rights_decision",
  ALTER COLUMN "raw_storage_right" TYPE "public"."source_rights_decision" USING "raw_storage_right"::"public"."source_rights_decision",
  ALTER COLUMN "normalized_storage_right" TYPE "public"."source_rights_decision" USING "normalized_storage_right"::"public"."source_rights_decision",
  ALTER COLUMN "derived_storage_right" TYPE "public"."source_rights_decision" USING "derived_storage_right"::"public"."source_rights_decision",
  ALTER COLUMN "public_display_right" TYPE "public"."source_rights_decision" USING "public_display_right"::"public"."source_rights_decision",
  ALTER COLUMN "export_right" TYPE "public"."source_rights_decision" USING "export_right"::"public"."source_rights_decision",
  ALTER COLUMN "ai_transfer_right" TYPE "public"."source_rights_decision" USING "ai_transfer_right"::"public"."source_rights_decision";
ALTER TABLE "source_registry"
  ALTER COLUMN "personal_use_right" SET DEFAULT 'unknown'::"public"."source_rights_decision",
  ALTER COLUMN "automated_access_right" SET DEFAULT 'unknown'::"public"."source_rights_decision",
  ALTER COLUMN "raw_storage_right" SET DEFAULT 'unknown'::"public"."source_rights_decision",
  ALTER COLUMN "normalized_storage_right" SET DEFAULT 'unknown'::"public"."source_rights_decision",
  ALTER COLUMN "derived_storage_right" SET DEFAULT 'unknown'::"public"."source_rights_decision",
  ALTER COLUMN "public_display_right" SET DEFAULT 'unknown'::"public"."source_rights_decision",
  ALTER COLUMN "export_right" SET DEFAULT 'unknown'::"public"."source_rights_decision",
  ALTER COLUMN "ai_transfer_right" SET DEFAULT 'unknown'::"public"."source_rights_decision";
ALTER TABLE "source_registry" ADD CONSTRAINT "source_registry_public_display_check"
  CHECK (("approval_status" <> 'approved_public_demo'::source_approval_status)
    OR ("public_display_right" = 'allowed'::"public"."source_rights_decision"));
COMMIT;
