# Backfill durable de companyfacts

- Slice: `F2-05`, incremento 1
- Decisión: [ADR 0015](../architecture/adr/0015-durable-ingestion-jobs.md)
- Runtime: personal local o protegido, con PostgreSQL y `SEC_USER_AGENT`

> **No correr el backfill del universo sobre la base personal todavía.** Hoy guarda
> toda la historia XBRL desde 2009: unos 1,2 GB para el universo. El owner decidió
> guardar cinco ejercicios, y la ventana llega con el incremento 2 de `F2-05`.

Lleva los hechos XBRL de todo el universo constituido a PostgreSQL en varias
corridas manuales. Una corrida puede morir en cualquier momento sin perder el
avance ni el orden. No hay cron: cada corrida la lanza el owner.

## Preparación

1. `pnpm db:migrate`: las tablas de jobs llegan con la migración `0010`.
2. El universo tiene que estar constituido (`pnpm universe:constitute --apply`).
3. Las sucesiones declaradas tienen que estar registradas
   (`pnpm corporate-actions:record --apply`). El plan agrega los antecesores de
   reporte y un antecesor que todavía no está en el grafo no entra.

No correr `fundamentals:ingest` ni `corporate-actions:*` mientras un backfill está
en curso: esos comandos no toman el lease y sumarían su ritmo al del backfill.

## Planear y crear el job

```bash
pnpm fundamentals:backfill                        # plan: sin red ni escritura
pnpm fundamentals:backfill --apply                # crea el job del universo
pnpm fundamentals:backfill --cik 320193 --apply   # job acotado a filers del plan
```

El plan son los miembros vigentes del índice, por el CIK de su emisor, más sus
antecesores de reporte, en orden de CIK. Si falta un CIK, el plan lo lista como
rechazo con nombre y no lo adivina. Pedir el mismo plan mientras su job siga
abierto o pausado devuelve ese mismo job.

## Correr

```bash
pnpm fundamentals:backfill --job <id>                     # estado y próximo item, sin tomar la fuente
pnpm fundamentals:backfill --job <id> --apply             # corre hasta terminar o frenar
pnpm fundamentals:backfill --job <id> --apply --limit 20  # a lo sumo 20 intentos
```

Cada línea de la salida es un intento: ordinal, CIK, ticker, número de intento,
decisión, segundos y requests acumulados. La corrida termina con una razón de
parada:

| Parada             | Qué pasó                                                                                      | Qué hacer                                                     |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `completed`        | no queda item                                                                                 | revisar fallados y envenenados                                |
| `budget_reserve`   | quedan menos de 66 requests de las 1.000 de la corrida                                        | volver a correr                                               |
| `attempt_limit`    | se alcanzó `--limit`                                                                          | volver a correr                                               |
| `interrupted`      | Ctrl-C: terminó la empresa en curso y soltó el lease                                          | volver a correr                                               |
| `source_signal`    | la SEC frenó (`429`, `403`, `503` o sin conexión) por más de 5 minutos, o tres veces seguidas | esperar `espera hasta`; si es un `403`, revisar el User-Agent |
| `job_not_runnable` | el job está pausado, cancelado o esperando a la fuente                                        | `pnpm ingestion:jobs --job <id>`                              |
| `item_backoff`     | la empresa del cursor espera un reintento de más de 5 minutos                                 | volver a correr después de esa hora                           |
| `source_busy`      | otro proceso tiene el lease de `sec-edgar`                                                    | esperar, o liberar si ese proceso está muerto                 |
| `lease_lost`       | otro proceso tomó la fuente mientras esta corrida trabajaba                                   | no hace falta nada: el intento se repite                      |

Un segundo Ctrl-C sale en el acto sin soltar el lease. El lease vence a los 5
minutos y la empresa en curso se repite en la corrida siguiente.

## Inspeccionar y recuperar

```bash
pnpm ingestion:jobs                           # jobs recientes y leases tomados
pnpm ingestion:jobs --job <id>                # conteos, items con problemas y bitácora
pnpm ingestion:jobs --job <id> --events 100
```

Toda acción es dry run salvo con `--apply`, y exige `--reason`. El motivo queda
redactado en la bitácora con actor `owner`.

- **Proceso muerto que retiene la fuente.** Esperar a que el lease venza (5 min)
  y volver a correr, o liberarlo ya:

  ```bash
  pnpm ingestion:jobs --release sec-edgar --reason "kill -9 del proceso 1234" --apply
  ```

  La empresa en curso vuelve a la cola con su intento contado. Si el proceso
  seguía vivo, su próxima escritura falla y no pisa nada.

- **Pausar un job que está corriendo.** La empresa en curso termina y la corrida se
  detiene:

  ```bash
  pnpm ingestion:jobs --job <id> --pause --reason "revisar un 404" --apply
  pnpm ingestion:jobs --job <id> --resume --reason "404 entendido" --apply
  ```

- **Levantar la espera de la fuente antes de tiempo**, por ejemplo después de
  corregir `SEC_USER_AGENT` tras un `403`:

  ```bash
  pnpm ingestion:jobs --job <id> --resume --reason "User-Agent corregido" --apply
  ```

- **Reintentar una empresa fallada o envenenada**, después de entender por qué. El
  cursor vuelve a ese item y un job completado se reabre:

  ```bash
  pnpm ingestion:jobs --job <id> --requeue 17 --reason "parser corregido" --apply
  ```

- **Abandonar un job.** Cancelar se niega mientras el job tenga el lease. Primero
  hay que pausarlo o liberar la fuente:

  ```bash
  pnpm ingestion:jobs --job <id> --cancel --reason "plan viejo" --apply
  ```

Un job planeado con otro pipeline o con otra selección de conceptos no corre con el
código actual. En ese caso se cancela y se planea uno nuevo.

## Qué significa cada estado de item

- `completed`: el intento registró una corrida publicada, duplicada, vacía o en
  cuarentena. La cuarentena la explica su corrida (`TM-05`), no el job.
- `failed`: el filer no está en el universo, o la corrida falló de una forma que
  reintentar no arregla (un `404`, un documento demasiado grande).
- `poisoned`: agotó sus 3 intentos por fallos transitorios o porque el proceso
  murió con él en curso.
- `pending` con intentos: espera un reintento (30 s, 2 min) o volvió a la cola al
  recuperarse de un proceso muerto.

## Rollback

`drizzle/rollback/0010_smooth_sally_floyd.down.sql` borra las tablas de jobs y su
bitácora; las corridas y observaciones quedan intactas. El script se niega mientras
haya jobs abiertos o pausados o leases tomados. Antes de correrlo, exportar
`ingestion_job_events` si el incidente tiene que seguir siendo explicable.
