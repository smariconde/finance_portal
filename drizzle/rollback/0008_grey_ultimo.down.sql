-- Manual rollback for 0008_grey_ultimo.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Removing listing_transfer and delisting discards the events that explain why a
-- listing closed. The listing and listing_symbol versions the reconciliation job
-- closed or opened are identity data, not schema: this rollback leaves them as they
-- are, so a closed listing stays closed without the event that justified it. Export
-- the listing_transfer and delisting rows of corporate_actions first if the incident
-- being rolled back needs to stay explainable (TM-06, TM-16).
-- PostgreSQL cannot drop an enum value, so corporate_action_type is rebuilt
-- without them. If any corporate action still uses one the cast fails and the whole
-- transaction rolls back: delete or export those rows first, on purpose.
BEGIN;
ALTER TABLE "corporate_actions" DROP CONSTRAINT "corporate_actions_listing_terms_check";
ALTER TYPE "corporate_action_type" RENAME TO "corporate_action_type_0008";
CREATE TYPE "corporate_action_type" AS ENUM('successor_issuer', 'split', 'reverse_split');
ALTER TABLE "corporate_actions" ALTER COLUMN "action_type" TYPE "corporate_action_type" USING "action_type"::text::"corporate_action_type";
DROP TYPE "corporate_action_type_0008";
COMMIT;
