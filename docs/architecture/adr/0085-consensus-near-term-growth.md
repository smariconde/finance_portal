# ADR 0085: supuestos derivados `3.0.0` — crecimiento cercano desde el consenso de analistas

- Estado: aceptado
- Fecha: 2026-11-19
- Alcance: `F6-39`. Reemplaza la regla de la
  [ADR 0049](0049-derived-assumptions-v2.md) para las corridas `fcff_base`
  nuevas; las `1.0.0` y `2.0.0` se siguen leyendo y reproduciendo igual.
- Decisiones relacionadas: [ADR 0083](0083-consensus-estimates-forward-pe.md)
  (el consenso y su fecha), [ADR 0081](0081-ttm-base-period.md) (año base
  TTM), [ADR 0039](0039-coherent-valuation-scenarios.md) (escenarios),
  [ADR 0048](0048-market-price-implied-expectations.md) (lo que exige el
  precio)

## Contexto

`derived-assumptions-2.0.0` toma el crecimiento de ventas de los años 1–5 de
la tendencia log-lineal de cinco a seis ejercicios. La historia no ve lo que
la empresa anunció ni el ciclo en el que está: LRCX venía de 7 % de tendencia
con un TTM que ya crecía 40 %, y KO de 7,5 % mientras vende sus
embotelladoras. Desde `F6-29` el portal guarda el consenso de Alpha Vantage
por ejercicio fiscal, con promedio, mínimo y máximo de ventas y su cadena de
revisiones.

Antes de decidir se midió sobre las 11 corridas `fcff_base` de Production del
2026-11-18, con el consenso capturado el 2026-11-19, recalculando con el motor
puro (el valor `2.0.0` recalculado coincidió al centavo con el registrado):

| Ticker | Tendencia | Consenso año 1 / 2 | P/V `2.0.0` | P/V `3.0.0` |
| ------ | --------: | -----------------: | ----------: | ----------: |
| GOOGL  |    15,2 % |    26,5 % / 27,7 % |        1,45 |        1,26 |
| LRCX   |     7,0 % |    41,7 % / 20,4 % |        1,42 |        0,99 |
| GLW    |     3,7 % |    26,7 % / 21,2 % |        4,11 |        3,63 |
| AMZN   |    12,5 % |    14,9 % / 15,7 % |        1,92 |        1,86 |
| AAPL   |     6,6 % |      9,7 % / 9,3 % |        2,00 |        1,91 |
| WMT    |     5,3 % |      4,4 % / 4,3 % |        2,31 |        2,34 |
| COST   |     8,4 % |      8,7 % / 7,4 % |        2,12 |        2,13 |
| ADBE   |    12,4 % |      9,3 % / 9,2 % |        0,47 |        0,49 |
| MCD    |     6,2 % |      3,7 % / 0,9 % |        0,95 |        1,03 |
| KO     |     7,5 % |    −3,5 % / −3,1 % |        1,63 |        1,95 |
| SBUX   |     9,1 % |     −1,6 % / 3,0 % |        2,28 |        2,75 |

P/V es el cierre del `as_of` sobre el valor por acción. La mediana pasa de
1,92 a 1,91: **el consenso no explica el sesgo de precio contra valor**, que
el backlog atribuía al crecimiento histórico. Mejora donde la historia
engaña (un ciclo, una aceleración) y empeora donde el mercado paga algo que
no es el crecimiento cercano. El owner eligió usarlo igual, porque es mejor
información sobre los dos años que los analistas cubren, y dejar el sesgo
como una medición aparte. AAPL y SBUX miden con un 10-K anterior al último
presentado; ver Consecuencias.

Se midieron tres formas después del año 2: hacer converger el crecimiento del
año 2 a la libre de riesgo hasta el año 10 (mediana 1,87), sostenerlo hasta el
año 5 (1,74) y volver a la tendencia (1,91). Y dos formas de leer el
consenso con un año base TTM: aplicar la tasa FY0→FY1 a las ventas TTM
cuenta dos veces lo que el TTM ya creció (LRCX daría 52 % en lugar de 41,7 %,
KO +5 % en lugar de −3,5 %, porque su TTM ya supera el consenso de su
ejercicio en curso).

## Decisión 1 — los años 1 y 2 desde el nivel de ventas del consenso

`consensus-revenue-path-1.0.0`. El consenso es un nivel de ventas por
ejercicio, no una tasa. Se arma un camino de niveles con tres puntos: las
ventas del último ejercicio de la historia (FY0) y el promedio del consenso
de FY1 y FY2, fechados en el calendario fiscal **de la empresa** —FY0 más uno
y más dos años—, no en el fin de mes con que la fuente los etiqueta. Entre
dos puntos el nivel se interpola geométricamente por días; después de FY2
sigue a la tasa FY1→FY2.

El crecimiento del año 1 es el nivel del camino al cierre del período 1 sobre
las ventas del año base, y el del año 2 el nivel al cierre del período 2 sobre
el del período 1. Con un año base anual eso es exactamente FY1/FY0 − 1 y
FY2/FY1 − 1. Con un año base TTM, las ventas TTM reales son el punto de
partida y el camino dice cuánto falta hasta el cierre de cada período.

## Decisión 2 — después del año 2, la regla `2.0.0`

Los años 3 a 5 vuelven a la tendencia log-lineal de la historia y los años 6
a 10 convergen a la libre de riesgo como en `2.0.0`. Los analistas publican
dos ejercicios, y la regla no los extiende más allá de lo que publican. Margen,
reinversión, impuestos, WACC, terminal y sensibilidad no cambian.

## Decisión 3 — bear y bull con el rango de los analistas

En los años 1 y 2, bear recorre el camino del mínimo del consenso y bull el
del máximo; desde el año 3 los dos siguen la base. El ROIC terminal de cada
escenario es el de `2.0.0` (WACC terminal en bear, el propio en bull). Como
la base de datos exige mínimo ≤ promedio ≤ máximo, el orden de los escenarios
se sostiene en los años del consenso.

## Decisión 4 — cuándo se usa, y cuándo la historia es el respaldo

El consenso usado es el vigente al corte de conocimiento de la corrida
(`consensusAt`), fechado por la **última captura** visible al corte, como el
forward P/E. Se usa sólo si se cumple todo lo siguiente; si no, la corrida es
`2.0.0` en todo menos la versión y nombra el motivo:

- hay una captura visible al corte (`no_consensus`);
- la captura y el `as_of` están a no más de 7 días (`stale_consensus`, el
  mismo umbral que `forward-pe-1.0.0`);
- hay al menos dos ejercicios del consenso que cierran después de FY0
  (`insufficient_horizons`);
- FY1 es el primer ejercicio del consenso que cierra después de FY0, y está a
  350–380 días de FY0, y FY2 a 350–380 días de FY1 (`fiscal_year_gap`): si la
  historia guardada se quedó un ejercicio atrás, el consenso habla de otro
  año;
- el año base termina antes que FY1 (`fiscal_year_gap`);
- FY1 y FY2 tienen promedio, mínimo y máximo de ventas (`revenue_incomplete`),
  y todos son positivos (`non_positive_revenue`);
- la corrida está en dólares (`currency_mismatch`): la fuente publica en
  dólares.

`3.0.0` sólo se usa en `fcff_base`. Las cíclicas reemplazan el crecimiento
por la regla de ciclo, y el camino de crecimiento tiene su propia trayectoria;
las dos siguen en `2.0.0`, byte a byte.

## Decisión 5 — el snapshot congela lo usado

`derivedAssumptions.consensus` congela la decisión: `used` con la regla, la
fuente, el dataset, el instante de la captura y los dos ejercicios (cierre de
la fuente, promedio, mínimo, máximo, analistas y disponibilidad de la
revisión), o `not_used` con el motivo. `assumptions_derived_recomputed`
reconstruye el camino desde ahí y además vuelve a comprobar la decisión:
captura no posterior al corte, a 7 días del `as_of`, alineación con la
historia, revisiones no posteriores a la captura, moneda. El replay no lee
la tabla del consenso.

Motor y metodología no cambian de versión: la variante `3.0.0` es un caso
nuevo de la unión de `derivedAssumptions`, y las corridas anteriores
conservan sus hashes.

## Decisión 6 — el job pide el consenso antes de valuar, sin bloquear

El job de valuación pide el consenso que falta con la misma regla que la
página (`consensus-freshness-1.0.0`, una captura por día de Nueva York) y lo
espera en línea, como los precios de los CEDEAR. Si la fuente no está, se
agotó la cuota o la clave falta, la corrida usa la historia y lo nombra: el
consenso nunca frena una valuación.

## Consecuencias

- El DCF inverso (`market-implied`) resolvía el crecimiento sólo sobre una
  corrida con los cinco primeros años iguales. Desde `market-implied-1.1.0`
  acepta también la forma `3.0.0`: el crecimiento implícito reemplaza los
  años 1 a 5 por una tasa constante, y desde el año 6 sigue la convergencia
  de la corrida. Sobre una corrida `2.0.0` el resultado es el mismo.
- El sesgo de precio contra valor (mediana ≈ 1,9) queda sin explicar y pide
  su propia medición: margen sostenido, reinversión, WACC o terminal.
- AAPL y SBUX muestran que una valuación nueva no ve un 10-K presentado
  después de la última descarga: el job sólo baja fundamentals cuando falta
  toda la serie anual. Con `3.0.0` el consenso de esas corridas queda
  `fiscal_year_gap` hasta que se baje el 10-K nuevo, que es un issue propio.
- Cada valuación nueva puede gastar un pedido de Alpha Vantage por día
  (25 por día, la clave gratis del owner). Abrir la página ya lo gastaba.
