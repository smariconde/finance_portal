-- Manual rollback for 0000_jittery_nextwave.sql.
-- Run only against the intended database after verifying backups and dependants.
BEGIN;
DROP TABLE IF EXISTS "dataset_snapshots";
DROP TYPE IF EXISTS "snapshot_manifest_status";
COMMIT;
