#!/bin/sh
# Las dos bases de trading (ADR 0076) y el login local de su rol de runtime.
#
# Corre sola cuando el volumen se inicializa por primera vez. Es idempotente, así
# que sobre un volumen que ya existe se corre una vez a mano:
#
#   docker compose --env-file .env.docker.local exec postgres \
#     sh /docker-entrypoint-initdb.d/init-trading-db.sh
#
# El rol `finance_portal_trading_runtime` lo crea la migración 0000 de
# `drizzle-trading/` como NOLOGIN. Acá se crea antes, con login, sólo si
# `TRADING_RUNTIME_PASSWORD` tiene valor: la migración ve que existe y no lo toca.
# En Neon el login se habilita a mano (docs/runbooks/trading-database.md).
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
SELECT 'CREATE DATABASE finance_portal_trading OWNER $POSTGRES_USER'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'finance_portal_trading')
\gexec
SELECT 'CREATE DATABASE finance_portal_trading_test OWNER $POSTGRES_USER'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'finance_portal_trading_test')
\gexec
SQL

if [ -n "${TRADING_RUNTIME_PASSWORD:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v password="$TRADING_RUNTIME_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE finance_portal_trading_runtime NOLOGIN'
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_portal_trading_runtime')
\gexec
ALTER ROLE finance_portal_trading_runtime LOGIN PASSWORD :'password';
SQL
fi
