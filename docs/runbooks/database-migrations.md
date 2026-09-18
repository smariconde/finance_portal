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

Cuando el SQL generado no alcanza —un cambio de tipo que necesita `USING`, un guardia
que se niega antes de perder datos, el orden de una reescritura— se edita el `.sql` a
mano y el snapshot queda como lo generó `drizzle-kit`. `0012` es el ejemplo: con el
tipo `sha256` de `schema.ts`, `drizzle-kit` escribe `"undefined"."bytea"` y no sabe
convertir hex a binario.

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
   - `drizzle/rollback/0014_worthless_mockingbird.down.sql` (el presupuesto diario
     y el kill switch por fuente; falla mientras alguna fuente esté frenada);
   - `drizzle/rollback/0013_medical_the_phantom.down.sql` (la tabla
     `observation_prunes`; falla mientras haya una poda registrada, y no restaura
     ninguna observación borrada);
   - `drizzle/rollback/0012_jittery_whiplash.down.sql` (la forma anterior de
     `observations`: hashes en texto, fuente, dataset, parser, ID externo,
     `metric_id` y `late_ingestion` guardados en cada fila, y los dos índices
     anteriores; falla mientras haya una observación cuyo ID externo no se puede
     reconstruir);
   - `drizzle/rollback/0011_lush_plazm.down.sql` (la columna
     `ingestion_runs.selection_anchor_on` y su check; falla mientras alguna
     corrida tenga un ancla registrada);
   - `drizzle/rollback/0010_smooth_sally_floyd.down.sql` (las cuatro tablas de
     jobs durables y sus enums; falla con un job abierto o pausado, o con un lease
     tomado);
   - `drizzle/rollback/0009_pretty_thunderbird.down.sql` (tipos de adquisición y
     cambio de ticker, check de declaración e índice de sucesor; falla atómicamente
     si un evento o vínculo sigue usando los tipos nuevos);
   - `drizzle/rollback/0008_grey_ultimo.down.sql` (traspasos y delistings;
     falla si todavía existen eventos que usan esos tipos);
   - `drizzle/rollback/0007_amazing_captain_marvel.down.sql` (los valores `split`
     y `reverse_split` de `corporate_action_type`, que se reconstruye sin ellos, y
     `corporate_actions_split_terms_check`);
   - `drizzle/rollback/0006_lonely_zeigeist.down.sql` (`corporate_actions`,
     `legal_entity_relationships` y sus tres enums; las entidades que una sucesión
     trajo al grafo quedan, porque las observaciones ya las referencian);
   - `drizzle/rollback/0005_fancy_lord_hawal.down.sql` (`source_documents`, las
     columnas `ingestion_runs.subject_key` y `selection_version`, y el valor
     `year_to_date` de `observation_period_type`, que PostgreSQL no puede quitar y
     por eso se reconstruye el tipo);
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
vigente y no su historia (`TM-06`). Revertir `0005` descarta los documentos de fuente
—para la SEC, cada presentación con su instante de aceptación—: las observaciones
conservan su `available_at` y su accession, pero ya no la evidencia de por qué valen
eso. Si alguna observación usa `year_to_date`, el rollback **falla a propósito** en
la reconstrucción del tipo y la transacción entera se deshace; hay que exportar o
borrar esas filas antes, como decisión explícita (`TM-06`, `TM-16`). Revertir `0006`
descarta cada sucesión declarada: un sucesor deja de ver la historia de su antecesor.
Revertir `0007` descarta cada split confirmado, y una lectura `latest_adjusted` vuelve
a mezclar bases en una serie por acción que cruzó un split; si algún evento usa
`split` o `reverse_split` la reconstrucción del tipo falla a propósito, igual que
`0005` (`TM-06`, `TM-16`). Revertir `0011` descarta el ancla de la ventana de
historia de cada corrida `sec-core-concepts-2.0.0`: sin ella, un período ausente
vuelve a ser ambiguo entre «el filer no lo reportó» y «la corrida no lo fue a
buscar» (ADR 0017). Por eso se niega mientras haya anclas; exportarlas y limpiarlas
es una decisión explícita (`TM-16`). Revertir `0012` no pierde nada: cada columna
vuelve a llenarse desde la fila y su corrida (ADR 0018). El ID externo sólo tiene
fórmula para companyfacts de la SEC, así que el rollback se niega mientras exista
una observación de otra fuente o de una corrida sin `subject_key`. Para volver a
aplicar `0012` después, borrar su fila de `drizzle.__drizzle_migrations` y correr
el job de migración. Revertir `0013` **no** deshace ninguna poda: las observaciones
ya no están y el rollback sólo borraría su auditoría, que es lo único que explica
por qué faltan (ADR 0019). Por eso se niega mientras haya podas registradas;
exportarlas y limpiarlas es una decisión explícita (`TM-16`). Revertir `0014`
devuelve el presupuesto a ser por proceso y deja al owner sin forma de frenar una
fuente: los dos son controles de `TM-10`, así que es una degradación deliberada y
no una limpieza (ADR 0020). Se niega mientras una fuente esté deshabilitada, porque
revertir la volvería a habilitar en silencio; el consumo del día se descarta con la
tabla, que es un contador y no historia que otra cosa referencie.

## Fallas seguras

- Falta `DATABASE_DIRECT_URL`: `db:migrate` termina antes de abrir una conexión.
- Falta `DATABASE_TEST_URL`: el gate de integración falla, no se marca como aprobado.
- Falla una migración: no iniciar la app contra una versión de schema incompatible;
  conservar logs sin URLs ni credenciales y restaurar o aplicar el rollback revisado.
- `0012` se niega con «cannot be made lighter without losing data»: alguna
  observación tiene un ID externo, una procedencia o un `late_ingestion` que la
  fila liviana no podría reconstruir, y el mensaje cuenta cada caso. No se toca
  nada. En la base personal hay que entender esas filas antes de seguir; en
  `finance_portal_test`, que es desechable, alcanza con vaciar `observations`.
