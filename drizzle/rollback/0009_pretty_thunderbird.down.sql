-- Manual rollback. Refuses to discard declared events or acquisition edges.
-- Symbol versions remain identity history; no automatic data deletion is safe.
BEGIN;
ALTER TABLE "corporate_actions" DROP CONSTRAINT "corporate_actions_declared_terms_check";
ALTER TYPE "corporate_action_type" RENAME TO "corporate_action_type_0009";
CREATE TYPE "corporate_action_type" AS ENUM('successor_issuer', 'split', 'reverse_split', 'listing_transfer', 'delisting');
ALTER TABLE "corporate_actions" ALTER COLUMN "action_type" TYPE "corporate_action_type" USING "action_type"::text::"corporate_action_type";
DROP TYPE "corporate_action_type_0009";
DROP INDEX "legal_entity_relationships_successor_open_uidx";
ALTER TYPE "legal_entity_relationship_type" RENAME TO "legal_entity_relationship_type_0009";
CREATE TYPE "legal_entity_relationship_type" AS ENUM('reporting_successor');
ALTER TABLE "legal_entity_relationships" ALTER COLUMN "relationship_type" TYPE "legal_entity_relationship_type" USING "relationship_type"::text::"legal_entity_relationship_type";
DROP TYPE "legal_entity_relationship_type_0009";
CREATE UNIQUE INDEX "legal_entity_relationships_successor_open_uidx" ON "legal_entity_relationships" ("relationship_type", "successor_legal_entity_id") WHERE "valid_to" IS NULL AND "superseded_at" IS NULL;
COMMIT;
