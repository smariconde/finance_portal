-- Manual rollback for 0019_tearful_titania.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping these tables erases every stored close and every dated split and
-- dividend. Unlike the identity graph, this is recoverable: re-ingesting from
-- the source rebuilds it, and the rows are raw so a re-download reproduces them
-- byte for byte (ADR 0026). What it costs is one request per security against a
-- source with no published quota and a daily budget of 700 — so the script
-- refuses while rows exist, to make that cost a decision rather than a side
-- effect of running a rollback script.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "security_prices") THEN
    RAISE EXCEPTION
      'security_prices holds % row(s); re-ingesting costs one request per security, so remove them deliberately before rolling back 0019',
      (SELECT count(*) FROM "security_prices");
  END IF;

  IF EXISTS (SELECT 1 FROM "price_events") THEN
    RAISE EXCEPTION
      'price_events holds % row(s); remove them deliberately before rolling back 0019',
      (SELECT count(*) FROM "price_events");
  END IF;
END
$$;
DROP TABLE "security_prices";
DROP TABLE "price_events";
DROP TYPE "public"."price_event_type";
COMMIT;
