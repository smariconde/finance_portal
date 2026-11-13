import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * El rol de runtime de la base de trading (`F11-02`, ADR 0076): sólo DML sobre
 * las tablas del owner, sin crear tablas persistentes ni temporales. Se prueba
 * con `SET ROLE` desde la conexión del owner de la base de prueba, así que no
 * hace falta que el rol tenga login en este servidor.
 */
const RUNTIME_ROLE = "finance_portal_trading_runtime";
const ROLLBACK = readFileSync(
  "drizzle-trading/rollback/0000_runtime_role.down.sql",
  "utf8",
);
const MIGRATION = readFileSync("drizzle-trading/0000_runtime_role.sql", "utf8");
const JOURNAL = JSON.parse(
  readFileSync("drizzle-trading/meta/_journal.json", "utf8"),
) as { entries: { tag: string; when: number }[] };

let client: Sql;

function testUrl(): string {
  return process.env.TRADING_DATABASE_TEST_URL!.trim();
}

/** Corre `run` como el rol de runtime y deshace todo al final. */
async function asRuntime(run: (sql: Sql) => Promise<void>): Promise<void> {
  await client
    .begin(async (sql) => {
      await sql.unsafe(`SET LOCAL ROLE ${RUNTIME_ROLE}`);
      await run(sql as unknown as Sql);
      throw new RollbackSentinel();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RollbackSentinel)) throw error;
    });
}

class RollbackSentinel extends Error {}

async function runtimePrivileges() {
  const [row] = await client<
    {
      explicit_schema_usage: boolean;
      database_temp: boolean;
      public_temp: boolean;
      table_defaults: string[];
    }[]
  >`
    select
      -- PUBLIC conserva USAGE sobre public por defecto, así que lo que se mide
      -- es el grant explícito que agrega la migración.
      exists (
        select 1 from pg_namespace n, aclexplode(n.nspacl) a
        where n.nspname = 'public'
          and a.grantee = (select oid from pg_roles where rolname = ${RUNTIME_ROLE})
          and a.privilege_type = 'USAGE'
      ) as explicit_schema_usage,
      has_database_privilege(${RUNTIME_ROLE}, current_database(), 'TEMP') as database_temp,
      exists (
        select 1 from pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
        where d.datname = current_database() and a.grantee = 0 and a.privilege_type = 'TEMPORARY'
      ) as public_temp,
      coalesce(array(
        select a.privilege_type from pg_default_acl d
        join pg_namespace n on n.oid = d.defaclnamespace and n.nspname = 'public'
        cross join lateral aclexplode(d.defaclacl) a
        where d.defaclobjtype = 'r'
          and a.grantee = (select oid from pg_roles where rolname = ${RUNTIME_ROLE})
        order by 1
      ), '{}') as table_defaults
  `;
  return row!;
}

beforeAll(() => {
  client = postgres(testUrl(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
  });
});

afterAll(async () => {
  await client.end();
});

describe("trading runtime role", () => {
  it("exists without administrative attributes", async () => {
    const [role] = await client<
      {
        rolsuper: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolbypassrls: boolean;
        memberships: number;
      }[]
    >`
      select r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
        (select count(*)::int from pg_auth_members m where m.member = r.oid) as memberships
      from pg_roles r where r.rolname = ${RUNTIME_ROLE}
    `;

    expect(role).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
      memberships: 0,
    });
  });

  it("applied only the trading chain", async () => {
    const rows = await client<{ created_at: string }[]>`
      select created_at::text as created_at from drizzle.__drizzle_migrations
    `;

    expect(rows.map((row) => Number(row.created_at)).sort()).toEqual(
      JOURNAL.entries.map((entry) => entry.when).sort(),
    );
  });

  describe("over a table the owner creates", () => {
    const table = `trading_role_probe_${randomBytes(4).toString("hex")}`;

    beforeAll(async () => {
      await client.unsafe(
        `CREATE TABLE ${table} (id serial PRIMARY KEY, note text NOT NULL)`,
      );
    });

    afterAll(async () => {
      await client.unsafe(`DROP TABLE IF EXISTS ${table}`);
    });

    it("reads and writes rows, including through the sequence", async () => {
      await asRuntime(async (sql) => {
        const [inserted] = await sql.unsafe(
          `INSERT INTO ${table} (note) VALUES ('a') RETURNING id`,
        );
        await sql.unsafe(`UPDATE ${table} SET note = 'b' WHERE id = $1`, [
          inserted!.id,
        ]);
        const rows = await sql.unsafe(`SELECT note FROM ${table}`);
        expect(rows.map((row) => row.note)).toEqual(["b"]);
        await sql.unsafe(`DELETE FROM ${table}`);
      });
    });

    it.each([
      ["truncate it", (name: string) => `TRUNCATE ${name}`],
      ["alter it", (name: string) => `ALTER TABLE ${name} ADD COLUMN x int`],
      ["drop it", (name: string) => `DROP TABLE ${name}`],
      ["create a table", () => `CREATE TABLE runtime_owned (id int)`],
      [
        "create a temporary table",
        () => `CREATE TEMP TABLE runtime_temp (id int)`,
      ],
    ])("cannot %s", async (_, statement) => {
      await expect(
        asRuntime(async (sql) => {
          await sql.unsafe(statement(table));
        }),
      ).rejects.toThrow(/permission denied|must be owner/);
    });
  });

  // El migrador de Drizzle aplica sólo lo posterior a la última migración
  // registrada, así que con `0001` aplicada no vuelve a correr `0000` aunque se
  // borre su fila. El ciclo se prueba con el SQL de la migración, que es
  // idempotente sobre el rol.
  it("rolls back and re-applies 0000 to the same privileges", async () => {
    const migrated = await runtimePrivileges();
    expect(migrated).toEqual({
      explicit_schema_usage: true,
      database_temp: false,
      public_temp: false,
      table_defaults: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    });

    try {
      await client.unsafe(ROLLBACK).simple();

      expect(await runtimePrivileges()).toEqual({
        explicit_schema_usage: false,
        database_temp: true,
        public_temp: true,
        table_defaults: [],
      });
    } finally {
      for (const statement of MIGRATION.split("--> statement-breakpoint")) {
        await client.unsafe(statement).simple();
      }
    }

    expect(await runtimePrivileges()).toEqual(migrated);
  });
});
