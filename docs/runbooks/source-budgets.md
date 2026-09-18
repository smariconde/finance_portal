# Presupuesto diario y kill switch por fuente

- Slice: `F2-05`, incremento 3
- Decisión: [ADR 0020](../architecture/adr/0020-source-daily-budget-kill-switch.md)
- Runtime: personal local o protegido, con PostgreSQL

Dos controles sobre la cuota de cada fuente, compartidos por todos los procesos:

- el **presupuesto diario** se repone solo a las 00:00Z y acota cuántas llamadas
  salen en un día, sin importar cuántos comandos se corran;
- el **kill switch** frena una fuente hasta que el owner la habilite.

Los dos se aplican en la única puerta de salida, antes de abrir el socket.

## Ver el estado

```sh
pnpm ingestion:sources                    # todas las fuentes con tope declarado
pnpm ingestion:sources --source sec-edgar # una, con su historia de controles
pnpm ingestion:sources --source sec-edgar --days 30
```

Por fuente informa el estado, el tope declarado en código, el tope vigente, el
consumo del día y el de los días anteriores.

## Frenar una fuente

```sh
pnpm ingestion:sources --source sec-edgar --disable --reason "…"          # dry run
pnpm ingestion:sources --source sec-edgar --disable --reason "…" --apply
```

A partir de ese momento ninguna llamada sale: los comandos manuales salen con
`Source sec-edgar is disabled: <motivo>.` antes del primer request, y un backfill
en curso termina la empresa que tenía a medias y para con `source_disabled` sin
gastar intentos ni envenenar sujetos.

Habilitar es simétrico y también exige motivo:

```sh
pnpm ingestion:sources --source sec-edgar --enable --reason "…" --apply
```

El consumo del día **no** se reinicia al habilitar: lo gastado, gastado está.

## Bajar el tope por un día

```sh
pnpm ingestion:sources --source sec-edgar --limit 200 --reason "…" --apply
```

El tope declarado en código es el techo. Un `--limit` mayor se rechaza sin
escribir: subir la cuota de una fuente es un cambio en
`SOURCE_DAILY_REQUEST_BUDGETS` y en la [matriz de cuotas](../data/provider-use-matrix.md),
en el mismo diff. Para volver al declarado, `--enable` sin `--limit`.

Un `--limit 0` frena las llamadas sin ser un kill switch: el consumo dice
`daily_budget_exhausted` y no `source_disabled`. Para frenar una fuente de verdad,
usar `--disable`, que deja el motivo donde se lo lee.

## Qué pasa cuando se agota

- **Backfill.** El job no empieza otra empresa: reserva su peor caso (66 requests)
  contra la corrida y contra el día. La corrida para con `daily_budget_exhausted`,
  informa cuándo se repone el contador y suelta el lease. El job queda `open` y
  reanuda solo al día siguiente; no hace falta `--resume`.
- **Comando manual de un ticker.** La comprobación previa es por **una** llamada,
  no por el peor caso, así que un comando puede empezar y quedarse sin cuota a
  mitad. La corrida falla con `provider_error` llevando el mensaje del presupuesto,
  y la ingesta es idempotente: repetirla al día siguiente no duplica nada.

## Una fuente nueva

Antes de la primera llamada necesita tres cosas, y ninguna implica a las otras:

1. entrada en la **allowlist de egress** (host y prefijos de path, ADR 0009);
2. **derechos** aprobados en el registro de fuentes (`TM-15`);
3. una línea en **`SOURCE_DAILY_REQUEST_BUDGETS`**, derivada de la matriz de cuotas.

Sin la tercera, el egress la niega con `budget_undeclared`: falla cerrado.

## Verificar

```sql
select source_id, usage_on, requests, first_request_at, last_request_at
from ingestion_source_budgets order by usage_on desc, source_id;

select source_id, status, daily_request_limit, actor, reason, recorded_at, superseded_at
from ingestion_source_controls order by recorded_at desc;
```

A lo sumo una fila por fuente con `superseded_at is null`: es el estado vigente, y
el índice único parcial lo garantiza. Las cerradas son la historia y no se tocan.

El rollback de la migración `0014` se niega mientras una fuente esté frenada:
revertir volvería a habilitarla en silencio.
