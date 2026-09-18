# ADR 0020: presupuesto diario y kill switch por fuente

- Estado: aceptado
- Fecha: 2026-09-18
- Alcance: incremento 3 de `F2-05`. Acota la cuota de cada fuente por día, en
  PostgreSQL y compartida entre procesos, y le da al owner una forma de frenar una
  fuente sin tocar código. No autoriza cron, gasto ni proveedores nuevos.
- Decisiones relacionadas: [ADR 0009](0009-egress-boundary.md) (la única puerta de
  salida), [ADR 0015](0015-durable-ingestion-jobs.md) (jobs durables y lease por
  fuente), [ADR 0010](0010-sec-xbrl-ingestion.md) (ritmo por corrida),
  [threat model](../../security/threat-model.md) (`TM-10`, `TM-11`),
  [matriz de cuotas](../../data/provider-use-matrix.md)

## Contexto

El ritmo por corrida existe desde `F2-03`: 2 requests/s, concurrencia 1 y 1.000
llamadas para la vida del cliente. Acota **un proceso**, y eso deja dos agujeros
que `TM-10` y `TM-11` nombran desde entonces:

- **Cada comando arranca con el techo entero.** Dos ingestas seguidas son 2.000
  requests, y diez son 10.000. Nada acota un día, que es la unidad en la que una
  fuente mide el abuso.
- **No hay forma de frenar una fuente.** Si la SEC empieza a devolver `403`, o el
  owner quiere parar todo mientras mira algo, la única palanca es no correr los
  comandos —y acordarse.

El lease por fuente de la ADR 0015 no cubre ninguno de los dos: protege el avance
ordenado de un job, y los comandos manuales de un ticker no lo toman a propósito.
Dos procesos sin lease compartido pueden gastar cuota a la vez.

## Decisión

### 1. El contador es de la fuente y vive en PostgreSQL

Migración `0014`, tabla `ingestion_source_budgets`: una fila por fuente y **día
UTC**, con el contador y los dos instantes. La cuota se gasta al **intentar**, como
el presupuesto por corrida: una llamada que falla también consumió cuota.

Gastar es **una sola sentencia**, un upsert cuyo incremento está condicionado al
tope:

```sql
insert into ingestion_source_budgets (…) values (…, 1, …)
on conflict (source_id, usage_on) do update
  set requests = ingestion_source_budgets.requests + 1, …
  where ingestion_source_budgets.requests < $limit
returning requests
```

No devolver fila **es** la negativa. Eso alcanza para la concurrencia: PostgreSQL
serializa el upsert sobre la misma clave, así que dos procesos no pueden pasarse
del tope sin lock, sin lease y sin transacción explícita. Es lo que permite que los
comandos manuales queden acotados sin tomar el lease del backfill.

El día es **UTC** y sale del reloj inyectado. Un día local haría que el mismo
instante contara distinto según dónde corra el proceso.

### 2. El tope se declara en código; la fila sólo puede bajarlo

`SOURCE_DAILY_REQUEST_BUDGETS` sale de la matriz de cuotas: 2.000 para `sec-edgar`
y 10 para `datahub-sp500-pddl`. El de la SEC cubre un barrido del universo —1.194
requests medidos— más el trabajo manual del mismo día.

Una fuente que no figura ahí **no tiene cuota y se niega**. Estar en la allowlist de
egress concede alcanzabilidad, no cuota, igual que no concede derechos: son tres
controles distintos y ninguno se deduce de otro.

`ingestion_source_controls` puede guardar un tope operativo, y el dominio resuelve
el efectivo con un mínimo: **la fila baja el declarado y nunca lo sube**. Subir la
cuota de una fuente es un diff revisable; bajarla por un día es una palanca de
runtime. El comando rechaza un `--limit` mayor que el declarado antes de escribir.

### 3. El kill switch es una fila append-only, no una columna del registro

`ingestion_source_controls` es append-only con `superseded_at` y un índice único
parcial por fuente: la fila abierta es el estado vigente y las cerradas son la
historia de quién cambió qué, cuándo y por qué (`TM-16`). Estado, motivo y actor son
obligatorios.

No es una columna de `source_registry` porque esa tabla es un documento
**declarado** que `syncDeclaredSourceRegistry` reescribe desde la constante del
código en cada comando: una decisión operativa ahí duraría hasta el próximo
`pnpm fundamentals:ingest`.

Presupuesto y kill switch son dos controles y no uno: agotar el día es una
condición que pasa y se repone sola; frenar una fuente es una decisión que se toma
y sólo se deshace tomando otra. El veredicto los distingue por nombre.

### 4. Se aplica en la única puerta, y ESLint la deja ser única

`createMeteredEgressFetch` envuelve el egress **por dentro** del ritmo: primero se
ordena y espacia la llamada, y recién cuando le toca salir se gasta la cuota. Así
el contador cuenta llamadas que iban a salir y no intenciones encoladas.

`getSourceEgressFetch` es la única forma de conseguir un `EgressFetch` fuera de
`src/server/egress/`, y `getEgressClient` queda restringido por ESLint a ese
directorio, como `decimal.js` a `decimal-policy.ts` (ADR 0003). Un llamador que
pudiera construir el cliente crudo tendría una puerta sin contador, que es
exactamente lo que este incremento cierra.

Los seis comandos manuales pasan por ahí. Además comprueban el estado **antes** de
la primera llamada, para salir con el motivo en vez de fallar contra un request.

### 5. El worker decide antes de contar el intento

`runIngestionJob` consulta una sola admisión antes de empezar cada item, que reúne
el presupuesto de la corrida y los dos controles por fuente, los tres con la misma
reserva del peor caso de una empresa (66 requests). Cada negativa tiene su nombre:
`budget_reserve`, `source_disabled`, `daily_budget_exhausted`.

La consulta va **antes** de contar el intento, así que ninguna de las tres gasta
intentos ni envenena sujetos: una fuente frenada o sin cuota no es un problema del
sujeto. La corrida para, suelta el lease y no muta el job; `daily_budget_exhausted`
informa cuándo se repone el contador.

No se inventó ningún estado nuevo de job. Pausar el job desde el worker habría
escrito una decisión del owner con la mano equivocada, y un `not_before` de hasta un
día habría chocado con el techo de una hora que la política de señales usa para
otra cosa.

### 6. Una negativa nuestra no es una señal de la fuente

El observador de señales de la SEC ignora `SourceRequestRefusedError`: un
presupuesto agotado no es algo que la fuente haya dicho. Si la fuente queda frenada
**a mitad** de una empresa, el ejecutor la clasifica como señal `refused`, que
difiere sin gastar el intento, y la admisión del próximo item la nombra con
precisión.

### 7. Ninguno de los dos habilita programación

Sigue sin haber cron. El incremento existe para que el refresh del incremento 4
llegue con estos dos controles ya puestos, no para habilitarlo.

## Medición sobre la base personal (2026-09-18)

- **El contador cuenta lo que sale.** `pnpm fundamentals:ingest --ticker AAPL` en
  seco hizo 2 requests y el contador quedó en 2 de 2.000.
- **Kill switch.** Con `sec-edgar` deshabilitada, `fundamentals:ingest` y
  `corporate-actions:splits` salen con
  `Source sec-edgar is disabled: prueba del kill switch.` antes de abrir ningún
  socket, y el contador del día no se mueve.
- **El techo declarado manda.** `--limit 5000` se rechaza contra el declarado de
  2.000 y no escribe nada; `--limit 3` sí se aplica.
- **Agotarlo a mitad de una corrida.** Con el tope en 3 y 2 gastadas, la ingesta
  pasó la comprobación previa, hizo la tercera llamada y la cuarta quedó negada:
  la corrida falló con `provider_error` llevando el mensaje del presupuesto, y el
  contador quedó en 3 de 3. Es el borde honesto de un comando manual; el backfill
  no lo tiene, porque reserva el peor caso de una empresa antes de empezarla.
- **Historia.** Los cuatro cambios del ensayo quedaron con su actor, su motivo y su
  instante, y en todo momento hubo un solo control vigente.

Sobre PostgreSQL, con conexiones reales: **doce llamadas simultáneas contra un tope
de cinco dejan pasar exactamente cinco**, y los cinco permitidos ven contadores
1 a 5 —ninguno se pisó—.

## Consecuencias

- La cuota de una fuente deja de depender de cuántos comandos se corran.
- El owner puede frenar una fuente en el acto, con el motivo registrado, y
  levantarla igual.
- `TM-10` pasa a `implemented` para la SEC y el archivo de constituyentes; `TM-11`
  pierde su pendiente de kill switch.
- Una fuente nueva necesita, además de allowlist y derechos, una línea en la tabla
  de topes: sin ella no sale ninguna llamada.
- El rollback de la `0014` se niega mientras una fuente esté frenada: revertir
  volvería a habilitarla en silencio.

## Alternativas descartadas

- **Extender el lease de la ADR 0015 a los comandos manuales.** El lease serializa
  el avance de un job; convertirlo en un semáforo global impediría correr dos
  comandos a la vez aunque la cuota alcance, y seguiría sin acotar el día.
- **Un contador en memoria compartido por proceso.** Es lo que ya hay, y es el
  problema.
- **Una columna `disabled` en `source_registry`.** La sincronización del registro
  la pisa en el próximo comando.
- **Que el worker pause el job al ver la fuente frenada.** Escribe una decisión del
  owner con actor `owner` sin que el owner la haya tomado sobre ese job, y obliga a
  un `--resume` manual para algo que se resuelve habilitando la fuente.
- **Reservar cuota por adelantado y liquidarla al terminar.** Las reservas se
  filtran cuando un proceso muere y necesitan su propia recuperación. El incremento
  condicionado no puede pasarse del tope y no deja nada colgado.
- **Contar por ventana móvil de 24 horas.** Más justo con la fuente, pero el estado
  deja de ser un contador y pasa a ser un log de llamadas. La matriz de cuotas está
  escrita por día.
