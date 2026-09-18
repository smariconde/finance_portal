-- Manual rollback for 0015_vengeful_silver_surfer.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping this table removes the refresh watermarks (ADR 0021): the next
-- refresh sees every followed filer as never probed and downloads companyfacts
-- once for each. That is quota, not data loss — the ingestion deduplicates by
-- content hash and publishes nothing new — so this rollback is not guarded.
-- Nothing that explains a published row lives here: every probe already left its
-- own run in "ingestion_runs", and those stay (TM-16).
BEGIN;
DROP TABLE IF EXISTS "ingestion_refresh_state";
COMMIT;
