# ADR 0080: riesgo país desde Ámbito, con el cambio de índice de J.P. Morgan fechado

- Estado: aceptada
- Fecha: 2026-11-17
- Alcance: `F9-19` (la decisión) y `F9-21` (la ingesta y el bloque).
- Relacionadas: [ADR 0069](0069-argentina-activity-fiscal-external.md)
  (registro de indicadores, revisiones y guarda de cambio masivo),
  [ADR 0070](0070-argentina-refresh-on-open.md) (actualización al abrir),
  [ADR 0071](0071-soy-basis-sources.md) (fuentes `owner_accepted` sin términos
  publicados), [ADR 0020](0020-source-daily-budget-kill-switch.md).

## Contexto

`F9-19` pide decidir indicador, unidad, upstream, cobertura, revisiones,
derechos y atribución del riesgo país antes de ingerir o graficar. La pregunta
que contesta en `/argentina`: ¿qué spread soberano paga la Argentina y de dónde
sale la cifra?

Lo medido el 2026-11-17, sin guardar ningún payload en el repositorio:

- **No hay fuente oficial.** Ninguna de las 1.610 series del catálogo del BCRA
  (ADR 0065) ni del distribuidor de Series de Tiempo es el riesgo país; el
  dataset de bonos del IAMC en Series de Tiempo termina el 2020-08-28.
- **El indicador es de J.P. Morgan.** El «riesgo país» es el spread de la
  Argentina en el EMBI. Desde el **2025-09-30** J.P. Morgan sacó a la Argentina
  del EMBI+ y la cifra pasó a ser la del EMBI Global Diversified, publicada una
  vez por día con el cierre anterior. Es un cambio de definición dentro de la
  misma serie; en los datos no se distingue un salto de nivel, porque el período
  fue muy volátil.
- **Ámbito** publica la serie que circula: un histórico de cierres
  (`/riesgopais/historico-general/{desde}/{hasta}`) y un valor del día
  (`/riesgopais/variacion`) que cambia durante la rueda. Un pedido trae toda la
  historia: 7.206 cierres desde el 1998-12-11, 176 kB, en puntos básicos con
  coma decimal y sin separador de miles. Viene de más nuevo a más viejo, con dos
  fechas repetidas (2022-09-29 idéntica; 2021-02-22 con 1.509 y 1.501) y cuatro
  filas en fin de semana.
- **ArgentinaDatos** es una copia de Ámbito, no otra fuente: en los 7.088 días
  comunes 6.101 coinciden y 987 (2003–2007) truncan los decimales; sus 658 días
  propios son fines de semana y feriados rellenados con el cierre anterior, los
  658; le faltan 118 días que Ámbito tiene.
- **Derechos.** Ámbito no publica condiciones: el pie dice «Términos y
  condiciones de uso» sin enlace y «Todos los derechos reservados». J.P. Morgan
  es dueño del índice y exige licencia para redistribuirlo. ArgentinaDatos
  permite consultar y guardar, pero aclara que no cambia la licencia de las
  series de terceros: los derechos sobre el dato son los mismos.

## Decisión 1 — la fuente es Ámbito, leída directo (decisión del owner)

Fuente `ambito-riesgo-pais`, dataset `ambito.riesgo-pais`, un solo endpoint: el
histórico de cierres. El valor del día **no se lee**: cambia durante la rueda y
una fila guardada como cierre no se corrige sola (el mismo criterio que
`settled-session-1.0.0`). ArgentinaDatos queda descartada por calidad, no por
derechos.

## Decisión 2 — derechos `owner_accepted`, sólo uso personal (decisión del owner)

Como la pizarra de Rosario (ADR 0071): acceso automatizado, valores normalizados
y derivados `owner_accepted`; payload, exhibición pública, export, IA y
asistente del owner (`ownerAssistant`) `restricted`. Se cita «J.P. Morgan (EMBI),
vía Ámbito». Fixtures sintéticas. Revisión de derechos a los tres meses.

## Decisión 3 — una serie, dos definiciones fechadas

Un indicador declarado, `ar_country_risk_embi`, diario, en puntos básicos
(`scale = unit`), en el registro de la ADR 0069: revisiones como cadenas,
retiros nombrados y la guarda de cambio masivo en cada corrida. El cambio de
índice no parte la serie: se declara (`country-risk-index-1.0.0`) como dos
tramos con su fecha —EMBI+ hasta el 2025-09-29, EMBI Global Diversified desde el
2025-09-30— y el gráfico lo marca como un régimen, sin atribuirle un salto.

## Decisión 4 — el parser cierra el formato (`ambito-riesgo-pais-1.0.0`)

- Encabezado exacto `["Fecha", "Puntos"]`, fechas `dd-mm-aaaa`, valores
  `^\d+,\d{2}$` mayores que cero; cualquier otra cosa rechaza la corrida por
  nombre.
- El valor se lee del texto, nunca por `number`.
- Una fecha repetida con el mismo valor se une; con dos valores se rechaza ese
  día por nombre (`conflicting_day`), como el cambiario del BCRA (ADR 0067), y el
  resto de la serie se registra.
- Las filas de fin de semana se guardan como se publican y se cuentan en la
  corrida; no se mueven a otro día.

## Decisión 5 — se actualiza al abrir `/argentina`

Un sujeto más en la actualización de la ADR 0070, como fuente propia (job,
lease, cuota y kill switch propios): vence una vez por día de Buenos Aires. Cada
corrida pide la historia completa —un pedido— y compara todo
(`argentina-indicator-full-history-1.0.0`). Cuota diaria declarada: 10 pedidos.

## Consecuencias

- `/argentina` suma un bloque de riesgo país con su fuente, la definición
  vigente, el cambio de índice marcado, su tabla equivalente y la lectura por
  punto de `F9-13`; describe y no explica causas.
- Una serie diaria no lleva marca de «Nuevo» (ADR 0079).
- Si J.P. Morgan vuelve a cambiar de índice, se declara otro tramo. Si Ámbito
  cambia el formato, la corrida se rechaza por nombre y la página sigue con lo
  guardado.
- Un spread propio calculado con bonos y Treasuries queda fuera: necesita
  precios de bonos con derechos y sus flujos declarados.

## Enmienda del 2026-11-27 — cotización del día en la tarjeta (`F9-26`)

El owner pidió ver el movimiento del día. El histórico de Ámbito devolvía
como último cierre el 26/11 y `/riesgopais/variacion` ya daba una cotización
del 27/11. El endpoint informa el día y el nivel. La hora que muestra el
portal es la de consulta en Buenos Aires.

La tarjeta pide la cotización al abrir o volver a la pestaña. Sólo usa un
valor positivo con fecha del día local y posterior al último cierre. Si hay
un cierre de la misma fecha, usa ese cierre. La diferencia en puntos básicos
se calcula contra el último cierre comparable con `summary-change-1.1.0`.
El gráfico, su tabla y las lecturas históricas siguen usando los cierres.

`ambito-riesgo-pais-cotizacion` tiene una declaración de derechos personales,
un GET fijo sin query ni redirecciones y una cuota de 24 pedidos por día UTC.
El kill switch de la fuente histórica también suspende esta consulta. La
acción exige el runtime personal, toma la fecha y el destino del servidor
y devuelve la cotización normalizada con un identificador de request. El
resultado vive hasta cinco minutos en memoria por proceso con una consulta
en vuelo. Una falla espera un minuto y el cambio de fecha local invalida la
caché. El payload y la cotización quedan fuera de PostgreSQL.
