#!/bin/sh
# Runs once, when the PostgreSQL volume is first initialised.
#
# The integration suite deletes every row of the tables it touches, so it cannot
# share a database with the owner's data. It does not need its own server: a second
# database on the same instance is enough, and keeps the project at one container.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
  CREATE DATABASE finance_portal_test OWNER $POSTGRES_USER;
SQL
