# ADR 0070: las series de `/argentina` se actualizan al abrir la página

- Estado: aceptada
- Fecha: 2026-11-03
- Alcance: `F9-12`, después de `F9-06`.
- Relacionadas: [ADR 0015](0015-durable-ingestion-jobs.md) (jobs, lease,
  reintentos), [ADR 0020](0020-source-daily-budget-kill-switch.md) (cuota
  diaria y kill switch), [ADR 0030](0030-sector-prices-on-open.md) (precios de
  un sector al abrir su matriz), [ADR 0065](0065-bcra-monetary-catalog-vintages.md),
  [ADR 0068](0068-implied-ccl-adr-pairs.md),
  [ADR 0069](0069-argentina-activity-fiscal-external.md).

## Contexto

`F9-06` dejó `/argentina` leyendo lo que guardaban los comandos manuales. El
owner lo dijo sin vueltas: la información tiene que bajarse sola al entrar, y
la página tiene que darse cuenta de qué está viejo. «Lo ideal es que sea todo
automático, no manual desde mi lado».

Ninguna de las fuentes publica una fecha de publicación por dato, así que la
pregunta «¿hay algo nuevo?» no se contesta mirando los datos guardados: el EMAE
de septiembre puede salir cualquier día de noviembre, y el BCRA no avisa cuándo
cargó la serie del día. Lo que sí se sabe es **cuándo se le preguntó por última
vez** a cada fuente por cada serie.

## Decisión 1 — la frescura es una regla sobre revisiones (`argentina-refresh-freshness-1.0.0`)

Decisión del owner del 2026-11-03:

- **lo diario** —las siete series del BCRA que la página lee y las veinte patas
  de los pares ADR del CCL— está al día si se lo revisó después del último
  **cierre de día hábil**, que se toma a las 20:00 de Buenos Aires (23:00 UTC),
  de lunes a viernes. Un feriado no rompe nada: la revisión queda y no se pide
  de nuevo hasta el próximo cierre;
- **lo mensual** —los 19 indicadores del INDEC y los 6 de Series de Tiempo— está
  al día si se lo revisó **hoy**, en el día de Buenos Aires.

«Revisado» es lo más reciente entre la última corrida registrada de ese sujeto
(`ingestion_runs`, así que un comando manual también cuenta) y el último job de
esta actualización que lo terminó. La corrida de un indicador se registra con
el ID del indicador como `subjectKey`: el ID externo del INDEC es el servicio,
compartido por los 16 sectores.

Sólo se actualiza lo que la página lee. El resto de las 35 variables del BCRA y
el catálogo siguen siendo comandos.

## Decisión 2 — un job durable por fuente

Un `job_kind` nuevo, `argentina_data_refresh` (migración `0049`, con un
rollback que se niega mientras exista un job de ese kind, como el de `0022`).
Cada fuente con algo atrasado recibe **su** job con sólo sus sujetos
atrasados, así cada uno corre bajo el lease de su fuente (ADR 0015) y contra su
propia cuota y kill switch (ADR 0020). Un item es una request: una página de
una serie o el chart de una pata.

- **Sin bucles.** Un sujeto que un job terminó después del umbral —completo o
  fallado— cuenta como revisado. Una falla no se replanea en la próxima visita:
  la página nombra la fuente y ofrece «Reintentar», que es el único camino que
  la vuelve a pedir.
- **Sin jobs huérfanos.** Una fuente frenada o sin cuota no recibe un job que
  nadie puede correr; la página dice cuál y por qué.
- **Idempotente.** Mientras haya un job abierto no se planea otro, y un plan
  igual devuelve el existente.
- **Sólido.** Cada item se guarda al terminar; si el proceso muere, el lease
  vence y la próxima visita retoma desde el cursor. Un `429`/`503` difiere el
  job sin gastar intentos.
- Un job planeado con otra regla u otro parser no corre con el código actual
  (`assertArgentinaRefreshJob`).

El worker corre los jobs de fuentes distintas en paralelo; dentro de cada
fuente conserva el ritmo de una request por vez, su lease, su cuota y su kill
switch. Usa los mismos recorders que los comandos: `recordBcraSeries`,
`ingestAdrLeg` y `recordArgentinaIndicator`. Una fuente lenta o fallada no
frena el avance de las demás.

## Decisión 3 — la Server Action (`TM-03`)

`refreshArgentinaData` en `src/app/argentina/actions.ts` es un paso idempotente
—jobs abiertos, o un plan nuevo, o `fresh`— con las guardas de la ADR 0030:

- el modo se resuelve en el request y un runtime trabado responde
  `unavailable` sin componer nada;
- la entrada es **un booleano** (`retryFailures`) bajo un esquema cerrado: ni
  una serie, ni una URL, ni una fecha. Qué pedir lo decide el servidor desde
  los sets declarados;
- la salida son conteos, nombres de fuentes y códigos; el log lleva sólo el tipo
  del error (`TM-02`);
- el worker corre **después de responder**, con `after()`, y la página consulta
  la misma acción cada dos segundos;
- el render no escribe: `readArgentinaRefreshReadiness` sólo lee si hay algo
  atrasado o un job abierto, y el que dispara es el cliente.

El peor abuso posible es gastar, una vez por día hábil, unas 27 requests de
fuentes diarias y 25 de mensuales, todas dentro de sus topes.

## Decisión 4 — la superficie

Una línea de estado arriba de las tarjetas, sólo cuando hay algo que decir:
«Buscando datos nuevos…», «Actualizando BCRA, INDEC…» con una barra de progreso
real que cuenta también los jobs ya terminados de la misma vuelta, «Datos al
día.», o la fuente que falló con «Reintentar». Mientras tanto los bloques
muestran lo guardado, y al terminar la página se vuelve a leer sola.

## Medición

El 2026-11-03, sobre una réplica vacía con sólo el catálogo del BCRA, con el
build servido y Chromium:

- primera visita: cuatro jobs y 52 items (7 del BCRA, 20 patas, 19 del INDEC y 6
  de Series de Tiempo), 52 completos y 0 fallados; de «Buscando» a «Datos al
  día.» en 98 s, y la página se recargó sola con todos los bloques;
- segunda visita: ninguna línea de estado, ningún job y ninguna request.

## Límites declarados

- **El instante de cierre es fijo.** Las 20:00 de Buenos Aires no son un horario
  publicado por el BCRA; si la serie del día sale más tarde, la revisión de las
  20:00 no la encuentra y se ve al día siguiente.
- **Un cambio masivo espera al owner.** Una revisión metodológica o un rebase deja
  la corrida `quarantined` y la página sigue mostrando lo anterior; aceptarla es
  `--accept-mass-change` en el comando.
- **El worker vive en la función.** En Vercel, `after()` queda acotado por la
  duración de la función; si se corta, el lease vence a los cinco minutos y la
  próxima consulta retoma.
- **Sin visita no hay actualización.** No hay cron: la página se pone al día
  cuando se la abre, que es cuando importa.

## Enmienda del 2026-11-04 — fuentes independientes y frecuencia mensual

La captura del owner mostró 33 de 52 sujetos mientras INDEC seguía activo: el
worker en serie dejaba esperando a Series de Tiempo y a la soja. Desde esta
enmienda cada fuente avanza simultáneamente bajo su propio lease y ritmo; un
error de una fuente se recoge después de dejar avanzar a las otras.

`argentina-refresh-freshness-1.1.0` pregunta por INDEC, Series de Tiempo y
Estimaciones Agrícolas una vez por semana local, desde el lunes 00:00 de Buenos
Aires. Las fuentes diarias conservan el cierre de día hábil. Los servicios
mensuales no publican una señal barata y confiable de revisión de toda la
historia; por eso una consulta semanal todavía puede repetir datos y una
publicación nueva puede esperar hasta el lunes siguiente. «Reintentar» y el
comando manual siguen disponibles para una revisión inmediata. Los jobs ya
abiertos bajo `1.0.0` se terminan con sus sujetos originales; los nuevos se
planean con `1.1.0`.

El job privado de INDEC observado el 2026-11-04 estaba en `0/19`: 60 intentos
habían terminado en `credential_missing`, sin abrir un socket. La señal genérica
`refused` lo difería diez minutos y, al vencer ese plazo, cada consulta de la
página volvía a tomar y soltar el lease sin avanzar. La actualización ahora
comprueba la credencial con la misma regla de la puerta antes de planear o
ejecutar ese job. Si falta o es inválida, informa el bloqueo y deja avanzar a
las otras fuentes; el job abierto conserva sus sujetos y se reanuda al
configurar el token. No se incrementa la cuota ni se reintenta en bucle.
La inspección inicial de Vercel confirmó que `INDEC_API_TOKEN` no estaba
declarado en el proyecto; el archivo local sí lo tenía, pero no configuraba
Production. El token se agregó más tarde ese día.

## Corrección del 2026-11-04 — cuota de un job ya abierto

Después de configurar el token en Production, los 60 rechazos anteriores
habían consumido las 60 unidades de la cuota UTC del día. El job seguía
abierto en `0/19`: la admisión de cada intento lo detenía antes del socket,
pero la lectura de estado trataba un job abierto como ejecutable y la página
seguía mostrando «Actualizando». El worker tomaba y soltaba el lease en cada
consulta, sin mover el cursor.

La lectura y el worker ahora comprueban la cuota y el kill switch también
para los jobs **ya abiertos**, antes de describirlos como ejecutables o tomar
el lease. La superficie existente muestra «Se agotó la cuota diaria de INDEC»
y el horario UTC de reposición expresado en hora local. Abrir la página
después de la reposición retoma el mismo job. La cuota no se eleva ni se borra
para forzar una request: el límite del owner sigue siendo vinculante.

## Alternativas descartadas

- **Mirar las fechas de los datos.** Ninguna fuente publica cuándo publicó, y una
  serie mensual sin el mes nuevo no distingue «todavía no salió» de «salió y no
  lo bajamos».
- **Un solo job para las cuatro fuentes.** El lease y la cuota son por fuente
  (ADR 0015 y 0020): un job mixto tendría que tomar cuatro leases o saltearse
  los controles.
- **Descargar en el render.** Rompe la regla de no salir a la red mientras se
  dibuja y deja un minuto de pantalla en blanco.
- **Un cron diario.** El owner prefirió que la página se ocupe al abrirse; un cron
  suma un secreto y una frontera más.
