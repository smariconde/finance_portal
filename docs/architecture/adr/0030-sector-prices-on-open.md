# ADR 0030: precios de un sector al abrir su matriz

- Estado: aceptado
- Fecha: 2026-10-01
- Alcance: `F7-08`. Decide cuándo la matriz sectorial descarga precios, qué
  descarga, cómo lo hace sin consumir de más ni entrar en bucle, y cómo se abre
  la primera frontera de la web que muta. El selector de fecha de `F7-05` sale.
- Decisiones relacionadas: [ADR 0005](0005-request-time-runtime-boundary.md)
  (el modo se resuelve en el request), [ADR 0015](0015-durable-ingestion-jobs.md)
  (jobs, lease, reintentos), [ADR 0020](0020-source-daily-budget-kill-switch.md)
  (cuota diaria y kill switch), [ADR 0026](0026-daily-prices-source.md) (serie
  cruda e inmutable), [ADR 0029](0029-reference-series-sector-risk-matrix.md) (la
  referencia y la rueda asentada)

## Contexto

`F7-05` dejó la matriz leyendo sólo la base: si a un sector le faltaban precios,
la página lo decía y mandaba a la terminal (`pnpm prices:ingest --sector …`).
El owner probó la pantalla y lo dijo sin vueltas: abrir un sector sin precios
«no tiene sentido» si no los baja. Pidió además que la descarga sea **inteligente
y sólida**: que use lo guardado, pida sólo lo que falta, gaste lo mínimo de
cuota y de tiempo, y no se rompa a mitad de camino.

En la misma conversación decidió que el análisis es **siempre a hoy**: una matriz
a una fecha pasada no responde ninguna pregunta que le importe. Con el selector
de fecha, el botón habría tenido dos comportamientos —descargar a hoy, leer al
pasado—, y una fecha vieja habría mostrado una matriz que nunca se actualiza.

Descargar desde la web choca con dos reglas del proyecto: las páginas **no salen
a la red durante el render**, y `TM-03` trata toda Server Action como un endpoint
público. No existía ninguna.

## Decisión 1 — la matriz es siempre a hoy

`/sectores/[sector]` deja de aceptar `?asOf`. El `as_of` es el último cierre
guardado de la referencia, y el bloque de procedencia lo dice. `loadSectorRiskMatrix`
conserva su parámetro de corte: es el dominio, y la regla de no mirar después
del `as_of` no depende de quién elija la fecha.

## Decisión 2 — qué falta (`sector-price-freshness-1.0.0`)

La regla tiene que decidir sin un calendario de feriados y sin pedir dos veces lo
mismo. Vive pura en `prices/domain/price-freshness.ts`:

- **Una rueda está asentada** desde las 22:00 UTC de su fecha. La sesión regular
  termina a las 21:00 UTC en horario estándar del Este y a las 20:00 en el de
  verano, y `settled-session-1.0.0` espera una hora más: las 22:00 son el caso
  peor de los dos horarios.
- **La referencia está al día** si tiene la última rueda hábil asentada —lunes a
  viernes— **o** si un job ya la revisó después de que esa rueda se asentó. La
  segunda condición es la que resuelve un feriado: la fuente no tiene rueda que
  dar, la revisión queda registrada, y no se vuelve a pedir hasta la próxima.
- **Una security está al día** si tiene el cierre de la **última rueda de la
  referencia**. El índice operó todas las ruedas que existieron, así que su
  última fecha es la rueda que corresponde pedirle a cada security, sin adivinar
  feriados. Una security revisada por un job después de que esa rueda se asentó
  también está al día: una suspendida no tiene el cierre, y pedirlo de nuevo no lo
  crea.

«Revisada» significa: fue item terminal —completo, fallado o envenenado— de un
job de precios **completado** y **creado** después del asentamiento. Se toma la
creación y no el fin porque un item empieza después de que su job se creó, y un
job que empezó antes de las 22:00 pudo haber pedido la rueda cuando todavía no
estaba. Un job cancelado no cuenta: el owner lo frenó, no lo revisó.

## Decisión 3 — la descarga es un job durable en dos fases

Un `job_kind` nuevo, `yahoo_prices_refresh` (migración `0022`, con un rollback
que se niega mientras exista un job de ese kind, igual que el de `0016`). Reusa
**entera** la maquinaria de la ADR 0015 y la admisión de la ADR 0020:

- **dos fases, nunca juntas**: primero la referencia —un item, `yahoo.benchmark-close`—
  y, cuando termina, las securities atrasadas —un item por security,
  `yahoo.daily-close`—. Si se planearan juntas, las securities se compararían
  contra una referencia todavía vieja, y en un feriado se pediría el sector entero
  por nada;
- **sólo lo atrasado**: un sector al día no crea ningún job y no gasta ninguna
  request. Cada item es una request: el chart trae la serie entera con sus splits
  y dividendos, la ingesta deduplica por contenido (ADR 0026) y el des-ajuste
  necesita los splits de la misma respuesta. Pedir sólo los días nuevos ahorraría
  bytes, no requests, que es lo que la cuota mide;
- **lease por fuente** (`yahoo-finance`): dos pestañas, dos sectores o dos
  procesos no descargan a la vez. Mientras haya un job de precios abierto no se
  planea otro, y el plan igual devuelve el existente;
- **sólido**: cada item se guarda al terminar; un proceso que muere deja el lease
  vencido y el próximo que abra una matriz lo retoma; un `429`/`403`/`503` difiere
  el job sin gastar intentos; el kill switch y la cuota diaria frenan antes de
  abrir el socket, y con la fuente frenada **no se planea** un job que nadie puede
  correr;
- **sin bucles**: lo que falló después de la rueda queda revisado y no se replanea
  solo. La página lo dice con su símbolo y ofrece «Reintentar», que es el único
  camino que lo vuelve a pedir (`retryFailures`).

El job planeado guarda la versión de la regla como `selection_version`, y uno
planeado con otra regla u otro parser no se corre con el código actual
(`assertPriceRefreshJob`).

## Decisión 4 — la primera Server Action (`TM-03`)

`refreshSectorPrices` en `src/app/sectores/[sector]/actions.ts` es un paso
idempotente: si hay un job de precios abierto, devuelve su estado; si no, planea
lo que falta; si no falta nada, `fresh`. El worker corre **después de
responder**, con `after()`, y la página consulta la misma acción cada dos
segundos. Se trata como un endpoint público:

- el modo se resuelve en el request (`getRequestConfigHealth`, ADR 0005) y un
  runtime trabado responde `unavailable` sin componer nada;
- la entrada es un esquema **cerrado**: un código de la taxonomía declarada y un
  booleano. No acepta tickers, URLs ni fechas; el plan lo arma el servidor;
- la salida es un DTO de conteos y códigos. Ningún mensaje de error sale, y el
  log lleva sólo el tipo (`TM-02`);
- cada request pasa por la única puerta de egress con su allowlist, su cuota y su
  kill switch, así que el peor abuso posible es gastar la cuota del día de una
  fuente que ya tiene tope;
- Next.js rechaza una acción cuyo `Origin` no coincide con el host.

Un proceso corre a lo sumo un worker (`activeWorker`); entre procesos decide el
lease. El render no escribe: la página llama a `readSectorPriceReadiness`, que
sólo lee, y la que dispara la descarga es el cliente.

## Decisión 5 — la superficie

Una línea de estado sobre la matriz, que se ve sólo cuando hay algo que decir:
«Revisando precios…», «Actualizando la referencia…», «Descargando los precios
que faltan…» con una barra de progreso real («12 de 40»), «Esperando que termine
otra descarga…» si la fuente está con otro sector, y el motivo con nombre cuando
algo frena —cuota agotada y cuándo se repone, kill switch, job pausado—. Sólo el
título es región viva: el conteo cambia cada dos segundos y anunciarlo saturaría
un lector de pantalla. Mientras tanto la matriz muestra lo guardado, y al
terminar se recalcula sola.

## Enmienda — cierre no disponible después de una revisión

`sector-price-freshness-1.1.0` separa dos hechos que la regla original confundía:
item terminal significa que la fuente fue consultada, no que exista el cierre de
la rueda de referencia. La revisión sigue frenando el replaneo automático para
una security suspendida o para un cierre que todavía no publicó Yahoo. Si la
security continúa sin ese cierre, la página muestra su símbolo y «Reintentar»;
ese pedido explícito vuelve a planearla incluso cuando el item previo terminó
`completed`. La misma regla permite reintentar una referencia revisada que siga
sin la rueda esperada. El estado «Precios al día» sólo se muestra cuando no hay
cierres faltantes después de la revisión. No cambian el asentamiento a las 22:00
UTC, la cuota, el lease ni el orden de las dos fases.

## Medición

El 2026-10-01 sobre la base personal, con el dev server:

- Communication Services, ya al día: ningún job, ninguna request;
- Energy, sin precios: un job de 21 items, 21 requests al contador diario de
  `yahoo-finance`, 27 s de punta a punta, 21 puntos en la matriz;
- volver a abrir Energy: ningún job, ninguna request;
- seis sectores en total, de 21 a 59 securities: 200 items, 0 fallados y 200
  requests en el contador del día.

## Límites declarados

- **El instante de asentamiento es fijo.** En horario de verano la rueda del día
  se reconoce una hora más tarde de lo necesario. Es el lado seguro: la otra
  dirección guardaría un intradía como cierre.
- **Una revisión fallida espera al owner.** Una security cuyo pedido falló no se
  reintenta sola en la próxima visita; lo hace el botón. Es el costo de no entrar
  en bucle contra una fuente que rechaza un símbolo.
- **El worker vive en el proceso web.** En el runtime local eso es lo que se
  quiere. En un despliegue serverless (`F6-06`) `after()` queda acotado por la
  duración de la función, y un sector grande tendría que retomarse en varias
  visitas: el lease y el cursor ya lo permiten.
- **La descarga manual sigue existiendo.** `pnpm prices:ingest` no toma el lease,
  como el resto de los comandos manuales; comparte el contador diario, no el turno.

## Alternativas descartadas

- **Descargar dentro del request.** Un minuto de spinner sin progreso, sin
  reanudación si se corta, y la regla de «nada de red en el request» rota.
- **Un botón aparte de «Ver matriz».** El owner lo descartó: si falta algo, abrir
  el sector ya es pedirlo.
- **Un calendario de feriados.** Una dependencia más para una pregunta que la
  propia referencia contesta.
- **Planear el sector entero y saltear lo fresco en el ejecutor.** Un item
  completo exige una corrida que lo respalde, y la barra de progreso contaría
  como trabajo lo que no lo fue.
