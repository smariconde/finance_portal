-- Manual rollback for 0021_abandoned_maestro.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping the table erases every stored level of the declared reference series
-- (ADR 0029). A re-download recovers the source's current five years, not what
-- was known on an earlier as_of, and every sector matrix computed against the
-- reference would stop reproducing. So the script refuses while any row exists.
-- Delete them deliberately first if that is really the intent.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "benchmark_prices") THEN
    RAISE EXCEPTION
      'benchmark_prices holds % row(s); remove them deliberately before rolling back 0021',
      (SELECT count(*) FROM "benchmark_prices");
  END IF;
END
$$;
DROP TABLE "benchmark_prices";
COMMIT;
