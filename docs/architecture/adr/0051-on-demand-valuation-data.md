# ADR 0051: la corrida baja lo que le falta y audita su sujeto antes de valuar

- Estado: aceptado
- Fecha: 2026-10-21
- Alcance: `F6-05`. La corrida por ticker baja la ventana de fundamentals de la
  SEC y el SIC si faltan, y el precio si está atrasado. Después audita el contrato
  point-in-time de su sujeto y recién entonces valúa. No llama al modelo.
- Decisiones relacionadas: [ADR 0045](0045-ticker-valuation-job.md) (la corrida
  es un job de evaluación), [ADR 0015](0015-durable-ingestion-jobs.md) (jobs
  durables con lease por fuente), [ADR 0016](0016-analysis-scope-sector-matrices.md)
  (fundamentals por ticker valuado, sin lote), [ADR 0020](0020-source-daily-budget-kill-switch.md)
  (cuota diaria y kill switch), [ADR 0030](0030-sector-prices-on-open.md)
  (precios al abrir), [ADR 0031](0031-on-demand-company-assessment.md) (el SIC
  observado), [ADR 0036](0036-sec-acceptance-clock.md) (el reloj de las
  aceptaciones)

## Contexto

Hasta `F6-12` la corrida evalúa lo guardado. Un ticker sin fundamentals termina en
`annual_fundamentals` y el owner tiene que correr `pnpm fundamentals:ingest` y
`pnpm valuation:assess --apply` a mano. La comparación con el mercado usa el último
cierre guardado, aunque esté atrasado.

El 2026-10-20 una reingesta de ExxonMobil publicó 91 filas que rompían el contrato
point-in-time. Sólo las detectó `pnpm gate:point-in-time`, corrido a mano. Si la app
baja datos por su cuenta, nadie va a correr ese comando.

El owner decidió dos cosas el 2026-10-21:

- **sólo datos**: el job no llama a la IA. Un ticker nuevo puede terminar sin
  transcripción de opciones (`employee_equity_not_proposed`) o con la industria
  ambigua (`cost_of_capital_unavailable`). Esas tareas se siguen corriendo a mano;
  la frontera app → IA (`TM-03`) no se abre en este slice;
- **dos jobs encadenados**: el corte de un job no se mueve.

## Decisión 1 — qué falta, decidido sobre la evaluación

`valuation-data-1.0.0` mira la evaluación que el job ya hace sobre lo guardado y
nombra tres faltantes:

| Parte          | Falta cuando                                               | Qué baja                                                               |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `fundamentals` | la evaluación no tiene serie anual                         | companyfacts del CIK y de sus antecesores de reporte, como job durable |
| `sic`          | ninguna aserción `sec-sic` es visible al corte             | un `submissions` del CIK, la misma observación que `valuation:assess`  |
| `prices`       | la security no tiene el cierre de la última rueda asentada | la serie de Yahoo de la security, como job durable de una request      |

La regla de precios es la de la referencia de la ADR 0030 aplicada a una security
(`ticker-price-freshness-1.0.0`). La security está al día si tiene el cierre de
la última rueda hábil asentada (lunes a viernes, después de las 22:00 UTC), o si un
job ya la revisó después de ese instante. Lo segundo cubre un feriado o una acción
suspendida sin calendario y sin bucles.

Una ventana guardada con una selección vieja **no** cuenta como faltante. Traer lo
nuevo es trabajo del refresh (ADR 0022), no de la corrida.

## Decisión 2 — las descargas reutilizan los jobs durables

Fundamentals y precios no son código nuevo de ingesta. Son los jobs de la ADR 0015:

- fundamentals: un `sec_companyfacts_backfill` con el CIK y sus antecesores;
- precios: un `yahoo_prices_refresh` con la security.

Ambos corren bajo el lease de su fuente y con la admisión de la ADR 0020. Un plan
igual a uno abierto devuelve ese job, y eso es la **reanudación**. Si la fuente
está ocupada, sin cuota, frenada o en backoff, el job de valuación termina con
`ingestion_pending` y el motivo. El de ingesta queda abierto, y el próximo pedido
del ticker lo retoma donde quedó. Un sujeto que la fuente rechaza termina en
`ingestion_failed` con el código del item. Ninguna de las dos cosas se reintenta
sola.

El job de valuación no espera en línea más que un minuto
(`maxInlineWaitMs`). Una espera más larga es `ingestion_pending`, no un request
colgado.

El SIC es una sola request y no tiene job propio: se pide como en
`valuation:assess --apply`, con la cuota y el kill switch, pero sin lease. Es la
misma excepción que los comandos manuales.

Los precios no bloquean la corrida. Si Yahoo no responde, el job sigue con lo que
hay, y la comparación con el mercado nombra la ausencia como ya lo hacía.

## Decisión 3 — dos jobs, cada uno con su corte

Lo que la app baja se publica **después** del encolado. Para fundamentals esto no
importa: la base de conocimiento es la disponibilidad pública. Para el SIC sí
importa, porque su `available_at` es la observación, y un corte anterior no lo ve.
Mover el `knownAt` de un job rompería el contrato de `F6-01` (`knownAt <= createdAt`).

Por eso, si un job bajó algo, termina con el gap `data_ingested`. En la misma
transacción se encola un segundo job del mismo ticker, con corte nuevo y
`follows_job_id` apuntando al primero. El mismo worker lo corre a continuación. La
página sigue al job abierto, así que no cambia nada para ella.

Un job que continúa a otro **nunca baja nada**. Si la ventana sigue faltando,
termina en `annual_fundamentals`, como antes. Eso evita el bucle: el reintento
siempre es otro pedido del owner.

## Decisión 4 — todo job audita su sujeto antes de valuar

Antes de armar el snapshot, el job corre las cinco afirmaciones de
`point-in-time-audit-1.0.0` sobre las cadenas del emisor y de sus antecesores de
reporte. Usa el mismo dominio y la misma lectura paginada que el gate, filtrada por
`subject_id`. Cuesta lecturas, no requests.

- Una afirmación con una falla bloquea. El job termina en
  `point_in_time_audit_failed` con la afirmación, el concepto y la fecha del primer
  hallazgo, más el total de fallas. Nada se repara solo.
- Una afirmación `not_exercised` no bloquea: el bloqueo es para lo que falla, no
  para lo que no se pudo probar.

La auditoría corre en todo job, no sólo en el que bajó algo. Si corriera sólo
después de una descarga, el pedido siguiente valuaría sobre la misma falla.

## Decisión 5 — el job late mientras baja

Un job `running` se retoma a los dos minutos (`F6-01`). Una descarga de la SEC con
una espera en línea puede pasar ese tiempo. El job gana `heartbeat_at`: el worker
lo renueva cada 30 segundos con el token del reclamo, y un job se considera viejo
por el último latido, no por el arranque.

## Registro

`valuation-job-1.2.0`, migración `0034`:

- gaps nuevos: `data_ingested`, `ingestion_pending`, `ingestion_failed` y
  `point_in_time_audit_failed`;
- `data_step` (`jsonb`, validado por `valuation-data-1.0.0`): por parte, estado y
  motivo; la auditoría, con cadenas, afirmaciones sin ejercer y el primer
  hallazgo;
- `follows_job_id`, único y con FK a `valuation_jobs`;
- `heartbeat_at`.

Una fila `1.0.0` o `1.1.0` no tiene `data_step` y conserva lo que dijo.

## Consecuencias

- Un ticker con CIK, sin nada guardado, llega solo a una evaluación con su SIC y su
  ventana. Si su SIC es ambiguo o no tiene transcripción de opciones, el gap lo
  nombra y el owner corre la tarea de IA a mano.
- Valuar gasta cuota de la SEC y de Yahoo. Una empresa nueva cuesta unas pocas
  requests de la SEC (66 en el peor caso, reservadas por la admisión) y una de
  Yahoo. Volver a valuar al día siguiente cuesta sólo el precio.
- Una base con una cadena rota deja de valuar ese sujeto hasta que el owner la
  repare. Es a propósito.

## Límites

- No llama al modelo: transcripción de opciones, industria, mix y lectura de
  expectativas siguen siendo comandos.
- No registra splits (`corporate-actions:splits`). La corrida usa el conteo de la
  carátula, que ya está en la base más reciente.
- No refresca una ventana existente ni actualiza un SIC ya observado.
- No hay valuación por lote (ADR 0016).
