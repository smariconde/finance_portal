# Base de trading

- Estado: procedimiento de `F11-02`
- Decisión: [ADR 0076](../architecture/adr/0076-schwab-read-only-account-trading-journal.md), sección 3
- Relacionados: [migraciones](database-migrations.md),
  [deploy protegido](protected-deployment.md) y
  [ADR 0073](../architecture/adr/0073-neon-free-network-transfer-recovery.md)

La cuenta Schwab y el diario de trading guardan sus datos en una base aparte de
la de análisis. Tiene su propio schema, su propia cadena de migraciones, su rol
de runtime y, en Production, su propio proyecto de Neon. No hay SQL entre las
dos bases. Si la de análisis no responde, la cuenta sigue funcionando.

## Conexiones

| Variable                      | Quién la lee                               | Rol                                        |
| ----------------------------- | ------------------------------------------ | ------------------------------------------ |
| `TRADING_DATABASE_URL`        | el runtime y `db:trading:audit`            | `finance_portal_trading_runtime`, sólo DML |
| `TRADING_DATABASE_DIRECT_URL` | `db:trading:migrate` y `db:trading:status` | el owner de la base                        |
| `TRADING_DATABASE_TEST_URL`   | `pnpm test:integration:trading`            | el owner de la base de prueba              |

- **Opcional.** La base de trading no forma parte de la definición de
  `personal`. Sin `TRADING_DATABASE_URL` el resto del portal no cambia. En
  `/configuracion`, «Base de trading» queda `disabled` y nombra la variable;
  no enciende «requiere atención».
- **`degraded`.** El estado queda reservado para una configuración mal hecha:
  - un valor que no es una URL de PostgreSQL;
  - una URL que nombra la misma base que `DATABASE_URL`, comparando host,
    puerto y nombre de base, sin importar el rol ni el pooler de Neon;
  - la variable presente en un Preview de Vercel (`TM-14`).
- **Nunca cae en la otra base.** El runtime no usa `DATABASE_URL` como
  respaldo. Los comandos de migración de un destino no leen la conexión del
  otro y se niegan si las dos nombran la misma base.
- **Dónde existen.** Las variables viven sólo en local y en Production. Preview
  nunca las recibe. En Vercel se cargan con el callback de Schwab (`F11-03`),
  cuando algo de Production las lea.

## Rol de runtime

La migración `drizzle-trading/0000_runtime_role.sql` define los privilegios,
así que son iguales en local, en la base de prueba y en Neon:

- crea `finance_portal_trading_runtime` como `NOLOGIN` si todavía no existe;
- le da `CONNECT` sobre la base y `USAGE` sobre `public`;
- le da por defecto `SELECT`, `INSERT`, `UPDATE` y `DELETE` sobre las tablas que
  cree el owner, y `USAGE` y `SELECT` sobre sus secuencias;
- le quita `TEMP` sobre la base y `CREATE` en `public` a `PUBLIC`.

La contraseña nunca va en una migración: el login se habilita aparte en cada
entorno. En Neon el rol se crea **por SQL**, no desde la consola, la API ni
`neon roles create`. Esos caminos lo hacen miembro de `neon_superuser`, que
trae `CREATEROLE`, `CREATEDB` y `BYPASSRLS`.

`pnpm db:trading:audit` lo mide en la base. Sólo lee el catálogo y se conecta
con la URL del runtime. Sale con 1 si no se cumple alguna de estas
afirmaciones:

| Afirmación                                     | Qué comprueba                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `runtime_url_uses_limited_role`                | la URL del runtime entra como el rol limitado y no como el owner                                 |
| `no_administrative_attributes`                 | sin `SUPERUSER`, `CREATEROLE`, `CREATEDB`, `REPLICATION` ni `BYPASSRLS`                          |
| `no_role_memberships`                          | no es miembro de ningún rol (por ejemplo, `neon_superuser`)                                      |
| `schema_usage_without_create`                  | `USAGE` en `public`, sin `CREATE`                                                                |
| `database_connect_without_temp_or_create`      | `CONNECT`, sin `TEMP` ni `CREATE`                                                                |
| `default_table_privileges_are_dml`             | los defaults del owner dan exactamente los cuatro DML                                            |
| `default_sequence_privileges_are_usage_select` | los defaults de secuencias dan `USAGE` y `SELECT`                                                |
| `every_table_is_dml_only`                      | cada tabla existente: los cuatro DML, sin `TRUNCATE`, `REFERENCES` ni `TRIGGER`, y no es del rol |

## Local

El contenedor de siempre suma dos bases: `finance_portal_trading` y
`finance_portal_trading_test`. Las crea `scripts/init-trading-db.sh`. Si
`.env.docker.local` tiene `TRADING_RUNTIME_PASSWORD`, el script también
habilita el login local del rol. Un volumen nuevo lo corre solo. Sobre un
volumen que ya existe, se corre una vez:

```bash
docker compose --env-file .env.docker.local exec -T \
  -e TRADING_RUNTIME_PASSWORD="<el de .env.docker.local>" \
  postgres sh -s < scripts/init-trading-db.sh
pnpm db:trading:migrate
pnpm db:trading:status
pnpm db:trading:audit
```

En `.env.local`:

- `TRADING_DATABASE_URL` entra a `finance_portal_trading` como
  `finance_portal_trading_runtime`;
- `TRADING_DATABASE_DIRECT_URL` y `TRADING_DATABASE_TEST_URL` usan el usuario
  del contenedor.

El rol es del servidor: lo comparten las dos bases de trading.

## Neon

El proyecto `finance_portal_trading` (`wispy-term-56128846`, rama
`production`) está en la misma cuenta y organización que el de análisis, y
tiene su propia cuota. `.env.neon.local` guarda sus dos conexiones junto a las
de análisis. Los comandos `:neon` cargan sólo ese archivo:

```bash
pnpm db:trading:status:neon    # sólo lee; sale con 1 y nombra lo pendiente
pnpm db:trading:migrate:neon
pnpm db:trading:audit:neon
```

**Primera vez.** Así se hizo el 2026-11-13:

1. Bajar la conexión directa del owner con
   `neon connection-string production --project-id wispy-term-56128846 --role-name finance_portal_trading_owner --database-name finance_portal_trading`,
   escribirla en `.env.neon.local` como `TRADING_DATABASE_DIRECT_URL` y no
   imprimirla.
2. Aplicar `pnpm db:trading:migrate:neon`. Eso crea el rol `NOLOGIN`.
3. Desde la conexión del owner, correr
   `ALTER ROLE finance_portal_trading_runtime LOGIN PASSWORD '…'` con 24 bytes
   aleatorios en hexadecimal.
4. Escribir `TRADING_DATABASE_URL` con el host `-pooler` de la misma base, el
   rol de runtime y esa contraseña.
5. Correr `pnpm db:trading:audit:neon`, que tiene que cumplir las ocho
   afirmaciones.

**Rotar la contraseña.** Repetir los pasos 3 a 5 y actualizar la variable donde
viva (`.env.neon.local` y, desde `F11-03`, el Secret de Production en Vercel).

**Snapshot.** Rige la ADR 0073: antes de migrar Production hay que tener un
snapshot manual reciente. Free permite uno por proyecto y este proyecto tiene
su propio slot.

- La primera migración se aplicó sin snapshot previo, por decisión del owner:
  la base estaba vacía y sólo cambiaban privilegios.
- El primero, `f11-02-runtime-role-2026-11-13`, se tomó inmediatamente después.
- La CLI no tiene un comando de snapshots. Se toman con la API:
  `neon api -X POST /projects/wispy-term-56128846/branches/<branch>/snapshot -Q name=<nombre>`,
  y se verifican con `neon api /projects/wispy-term-56128846/snapshots`.

## Generar una migración

1. Modificar `src/server/db/trading/schema.ts`.
2. Ejecutar `pnpm db:trading:generate`, que no necesita URL. Para SQL escrito a
   mano: `pnpm drizzle-kit generate --config drizzle-trading.config.ts --custom --name <nombre>`.
3. Escribir `drizzle-trading/rollback/<tag>.down.sql`. Un test unitario exige el
   par para cada entrada del journal.
4. Correr `pnpm test:integration:trading` contra la base de prueba.
5. Antes del merge, con un snapshot reciente: `pnpm db:trading:migrate:neon`,
   `pnpm db:trading:status:neon` y `pnpm db:trading:audit:neon`.

## Rollback

`drizzle-trading/rollback/0000_runtime_role.down.sql`:

- revoca los privilegios por defecto, `USAGE` y `CONNECT`;
- le devuelve `TEMP` a `PUBLIC`;
- no borra el rol, porque es del servidor y la otra base de trading puede tener
  grants para él.

Para borrarlo: `DROP OWNED BY finance_portal_trading_runtime` en cada base y
después `DROP ROLE`. Para volver a aplicar `0000`, borrar su fila de
`drizzle.__drizzle_migrations`. La suite de integración prueba ese ciclo:
migrar, revertir y migrar de nuevo hasta los mismos privilegios.

## Fallas seguras

- **Falta `TRADING_DATABASE_URL`.** La raíz de composición lanza
  `TradingUnavailableError` sin pedir ninguna base. El resto del portal sirve
  igual.
- **Runtime trabado.** Lanza `RuntimeLockedError` antes de mirar la
  configuración de trading.
- **La URL nombra la base de análisis.** El health la marca `degraded` y el
  cliente se niega antes de abrir el socket.
- **Falta `TRADING_DATABASE_DIRECT_URL`, o nombra la misma base que
  `DATABASE_DIRECT_URL`.** `db:trading:migrate` termina antes de conectarse.
- **Falta `TRADING_DATABASE_TEST_URL`, o nombra otra base del proyecto.** La
  suite de trading falla y no se marca como aprobada.
