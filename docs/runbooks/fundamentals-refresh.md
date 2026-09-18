# Refresh de fundamentals

- Slice: `F2-05`, incremento 4
- Decisiones: [ADR 0021](../architecture/adr/0021-refresh-followed-set.md) (a
  quiénes sigue), [ADR 0022](../architecture/adr/0022-companyfacts-refresh-probe.md)
  (sondeo, marca y job)
- Runtime: personal local o protegido, con PostgreSQL

Mantiene fresco lo que ya bajaste. Cada vuelta le pregunta a `submissions` —un
request por filer— si apareció una presentación relevante nueva, y sólo entonces
vuelve a bajar companyfacts.

El conjunto que recorre **se define solo**: son los filers con fundamentals
publicados. No hay lista que mantener; crece con cada `pnpm fundamentals:ingest
--apply` y encoge cuando una poda deja a un sujeto sin filas.

No hay cron. Todo lo de acá se corre a mano.

## Ver el conjunto y sus marcas

```sh
pnpm fundamentals:refresh
```

No abre la red ni escribe: la pregunta es a PostgreSQL. Por filer informa cuántas
filas tiene, cuándo se lo miró por última vez y en qué presentación quedó su marca
de agua. Un filer sin símbolo vigente es un antecesor de reporte: entra por la
misma regla y su sondeo termina siempre en «sin novedades».

Al pie están los dos números que importan: lo que cuesta una vuelta de sondeo (un
request por filer) y el peor caso si todos hubieran cambiado.

## Refrescar un filer

```sh
pnpm fundamentals:refresh --cik 320193           # sondea y dice qué haría
pnpm fundamentals:refresh --cik 320193 --apply   # lo refresca si hay algo nuevo
```

El dry run **sí** gasta el request del sondeo: es la única forma de contestar la
pregunta. Lo que no hace es escribir ni bajar companyfacts.

Veredictos posibles:

| Veredicto                   | Qué pasó                                               |
| --------------------------- | ------------------------------------------------------ |
| `never_probed`              | primera vuelta del filer: baja una vez y deja la marca |
| `new_filing`                | hay presentaciones relevantes posteriores a la marca   |
| `up_to_date`                | la marca sigue siendo la más nueva: no baja nada       |
| `form_selection_superseded` | cambió la lista de formularios: se refresca una vez    |
| `no_relevant_filings`       | el índice no trae ninguna relevante con aceptación     |

La marca se escribe **después** del refresh. Si la descarga falla, la marca no se
mueve y la vuelta siguiente lo vuelve a intentar.

## La vuelta completa, como job

```sh
pnpm fundamentals:refresh --all                 # plan en seco: no crea nada
pnpm fundamentals:refresh --all --apply         # crea (o encuentra) el job
pnpm fundamentals:refresh --job <id>            # estado, sin tomar la fuente
pnpm fundamentals:refresh --job <id> --apply    # lo corre; --limit acota los intentos
```

Es un job durable de la [ADR 0015](../architecture/adr/0015-durable-ingestion-jobs.md):
lease por fuente, cursor, reintentos, poison policy y recuperación manual, todo
igual que el backfill. Se inspecciona y se opera con `pnpm ingestion:jobs`, que ya
distingue los dos kinds.

Pedir el mismo plan dos veces devuelve el mismo job mientras siga abierto. Cuando
termina, `--all --apply` crea uno nuevo: cada vuelta es un job.

Medido el 2026-09-18 sobre los seis filers de la base personal: la primera vuelta
son 20 requests y 15 segundos —los seis `never_probed` bajan una vez—, y la
segunda 6 requests y 3 segundos.

## Cuando algo sale mal

- **`source_busy`.** Otro proceso tiene el lease. Si murió, el lease vence solo en
  5 minutos, o se recupera en el acto:

  ```sh
  pnpm ingestion:jobs --release sec-edgar --reason "…" --apply
  ```

  El item que quedó `running` vuelve a `pending` y la corrida siguiente lo
  reintenta.

- **`daily_budget_exhausted` o `source_disabled`.** Son los controles de la
  [ADR 0020](../architecture/adr/0020-source-daily-budget-kill-switch.md). El job
  para sin gastar intentos y sin envenenar a nadie; los items quedan `pending`.
  Ver [source-budgets.md](source-budgets.md).

- **El sondeo quedó en cuarentena.** El índice no se entendió. No mueve la marca y
  no dispara ninguna descarga; el flag de la corrida dice qué documento y por qué.

- **Un filer que no debería estar en el conjunto.** Entra por tener datos, no por
  tener interés. Si ya no querés seguirlo, lo que corresponde es podar sus
  observaciones ([history-prune.md](history-prune.md)), no una lista de
  exclusiones.

## Después de un refresh que trajo un ejercicio nuevo

Una presentación anual nueva mueve el ancla de la ventana de cinco ejercicios, y
lo que queda afuera **no lo borra el refresh**. El comando informa el ancla de la
corrida; sacar lo que sobra es un acto aparte, con su motivo:

```sh
pnpm fundamentals:prune --ticker AAPL
pnpm fundamentals:prune --ticker AAPL --reason "…" --apply
```

Ver [history-prune.md](history-prune.md).

## Qué queda registrado

- Una corrida de `sec.submissions` por vuelta y por filer, con
  `parser_version = sec-refresh-probe-1.0.0`: `cursor` es la marca de la que
  partió y `next_cursor` la que dejó. Una vuelta sin novedades queda `duplicate`.
- Una fila por filer en `ingestion_refresh_state`: la marca, cuándo se lo miró,
  cuándo cambió por última vez, y las dos corridas —la del sondeo y la de
  companyfacts— que lo explican.
- La corrida de companyfacts, cuando la hubo, con lo suyo de siempre.
