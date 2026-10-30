# ADR 0064: descarga de lo que le falta a la matriz de divergencias

- Estado: aceptado
- Fecha: 2026-10-30
- Alcance: `F8-02`, último incremento. Decide qué baja el botón de la matriz de
  divergencias, en qué orden, cómo evita pedir dos veces lo mismo y cómo usa la
  cuota diaria cuando no alcanza para todo el sector.
- Decisiones relacionadas: [ADR 0015](0015-durable-ingestion-jobs.md) (jobs,
  lease, reintentos), [ADR 0016](0016-analysis-scope-sector-matrices.md)
  (fundamentales por sector, sin el universo), [ADR 0017](0017-sec-history-window.md)
  (el ancla de la ventana SEC), [ADR 0020](0020-source-daily-budget-kill-switch.md)
  (cuota diaria y kill switch), [ADR 0030](0030-sector-prices-on-open.md) (precios
  al abrir la matriz de riesgo, la primera Server Action)

## Contexto

La superficie de `F8-02` decía, para un sector sin fundamentales, cuántos pedidos
SEC costaría bajarlos y cuánta cuota quedaba hoy, y mandaba a la terminal
(`pnpm fundamentals:backfill --sector …`). Faltaba el botón.

Antes de escribirlo se midió la base personal. En Energy sólo DVN tenía
fundamentales, y aun así su vista a cinco años no tenía precio: la matriz de
riesgo guarda cinco años y dos semanas de cierres, y el cierre fiscal de hace
cinco ejercicios queda antes, porque el último ejercicio cerró hasta un año
atrás. Communication Services tenía siete años sólo porque en `F8-01` se bajaron
a mano con `prices:ingest --fiscal-history`. Bajar sólo la SEC dejaría vacía la
vista a cinco años en cada sector nuevo.

La cuota SEC es de 2.000 pedidos por día, y el peor caso de un filer son 66.
Un sector de 70 emisores pide 4.620 en el peor caso; lo medido en Communication
Services fueron 52 pedidos para 21 filers.

## Decisión 1 — el owner lo pide, la página no

A diferencia de los precios de la matriz de riesgo, la descarga no arranca al
abrir la página: cuesta cuota SEC, y la superficie existe para decir cuánto
antes de gastarla. El render sólo lee (`readSectorDivergenceDownload`) y el
botón llama a `downloadSectorDivergenceData`.

## Decisión 2 — dos fases que nunca van juntas (`sector-divergence-download-1.0.0`)

Decisión del owner: la descarga trae fundamentales **y** precios.

1. **Fundamentales.** Los filers del sector —la población versionada y sus
   antecesores de reporte, como `fundamentals:backfill --sector`— que no tienen
   una corrida de companyfacts con ancla. Es un job `sec_companyfacts_backfill`
   de la ADR 0015 con esos CIK.
2. **Precios.** Sólo cuando la fase SEC no tiene nada pendiente, porque qué
   cierres fiscales hay sólo se sabe con los ejercicios guardados: las
   securities cuyo cierre fiscal anterior —a 2 o a 5 años— no tiene precio, con
   siete años de historia (`fiscal-price-history-1.0.0`). Es un job
   `yahoo_prices_refresh` con la selección `fiscal-price-history-1.0.0`: el
   mismo tipo y el mismo lease que la matriz de riesgo, y su último cierre
   también cuenta como frescura.

Cada consulta del cliente es un paso idempotente: si hay un job abierto, su
estado; si no, el plan de la fase que falta; si no falta nada, `complete`. Al
terminar la fase SEC el mismo paso planea los precios, y la página se recalcula
en cada cambio de fase.

## Decisión 3 — lo pedido no se pide otra vez

- Un filer con corrida anclada ya está. Uno sin ancla que un job terminado
  revisó —falló o no trajo ejercicios— tampoco se replanea solo: la página lo
  nombra y ofrece «Reintentar» (`retryFailures`), como en la ADR 0030.
- La corrida de precios de siete años registra `selectionVersion =
fiscal-price-history-1.0.0` y `selectionAnchorOn` = el primer día pedido,
  como la SEC registra su ancla. Una security cuya corrida anclada pidió desde
  antes de `cierre − 7 días` (la tolerancia de `fiscal-endpoints`) no se vuelve
  a pedir: si la fuente no tiene ese precio —cotiza desde después—, pedirlo de
  nuevo no lo trae. Un cierre anterior al inicio de siete años no se pide
  (`beyond_history_window`), porque se pediría siempre.
- Las corridas de cinco años siguen sin ancla: no cambian su contenido ni su
  idempotencia.

## Decisión 4 — la cuota, filer por filer

Decisión del owner: el botón está habilitado mientras quede cuota para el peor
caso de **un** filer. El job reserva los 66 pedidos antes de empezar cada uno
(la admisión de la ADR 0020); si la cuota se acaba, frena sin gastar intentos y
la página dice cuándo se repone y ofrece «Seguir descargando». Lo bajado queda.
Exigir el peor caso de todo el sector habría dejado afuera para siempre a los
sectores de más de 30 emisores.

## Decisión 5 — la frontera (`TM-03`)

`downloadSectorDivergenceData` tiene las guardas de `refreshSectorPrices`: modo
resuelto en el request y negativa sin componer nada en un runtime trabado;
esquema cerrado de un código de la taxonomía y un booleano, nunca un CIK, un
ticker ni una URL; el plan lo arma el servidor; cada pedido pasa por el egress
medido; la respuesta son conteos, tickers y códigos, sin el ID del job; el log
guarda `error.name`. El worker corre con `after()`; los precios usan el worker
de la matriz de riesgo (uno por proceso) y la SEC uno propio. La espera en línea
se corta al minuto, como en la corrida por ticker.

## Límites declarados

- La descarga no audita point-in-time al terminar, como tampoco lo hace
  `fundamentals:backfill`: `pnpm gate:point-in-time` sigue siendo el gate.
- Los «revisados» salen de los últimos 25 jobs terminados de cada fuente. Un
  filer fallado hace muchos jobs vuelve a planearse una vez.
- Un job abierto de otra descarga (la corrida por ticker, otra matriz) ocupa la
  fuente: el paso lo informa y espera, sin encolar detrás.

## Alternativas descartadas

- **Sólo SEC.** Cumplía el backlog al pie de la letra y dejaba vacía la vista a
  cinco años.
- **Pedir siete años en la matriz de riesgo.** Duplicaría el peso de cada serie
  para un sector que quizá nunca se mira en divergencias.
- **Decidir por la primera rueda guardada.** Un emisor que salió a bolsa entre
  hace siete y cinco años se habría pedido en cada clic: sin registrar el inicio
  pedido no hay forma de distinguir «la fuente no lo tiene» de «nunca se pidió».
