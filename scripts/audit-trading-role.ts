import postgres from "postgres";

// La auditoría lee la URL exactamente como el runtime —sin caer en
// DATABASE_URL y negándose a la base de análisis—, así que usa su resolutor.
// eslint-disable-next-line no-restricted-imports
import { resolveTradingDatabaseUrl } from "@/server/db/trading/runtime-client";

/**
 * Audita que la conexión de runtime de la base de trading sea el rol limitado
 * de la ADR 0076, medido en la base y no afirmado en un runbook. Sólo lee el
 * catálogo, con la misma URL que usa el runtime (`TRADING_DATABASE_URL`): si
 * alguien pegara ahí la conexión del owner, la primera afirmación lo nombra.
 *
 *   pnpm db:trading:audit         # contra la base local
 *   pnpm db:trading:audit:neon    # contra Production en Neon
 *
 * Sale con código 1 si alguna afirmación no se cumple. Nunca imprime la URL.
 */
const RUNTIME_ROLE = "finance_portal_trading_runtime";
const TABLE_DML = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;
const TABLE_NOT_GRANTED = ["TRUNCATE", "REFERENCES", "TRIGGER"] as const;

type Claim = {
  readonly claim: string;
  readonly holds: boolean;
  readonly detail: string;
};

const client = postgres(resolveTradingDatabaseUrl(process.env), {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
});

const claims: Claim[] = [];

function record(claim: string, holds: boolean, detail: string) {
  claims.push({ claim, holds, detail });
}

try {
  const [role] = await client<
    {
      current_user: string;
      database: string;
      rolsuper: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      memberships: string[];
    }[]
  >`
    select current_user, current_database() as database,
      r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
      r.rolbypassrls, r.rolcanlogin,
      coalesce(array(
        select g.rolname from pg_auth_members m
        join pg_roles g on g.oid = m.roleid
        where m.member = r.oid order by g.rolname
      ), '{}') as memberships
    from pg_roles r where r.rolname = current_user
  `;

  if (!role) throw new Error("current_user has no pg_roles row.");

  record(
    "runtime_url_uses_limited_role",
    role.current_user === RUNTIME_ROLE,
    `current_user = ${role.current_user}, base ${role.database}`,
  );

  const attributes = {
    SUPERUSER: role.rolsuper,
    CREATEROLE: role.rolcreaterole,
    CREATEDB: role.rolcreatedb,
    REPLICATION: role.rolreplication,
    BYPASSRLS: role.rolbypassrls,
  };
  const held = Object.entries(attributes)
    .filter(([, value]) => value)
    .map(([name]) => name);
  record(
    "no_administrative_attributes",
    held.length === 0,
    held.length === 0 ? "ninguno" : held.join(", "),
  );

  // Un rol creado desde la consola o la API de Neon entra en neon_superuser,
  // que trae CREATEROLE y BYPASSRLS heredados: por eso se crea por SQL.
  record(
    "no_role_memberships",
    role.memberships.length === 0,
    role.memberships.length === 0 ? "ninguna" : role.memberships.join(", "),
  );

  const [privileges] = await client<
    {
      schema_usage: boolean;
      schema_create: boolean;
      database_connect: boolean;
      database_temp: boolean;
      database_create: boolean;
    }[]
  >`
    select
      has_schema_privilege(current_user, 'public', 'USAGE') as schema_usage,
      has_schema_privilege(current_user, 'public', 'CREATE') as schema_create,
      has_database_privilege(current_user, current_database(), 'CONNECT') as database_connect,
      has_database_privilege(current_user, current_database(), 'TEMP') as database_temp,
      has_database_privilege(current_user, current_database(), 'CREATE') as database_create
  `;

  if (!privileges) throw new Error("privilege query returned no row.");

  record(
    "schema_usage_without_create",
    privileges.schema_usage && !privileges.schema_create,
    `USAGE ${privileges.schema_usage}, CREATE ${privileges.schema_create}`,
  );
  record(
    "database_connect_without_temp_or_create",
    privileges.database_connect &&
      !privileges.database_temp &&
      !privileges.database_create,
    `CONNECT ${privileges.database_connect}, TEMP ${privileges.database_temp}, CREATE ${privileges.database_create}`,
  );

  const defaults = await client<
    { kind: string; grantor: string; privilege_type: string }[]
  >`
    select d.defaclobjtype as kind, o.rolname as grantor, a.privilege_type
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace and n.nspname = 'public'
    join pg_roles o on o.oid = d.defaclrole
    cross join lateral aclexplode(d.defaclacl) a
    where a.grantee = (select oid from pg_roles where rolname = current_user)
    order by 1, 2, 3
  `;
  const tableDefaults = new Set(
    defaults.filter((row) => row.kind === "r").map((row) => row.privilege_type),
  );
  const sequenceDefaults = new Set(
    defaults.filter((row) => row.kind === "S").map((row) => row.privilege_type),
  );
  const grantors = [...new Set(defaults.map((row) => row.grantor))];

  record(
    "default_table_privileges_are_dml",
    TABLE_DML.every((name) => tableDefaults.has(name)) &&
      tableDefaults.size === TABLE_DML.length,
    `${[...tableDefaults].join(", ") || "ninguno"} (de ${grantors.join(", ") || "nadie"})`,
  );
  record(
    "default_sequence_privileges_are_usage_select",
    sequenceDefaults.has("USAGE") &&
      sequenceDefaults.has("SELECT") &&
      sequenceDefaults.size === 2,
    [...sequenceDefaults].join(", ") || "ninguno",
  );

  const tables = await client<
    { table_name: string; owned: boolean; granted: string[] }[]
  >`
    select c.relname as table_name,
      pg_get_userbyid(c.relowner) = current_user as owned,
      array(
        select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
        where has_table_privilege(current_user, c.oid, p)
      ) as granted
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind in ('r', 'p')
    order by 1
  `;
  const offTables = tables.filter(
    (table) =>
      table.owned ||
      !TABLE_DML.every((name) => table.granted.includes(name)) ||
      TABLE_NOT_GRANTED.some((name) => table.granted.includes(name)),
  );

  record(
    "every_table_is_dml_only",
    offTables.length === 0,
    tables.length === 0
      ? "sin tablas todavía"
      : offTables.length === 0
        ? `${tables.length} tablas`
        : offTables
            .map((table) => `${table.table_name}: ${table.granted.join("/")}`)
            .join("; "),
  );
} finally {
  await client.end();
}

for (const { claim, holds, detail } of claims) {
  console.log(`${holds ? "cumple  " : "NO CUMPLE"}  ${claim}  —  ${detail}`);
}

if (claims.some((claim) => !claim.holds)) process.exitCode = 1;
