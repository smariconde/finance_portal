-- Manual rollback for 0004_common_proteus.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping these tables discards the persisted identity graph: every issuer,
-- instrument, listing, symbol interval, authoritative identifier assignment and
-- index membership, including the closed versions that explain what the universe
-- looked like at an earlier date (TM-06, TM-16). Export them first if the
-- incident being rolled back needs to stay explainable.
-- valuation_runs and observations reference these subjects by opaque id without a
-- foreign key, so this rollback leaves them pointing at identities that no longer
-- resolve. Re-constituting the universe mints fresh ids; it does not restore the
-- previous ones.
BEGIN;
DROP TABLE IF EXISTS "index_memberships";
DROP TABLE IF EXISTS "identifier_assignments";
DROP TABLE IF EXISTS "listing_symbols";
DROP TABLE IF EXISTS "listing_versions";
DROP TABLE IF EXISTS "listings";
DROP TABLE IF EXISTS "security_versions";
DROP TABLE IF EXISTS "securities";
DROP TABLE IF EXISTS "legal_entity_versions";
DROP TABLE IF EXISTS "legal_entities";
DROP TYPE IF EXISTS "identifier_confidence";
DROP TYPE IF EXISTS "identifier_subject_type";
DROP TYPE IF EXISTS "listing_symbol_type";
DROP TYPE IF EXISTS "listing_status";
DROP TYPE IF EXISTS "security_status";
DROP TYPE IF EXISTS "security_type";
DROP TYPE IF EXISTS "legal_entity_status";
DROP TYPE IF EXISTS "legal_entity_type";
COMMIT;
