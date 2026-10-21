# ADR 0047: el historial de corridas compara snapshots, no valores

- Estado: aceptado
- Fecha: 2026-10-21
- Alcance: `F6-02`. Lista las corridas de un ticker y dice qué cambió respecto
  de la anterior. No muestra valores, no escribe y no sale a la red.
- Decisiones relacionadas: [ADR 0045](0045-ticker-valuation-job.md) (el job),
  [ADR 0046](0046-derived-valuation-assumptions.md) (la corrida registrada)

## Contexto

Desde `F6-07` cada job `fcff_base` que arma el snapshot registra una corrida
en `valuation_runs`, que es append-only. `F6-02` pide volver a verlas,
refrescar lo que cambió y comparar contra la anterior sin sobrescribirla.

## Decisión 1 — refrescar es volver a encolar

No hay un botón nuevo ni una ruta de escritura: un job nuevo lee la base a su
propio corte y, si el snapshot es idéntico, `record` devuelve la corrida que
ya estaba (misma clave de replay). Nada se pisa. El historial lee los últimos
20 jobs terminados del ticker (`listCompletedByTicker`, techo en los dos
almacenes, `TM-07`) y, por cada corrida, la busca por ID.

## Decisión 2 — la comparación es por sección, `valuation-run-comparison-1.0.0`

Dos corridas con el mismo `input_hash` son `same_run`. Si no, cada clave del
snapshot se compara con su hash canónico y se agrupa en una sección con
nombre estable: ventas base, normalización, capitalización, costo de capital,
industria o mix, método o rigor, probabilidad de fracaso, opciones o
acciones, puente, supuestos, versiones, identidad. Una clave que la tabla no
conoce cuenta como `versions`: sólo una versión nueva del snapshot agrega
claves.

El corte —`knowledge` y `asOf`— va **aparte**. Cambia en cada pedido, así que
un refresco que sólo lo movió se lee «sólo el corte; los datos no cambiaron».
Sin esa separación todas las corridas dirían que cambió algo.

La comparación nunca mira el resultado. Decir cuánto subió el valor es
mostrar el valor, y eso es `F6-03`.

## Decisión 3 — una acción aparte

`loadValuationHistory` tiene los mismos controles que `enqueueValuation`
(`TM-03`): modo en el request, esquema cerrado de un solo campo, respuesta de
códigos y fechas, sin IDs. No comparte esquema con la de encolar para que un
intento nuevo no se cuele en ninguna de las dos.

## Consecuencias

- Medido sobre una réplica el 2026-10-21: catorce refrescos de AAPL en un
  minuto dieron catorce corridas; la primera dice «Primera corrida» y las
  demás «sólo el corte». Cada corrida ocupa 21 kB comprimidos: mil refrescos
  son unos 21 MB. Si eso pesa, la palanca es no registrar una corrida cuyo
  único cambio es el corte, y es una decisión aparte.
- Axe sobre la página, escritorio y móvil: sin hallazgos nuevos. `region`
  sobre la sidebar y el contraste del botón primario en hover ya estaban.
- Un job encolado antes de `F6-07` aparece con su resultado y sin
  comparación.

## Enmienda del 2026-10-21 (`F6-12`)

`loadValuationHistory` se quitó. Desde `F6-03` el historial se lee en el
render de `/valuacion/[ticker]`, y desde `F6-12` la entrada ya no lo muestra:
la acción quedó sin llamador, y una Server Action exportada sin uso sigue
siendo un endpoint (`TM-03`). La decisión 1 sigue igual: refrescar es volver
a encolar, ahora con «Volver a valuar» en la página del ticker.

## Alternativas descartadas

**Comparar el valor por acción.** Adelanta `F6-03` sin su superficie de
provenance.

**Un diff campo por campo.** Para el owner, «costo de capital» dice más que
una lista de rutas JSON; el detalle vive en el snapshot.
