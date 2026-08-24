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

## PostgreSQL local con Docker Desktop

La configuración versionada usa la imagen oficial `postgres:17.11-alpine3.23`,
publica sólo en `127.0.0.1:55432` y conserva sus datos en un volumen Docker separado.

Crear la configuración local una sola vez:

```powershell
Copy-Item .env.docker.example .env.docker.local
```

Reemplazar el password de ejemplo en `.env.docker.local`. Ese archivo está ignorado
por Git. Luego iniciar y comprobar el servicio:

```powershell
pnpm db:test:up
docker compose --env-file .env.docker.local -f compose.test.yaml ps
```

Para detenerlo sin perder el volumen:

```powershell
pnpm db:test:down
```

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

Configurar la conexión directa sólo en el proceso administrativo y ejecutar:

```powershell
$env:DATABASE_DIRECT_URL = "<direct-test-or-admin-url>"
pnpm db:migrate
```

El job abre una única conexión, aplica `drizzle/` y la cierra. Next.js no ejecuta
migraciones al iniciar y el runtime no lee `DATABASE_DIRECT_URL`.

Para verificar el repositorio contra PostgreSQL real:

```powershell
$env:DATABASE_TEST_URL = "postgres://finance_portal_test:<local-password>@127.0.0.1:55432/finance_portal_test"
pnpm test:integration
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
   - `drizzle/rollback/0001_workable_lethal_legion.down.sql`
     (`ingestion_runs`, `source_registry` y sus enums);
   - `drizzle/rollback/0000_jittery_nextwave.down.sql` (`dataset_snapshots`);
6. desplegar el código compatible y comprobar health.

El rollback elimina las tablas y sus datos. No se ejecuta como script genérico para
evitar apuntar accidentalmente a la base personal. Revertir `0001` descarta el
audit trail completo de ingesta: si el incidente que se está revirtiendo tiene que
seguir siendo explicable, exportar `ingestion_runs` antes (`TM-16`).

## Fallas seguras

- Falta `DATABASE_DIRECT_URL`: `db:migrate` termina antes de abrir una conexión.
- Falta `DATABASE_TEST_URL`: el gate de integración falla, no se marca como aprobado.
- Falla una migración: no iniciar la app contra una versión de schema incompatible;
  conservar logs sin URLs ni credenciales y restaurar o aplicar el rollback revisado.
