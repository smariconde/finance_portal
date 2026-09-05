# Migraciones PostgreSQL

- Estado: procedimiento inicial de `F1-02`
- Alcance: schema Drizzle y base dedicada del owner

## Contrato de conexiones

- `DATABASE_URL` es pooled y pertenece exclusivamente al runtime personal.
- `DATABASE_DIRECT_URL` es directa y sólo la lee `scripts/migrate.ts`.
- `DATABASE_TEST_URL` apunta a una base PostgreSQL de prueba dedicada y descartable.
- La demo no abre ninguna de estas conexiones.

No reutilizar la base personal como `DATABASE_TEST_URL`. Los tests de integración
insertan y eliminan filas con un namespace aleatorio y aplican migraciones pendientes.

## PostgreSQL local con Docker

Un solo contenedor, con **dos bases** sobre el mismo servidor. La imagen es
`postgres:17.11-alpine3.23`, publica sólo en `127.0.0.1:55432` y conserva sus datos en
un volumen Docker.

| Base                      | Para qué                              | Vida                                |
| ------------------------- | ------------------------------------- | ----------------------------------- |
| `finance_portal_personal` | runtime personal: universo y corridas | persistente; es el dato del owner   |
| `finance_portal_test`     | `pnpm test:integration`               | desechable; la suite le borra filas |

La división existe por una razón concreta y no por simetría: la suite de integración
borra **todas** las filas de las tablas que toca —`universe-repository.test.ts` vacía
las nueve del grafo de identidad sin filtrar— así que no puede compartir base con el
universo constituido. No necesita un servidor propio: dos contenedores para eso era
duplicación, y la diferencia se resuelve con un `CREATE DATABASE`.

Crear la configuración local una sola vez, reemplazando el password de ejemplo:

```bash
cp .env.docker.example .env.docker.local
pnpm db:up
```

`scripts/init-test-db.sh` crea `finance_portal_test` cuando el volumen se inicializa
por primera vez. Comprobar y detener sin perder el volumen:

```bash
docker compose --env-file .env.docker.local ps
pnpm db:down
```

`.env.local` apunta `DATABASE_URL` y `DATABASE_DIRECT_URL` a la base personal y
`DATABASE_TEST_URL` a la de integración, las tres sobre el mismo puerto.

## Generar una migración

1. Modificar `src/server/db/schema.ts`.
2. Ejecutar `pnpm db:generate` sin ninguna URL de base.
3. Revisar el SQL y los snapshots en `drizzle/`.
4. Ejecutar los gates estáticos y unitarios.
5. Aplicar la migración contra una base de prueba dedicada y correr
   `pnpm test:integration`.

`db:generate` no aplica cambios. No usar `drizzle-kit push`: el repositorio conserva
SQL versionado para que los cambios sean revisables y reproducibles.

## Aplicar

`db:migrate` lee `.env.local`, así que basta con:

```bash
pnpm db:migrate
```

Contra otra base, exportar `DATABASE_DIRECT_URL` antes de invocarlo.

El job abre una única conexión, aplica `drizzle/` y la cierra. Next.js no ejecuta
migraciones al iniciar y el runtime no lee `DATABASE_DIRECT_URL`.

Para verificar el repositorio contra PostgreSQL real:

```bash
DATABASE_TEST_URL="postgres://finance_portal:<local-password>@127.0.0.1:55432/finance_portal_test" pnpm test:integration
```

Las migraciones se aplican una sola vez por corrida desde
`tests/integration/global-setup.ts`. Ningún archivo de test debe volver a llamar
`migrate`: dos workers en paralelo compiten por crear el mismo tipo o tabla y la
corrida falla por la carrera, no por el código bajo prueba.

## Rollback

Drizzle registra migraciones ascendentes y no ejecuta un `down` automático. Antes de
revertir:

1. detener writes sobre la base objetivo;
2. confirmar el deployment y la base exactos;
3. verificar backup/restore;
4. revisar dependencias creadas después de la migración;
5. ejecutar manualmente el SQL pareado, en orden inverso al de aplicación:
   - `drizzle/rollback/0004_common_proteus.down.sql` (el grafo de identidad
     completo: `legal_entities`, `securities`, `listings`, `listing_symbols`,
     `index_memberships`, `identifier_assignments`, sus tablas de versiones y sus
     enums);
   - `drizzle/rollback/0003_typical_maximus.down.sql` (`valuation_runs` y sus
     enums);
   - `drizzle/rollback/0002_fresh_redwing.down.sql` (`observations`, sus enums y
     la columna `ingestion_runs.requested_vintage`);
   - `drizzle/rollback/0001_workable_lethal_legion.down.sql`
     (`ingestion_runs`, `source_registry` y sus enums);
   - `drizzle/rollback/0000_jittery_nextwave.down.sql` (`dataset_snapshots`);
6. desplegar el código compatible y comprobar health.

El rollback elimina las tablas y sus datos. No se ejecuta como script genérico para
evitar apuntar accidentalmente a la base personal. Revertir `0001` descarta el
audit trail completo de ingesta: si el incidente que se está revirtiendo tiene que
seguir siendo explicable, exportar `ingestion_runs` antes (`TM-16`). Revertir `0002`
descarta además cada revisión point-in-time publicada y su lineage hacia la corrida
que la produjo; `observations` referencia `ingestion_runs`, así que se elimina
primero (`TM-06`). Revertir `0003` descarta cada corrida de valuación, incluidas
las rechazadas que explican por qué un valor nunca se produjo, y con ellas los
snapshots de entrada: el motor es determinista, pero sin su snapshot un resultado
publicado deja de ser reproducible (`TM-16`). Revertir `0004` descarta el universo
constituido entero: identidades, versiones históricas y membresías de índice. Es
reconstruible —`pnpm universe:constitute --apply` sobre el mismo pin produce el mismo
grafo— pero **sólo el corte de ese pin**: los renombres y las salidas del índice que
se hubieran historizado desde entonces no vuelven, porque la fuente publica el estado
vigente y no su historia (`TM-06`).

## Fallas seguras

- Falta `DATABASE_DIRECT_URL`: `db:migrate` termina antes de abrir una conexión.
- Falta `DATABASE_TEST_URL`: el gate de integración falla, no se marca como aprobado.
- Falla una migración: no iniciar la app contra una versión de schema incompatible;
  conservar logs sin URLs ni credenciales y restaurar o aplicar el rollback revisado.
