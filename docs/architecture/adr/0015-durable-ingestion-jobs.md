# ADR 0015: jobs durables de ingesta en PostgreSQL

- Estado: aceptado
- Fecha: 2026-09-16
- Alcance: primer incremento de `F2-05`. Fija dónde viven los jobs y sus
  presupuestos, y cómo se implementan el lease, el cursor, el checkpoint, el
  vencimiento, la poison policy y la recuperación manual. No programa ningún
  refresh.
- Decisiones relacionadas: [ADR 0001](0001-stack-cache-postgres.md) (PostgreSQL
  con pooler y conexión directa sólo para migraciones),
  [ADR 0009](0009-egress-boundary.md) (egress),
  [ADR 0010](0010-sec-xbrl-ingestion.md) (idempotencia de la ingesta por
  contenido), [threat model](../../security/threat-model.md) (`TM-10`, `TM-11`,
  `TM-16`)

## Contexto

La ingesta de la SEC es un comando manual por ticker. Llevar el universo entero a
PostgreSQL no entra en una corrida:

- el plan real tiene **501 filers**: los 500 emisores de los 503 miembros del
  S&P 500 más el antecesor de ExxonMobil;
- una empresa gasta de 2 a 66 requests (JPMorgan midió 47);
- la matriz de cuotas fija 2 requests/s, de a uno y 1.000 por corrida.

Un backfill necesita varias corridas, y cualquiera puede morir a mitad de camino:
una laptop que se suspende, un Ctrl-C o una conexión que se cae.

[`02_ARCHITECTURE.md`](../../finance-portal-masterplan/02_ARCHITECTURE.md) pide
elegir por ADR entre una tabla de jobs durable, Vercel Workflow/Queues u otra
alternativa. La elección tiene que garantizar entrega at-least-once, idempotencia,
una poison policy y recuperación manual, y no puede depender de una beta sin
fallback. Hasta ahora `TM-11` estaba sólo contratado.

## Decisión

### Tablas propias en el PostgreSQL existente

Migración `0010`, sin dependencias nuevas:

- **`ingestion_jobs`**: un plan fijo de sujetos (`plan_hash`), las versiones de
  parser y selección, `max_attempts`, el estado, el **cursor** y un `not_before`
  para cuando la fuente pide esperar. Los estados son `open`, `paused`,
  `completed` y `cancelled`.
- **`ingestion_job_items`**: un item por sujeto con ordinal, estado, intentos,
  backoff, el token del intento en curso, la última corrida de ingesta y el último
  fallo redactado. Los estados son `pending`, `running`, `completed`, `failed` y
  `poisoned`.
- **`ingestion_source_leases`**: una fila por fuente con holder, token,
  adquisición, último latido y vencimiento.
- **`ingestion_job_events`**: bitácora append-only con orden total
  (`event_sequence`). Registra quién tomó, soltó o forzó un lease, qué se decidió en
  cada intento y cada acción manual con su motivo.

Los checks de PostgreSQL espejan los schemas de Zod:

- un item está `running` si y sólo si tiene token;
- un item terminal tiene `finished_at`;
- un item completo apunta a su corrida;
- un job completo tiene el cursor al final y uno abierto, antes del final;
- a lo sumo existe un job abierto o pausado por plan. Esa es la idempotencia del
  pedido.

### El lease es por fuente, no por job

Lo que se protege es la cuota de la fuente: 2 requests/s agregados. Dos jobs de la
SEC en paralelo duplicarían el ritmo aunque cada uno lo respetara. El lease es
entonces el permiso para gastar la cuota de una fuente, y un proceso que corre un
job lo toma antes del primer request.

**Vencer habilita la toma; no la produce.** Mientras nadie tome un lease vencido,
su token sigue siendo del holder y sus escrituras valen. La protección contra un
proceso zombi es el token, no el reloj:

- cada escritura del worker (empezar un item, registrar su resultado, latir,
  soltar) está cercada por el token;
- si otro proceso tomó la fuente, esa escritura no ocurre y el worker recibe
  `lease_lost`;
- cada escritura cercada renueva además el vencimiento.

El TTL es de 5 minutos. Un latido cada 60 s mantiene el lease durante un intento
largo; el peor caso teórico de la SEC son 66 requests con un deadline de 30 s cada
uno.

### Un lock transaccional serializa las transiciones

Cada transición corta toma `pg_advisory_xact_lock(20515, hashtext(source_id))`
antes de leer. Eso da tres garantías:

- ninguna lectura queda vieja antes de escribir;
- el orden de locks no puede producir un deadlock;
- la toma de un lease y el checkpoint tardío del dueño anterior se ordenan: gana
  uno y el otro ve el resultado.

El lock es de **transacción**. Con un pooler en modo transacción (ADR 0001), un lock
de sesión quedaría en una conexión que otro cliente reusa. Una colisión del hash
entre dos fuentes sólo serializa de más.

### El cursor es el primer item no terminal

Los items se procesan **en orden y de a uno**. El cursor se recalcula en cada
transición: lo anterior terminó y nada posterior empezó. Así, reencolar un item
viejo hace retroceder el cursor sin una regla aparte, y el checkpoint es la
transición misma del item, escrita junto con el cursor en la misma transacción.

El orden estricto es aceptable porque la concurrencia es 1: nada se gana
adelantando otro sujeto mientras uno espera su backoff.

### Entrega al menos una vez y poison policy

El intento se cuenta **al empezar**. Un proceso que muere deja su item `running` con
un token que ya no es el del lease. El próximo que toma la fuente, o una liberación
manual, lo recupera: vuelve a `pending` o, si llegó al techo, pasa a `poisoned` y el
cursor lo saltea. Un sujeto que tumba al proceso en cada intento termina aislado
en vez de frenar el universo.

La repetición es segura porque la ingesta es idempotente por contenido (ADR 0010).
Verificado sobre PostgreSQL: el intento repetido de un checkpoint perdido deja una
corrida `duplicate` y ninguna observación nueva.

La decisión sobre cada intento es una función pura (`decideItemAttempt`):

| Resultado del intento                                                | Item                                                             | Job           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------- |
| corrida registrada: publicada, duplicada, vacía o en cuarentena      | `completed`                                                      | cursor avanza |
| corrida `failed` reintentable (un `5xx` de un documento)             | `pending` con backoff 30 s · 2 min · 8 min; al techo, `poisoned` | —             |
| corrida `failed` no reintentable, o sujeto rechazado antes de la red | `failed`                                                         | cursor avanza |
| excepción sin clasificar                                             | como un reintento; al techo, `poisoned`                          | —             |
| proceso muerto o lease perdido                                       | recuperado: `pending`, o `poisoned` al techo                     | —             |
| **señal de la fuente**                                               | `pending`, **sin gastar el intento**                             | `not_before`  |

El worker espera un backoff de hasta 5 minutos, del item o del job, sin soltar el
lease y con el latido corriendo. Si la espera es más larga, suelta el lease y para.
Tres señales de la fuente seguidas en una misma corrida también la frenan: una
fuente que sigue fallando no se espera indefinidamente.

### Las señales de la fuente no son culpa del sujeto

Si la fuente está caída diez minutos, fallar cada empresa que se intente en ese
rato envenena el universo. Por eso, para la SEC, estas señales frenan el job y no
cuentan como intentos:

- **`throttled`**: `429`. El job espera lo que diga `Retry-After`, o 10 minutos si
  no dice nada.
- **`refused`**:
  - `403`: en `data.sec.gov` un filer inexistente es `404`, así que un `403` es la
    fuente rechazando al cliente (User-Agent o ritmo);
  - un bloqueo de configuración del egress;
  - derechos sin aprobar, que se repetirían en cada empresa.

  Espera 10 minutos.

- **`unavailable`**: `503`, un nombre que no resuelve, un deadline o un error de
  transporte. Espera 1 minuto, que la corrida pasa esperando.

La espera de `unavailable` se corrigió con datos reales. El borrador esperaba 5
minutos y frenaba la corrida. En la primera corrida real sobre JPMorgan, un
`transport_error` suelto en el request 10 dejó el job parado hasta que el owner lo
relanzara. Un corte así se resuelve en segundos; si cada uno detuviera la corrida,
recorrer 501 filers exigiría relanzarla a mano una y otra vez.

`response_too_large` sí es del filer. La espera queda entre 1 y 60 minutos, y el
owner puede levantarla con `resume`.

### Presupuestos

- **Por corrida.** El espaciador existente (1.000 requests) se mantiene. Una empresa
  sólo empieza si el presupuesto restante cubre su **peor caso** (66 requests), así
  que nunca se agota a mitad de un documento.
- **Por día y kill switch por fuente.** Son el segundo incremento. Se guardarán en
  PostgreSQL, en una tabla de uso por fuente y día UTC que ningún redeploy pueda
  reiniciar, junto a un interruptor por fuente que el worker consulte antes de
  tomar el lease y antes de cada item. Hoy el freno manual es pausar el job.

### Recuperación manual y reloj inyectado

`pnpm ingestion:jobs` lista, inspecciona, pausa, reanuda (y levanta un backoff),
cancela, reencola un item fallado o envenenado, y libera un lease declarando muerto
a su holder. Toda acción:

- es dry run salvo con `--apply`;
- exige un motivo, que se redacta;
- queda en la bitácora con actor `owner`.

Cancelar se niega mientras el job tenga un lease, vivo o vencido.

Ninguna sentencia usa `now()`: los instantes llegan del reloj inyectado. Los tests
mueven el tiempo en vez de esperarlo, y un mismo contrato corre contra el doble en
memoria y contra PostgreSQL.

## Consecuencias

- Módulos nuevos:
  - `src/modules/ingestion/`: dominio, transiciones, puerto con su contrato, worker
    y doble en memoria;
  - `src/modules/fundamentals/`: plan del backfill, observador de señales y
    ejecutor.
- Otros componentes nuevos: `postgres-ingestion-job-store.ts`, los comandos
  `pnpm fundamentals:backfill` y `pnpm ingestion:jobs`, y la migración `0010` con su
  rollback. El rollback se niega si hay jobs abiertos o leases.
- Los comandos manuales existentes (`fundamentals:ingest`, `corporate-actions:*`)
  **no** toman el lease. Correrlos durante un backfill suma su ritmo al del
  backfill (4 requests/s, por debajo de los 10 de Fair Access). El runbook lo
  advierte, y el kill switch del segundo incremento los cubrirá.
- El item referencia su corrida con una foreign key. Borrar corridas exige borrar
  antes los items que las nombran, y las suites de integración lo hacen en ese
  orden.

## Lo que encontraron las corridas reales

El 2026-09-16, sobre una réplica descartable del grafo personal, las corridas reales
sacaron a la luz dos defectos anteriores a este slice. Los dos quedaron corregidos
con pruebas que fallan sobre el código viejo.

- **La tercera vuelta sobre el mismo contenido se rompía.**
  - `findByIdempotencyKey` devolvía la corrida más reciente de la clave, y las
    `duplicate` también la llevan.
  - Con Apple ya ingerida y repetida una vez, el backfill intentó publicar de
    nuevo y chocó con el índice único. La poison policy lo aisló como corresponde:
    dos intentos y `poisoned`.
  - Afectaba también a splits y listings. El repositorio devuelve ahora la corrida
    publicable de la clave, si existe.
  - El mensaje de una excepción envuelta usa ahora la causa más interna; antes, el
    SQL del driver tapaba el motivo dentro de los 240 caracteres.
- **`ETIMEDOUT` prematuro al conectar.** Es el _happy eyeballs_ de Node con 250 ms
  por dirección en un host sin IPv6. Enmienda de la [ADR 0009](0009-egress-boundary.md).
  Antes de corregirlo, este corte obligó a revisar la política de señales:
  `unavailable` espera 1 minuto dentro de la corrida en lugar de frenarla.

## Alternativas descartadas

- **Vercel Queues o Workflow.** Recurso externo con costo y ciclo de vida propios,
  y el backfill hoy corre en la máquina del owner. Además, la cola no reemplaza el
  lease por fuente: dos mensajes en paralelo seguirían duplicando el ritmo.
- **El archivo bulk `companyfacts.zip`.** Es una sola descarga para todo EDGAR, pero
  supera por mucho el techo de 32 MB del egress, exige descomprimir con una
  dependencia nueva y trae decenas de miles de filers fuera del universo. Por
  empresa, el universo entra en un par de corridas de 1.000 requests.
- **pg-boss, graphile-worker, DBOS o Inngest.** Una dependencia estructural nueva
  para un solo tipo de job, secuencial y de un solo owner. Ninguno modela «un lease
  por cuota de fuente» sin configuración equivalente a lo que se escribió.
- **Advisory locks de sesión como lease.** Mueren con la conexión, pero no tienen
  vencimiento visible ni auditable y se rompen con un pooler en modo transacción.
- **`FOR UPDATE SKIP LOCKED` con lease por item.** Pensado para paralelizar, que
  acá está prohibido. El lease por fuente con un solo item en curso es la misma
  garantía con menos estados.
- **`now()` de la base como reloj.** Obligaría a los tests a esperar el TTL y
  mezclaría dos relojes en una misma fila.

## Límites conocidos

- Un `403` persistente sobre un mismo filer frena el job en ese item hasta que el
  owner lo resuelva. Es la elección conservadora frente a marcar el universo como
  fallido.
- El worker no aborta un intento en curso cuando pierde el lease. El intento
  termina y su checkpoint se rechaza; mientras tanto dos procesos pudieron hablar
  con la fuente a la vez durante un intento.
- Refresh sólo de CIK con presentaciones nuevas, presupuesto diario, kill switch y
  programación siguen en `F2-05`, en ese orden.
