-- Manual rollback for 0006_lonely_zeigeist.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping legal_entity_relationships discards every declared issuer succession:
-- a successor stops seeing its predecessor's reporting history, and nothing else
-- records which filing proved the succession or since when it was knowable.
-- Export both tables first if the incident being rolled back needs to stay
-- explainable (TM-06, TM-16).
-- The predecessor legal entities and their CIK assignments that a succession
-- brought into the identity graph are NOT removed: they live in the 0004 tables,
-- observations already reference them, and deleting identities would orphan
-- published facts. They remain as filers with no relationship to anyone.
BEGIN;
DROP TABLE IF EXISTS "legal_entity_relationships";
DROP TABLE IF EXISTS "corporate_actions";
DROP TYPE IF EXISTS "legal_entity_relationship_type";
DROP TYPE IF EXISTS "identity_decision_maker";
DROP TYPE IF EXISTS "corporate_action_type";
COMMIT;
