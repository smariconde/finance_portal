-- Manual rollback for 0007_amazing_captain_marvel.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Removing split and reverse_split discards every confirmed split: latest_adjusted
-- reads fall back to a single split basis per filing, so a per-share series that
-- crossed a split mixes bases again without saying so. Export the split rows of
-- corporate_actions first if the incident being rolled back needs to stay
-- explainable (TM-06, TM-16).
-- PostgreSQL cannot drop an enum value, so corporate_action_type is rebuilt
-- without them. If any corporate action still uses one the cast fails and the whole
-- transaction rolls back: delete or export those rows first, on purpose.
BEGIN;
ALTER TABLE "corporate_actions" DROP CONSTRAINT "corporate_actions_split_terms_check";
ALTER TYPE "corporate_action_type" RENAME TO "corporate_action_type_0007";
CREATE TYPE "corporate_action_type" AS ENUM('successor_issuer');
ALTER TABLE "corporate_actions" ALTER COLUMN "action_type" TYPE "corporate_action_type" USING "action_type"::text::"corporate_action_type";
DROP TYPE "corporate_action_type_0007";
COMMIT;
