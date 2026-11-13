-- Manual rollback for drizzle-trading/0000_runtime_role.sql.
-- Run only after every later trading migration was rolled back.
--
-- The role itself is not dropped: roles belong to the server, and the other
-- trading database on the same server (local _test) may still hold grants for
-- it. Dropping it is a separate, deliberate step: DROP OWNED BY in each
-- database first, then DROP ROLE.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM finance_portal_trading_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM finance_portal_trading_runtime;
REVOKE USAGE ON SCHEMA public FROM finance_portal_trading_runtime;
DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM finance_portal_trading_runtime', current_database());
  EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO PUBLIC', current_database());
END
$$;
-- CREATE on public is not granted back to PUBLIC: PostgreSQL 15+ does not
-- grant it by default either.
--
-- To re-apply 0000 afterwards, delete its row from drizzle.__drizzle_migrations
-- (created_at = 1794603359726).
