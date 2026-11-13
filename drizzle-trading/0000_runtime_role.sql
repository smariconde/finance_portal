-- Rol de runtime de la base de trading (F11-02, ADR 0076). Escrita a mano.
--
-- El rol es del servidor, no de la base: en el contenedor local lo comparten
-- finance_portal_trading y finance_portal_trading_test, así que se crea sólo si
-- falta. Nace NOLOGIN y sin atributos: el login y su contraseña se habilitan
-- aparte en cada entorno, porque una contraseña nunca va en una migración
-- (docs/runbooks/trading-database.md).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'finance_portal_trading_runtime'
  ) THEN
    CREATE ROLE finance_portal_trading_runtime NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- Nadie más que el owner crea objetos persistentes ni temporales. CREATE en
-- public ya no es de PUBLIC desde PostgreSQL 15; se revoca igual para que la
-- intención no dependa de la versión. TEMP sí lo es por defecto.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO finance_portal_trading_runtime', current_database());
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO finance_portal_trading_runtime;
--> statement-breakpoint
-- Sólo DML, y sólo sobre lo que cree el rol que migra: sin FOR ROLE, los
-- privilegios por defecto son los del owner que corre esta migración.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finance_portal_trading_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO finance_portal_trading_runtime;
