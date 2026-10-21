# ADR 0049: supuestos derivados `2.0.0` — ROIC terminal acotado, tendencia y escenarios medidos

- Estado: aceptado
- Fecha: 2026-10-21
- Alcance: `F6-10`. Reemplaza la regla de la
  [ADR 0046](0046-derived-valuation-assumptions.md) para las corridas nuevas;
  las `1.0.0` se siguen leyendo y reproduciendo igual.
- Decisiones relacionadas: [ADR 0032](0032-damodaran-reference-datasets.md)
  (releases de Damodaran), [ADR 0039](0039-coherent-valuation-scenarios.md)
  (escenarios), [ADR 0048](0048-market-price-implied-expectations.md) (lo que
  exige el precio)

## Contexto

El DCF inverso de `F6-09` mostró dónde estaba lo más frágil de
`derived-assumptions-1.0.0` sobre AAPL. La regla supone ROIC terminal igual
al WACC: la empresa no tiene ninguna ventaja después del año 10. Con un ROIC
ajustado de 82 %, eso hace que reinvierta casi la mitad de su NOPAT para
siempre. Además, el crecimiento inicial era el CAGR entre las puntas de la
ventana, que salía de 8,68 % porque empezaba en el piso de 2020; con tres años
habría sido 1,81 %. Y la corrida no tenía escenarios, así que el número era un
punto sin rango.

## Decisión 1 — ROIC terminal por regla, `terminal-return-on-capital-1.0.0`

`min(ROC de la industria, ROIC ajustado propio)`, con piso en el WACC
terminal. Una empresa no se supone mejor que su industria a perpetuidad ni
mejor que sí misma hoy; y crecer con retorno menor al costo del capital
destruiría valor a propósito, cosa que una regla por defecto no debe hacer.
Sin la referencia de la industria, o sin ROIC propio, cae al piso y lo
nombra (`no_industry_reference`, `no_company_return`).

La referencia es la columna ROC de la página EVA de Damodaran
(`damodaran.eva-us`, después de impuestos, la misma industria del beta). Se
registra como cualquier release (ADR 0032), y el snapshot congela la fila
—release, valor, fecha publicada, disponibilidad— igual que un parámetro del
costo de capital. Una fila de otra industria rechaza la corrida.

## Decisión 2 — crecimiento por tendencia log-lineal

Mínimos cuadrados sobre `ln(ventas)` de la racha de ejercicios consecutivos:
usa todos los años, así que un año atípico en una punta pesa menos. Exige que
todos sean positivos. La forma no cambia: cinco años sostenidos y convergencia
lineal a la libre de riesgo.

## Decisión 3 — bear y bull medidos, nunca inventados

`scenario-set-1.0.0` con dos drivers que la historia acota:

- **crecimiento**: el más bajo (bear) y el más alto (bull) entre la tendencia,
  el CAGR de la ventana completa y el de los últimos tres años;
- **ROIC terminal**: el WACC terminal (bear, sin ventaja) y el ROIC propio
  (bull, ventaja intacta).

Un driver que no cambiaría nada no se declara. Si un lado queda sin drivers,
no hay escenarios. Cada escenario materializado pasa por los mismos checks
que la base, excepto la reconstrucción de la derivación. Esa la verifica la
base sobre el conjunto entero: ahora `assumptions_derived_recomputed` también
compara los escenarios.

## Decisión 4 — el parser HTML pasa a `damodaran-html-1.1.0`

La página EVA trae `#VALUE!` en tres filas, en columnas que no son el ROC.
Rechazar la fila perdía el ROC de Tobacco y de Retail (Building Supply). Un
error de Excel es `null` como `NA`: la fuente no calculó ese valor. Se agregó
también el tipo de celda `verified`: el encabezado se exige en su lugar, pero
la celda no se lee ni se guarda. Sirve para las columnas en dólares, que
pueden traer `############`. Esa marca no es un error sino una columna angosta
que oculta un número, y se sigue rechazando.

## Consecuencias

- Medido en la base personal, 2026-10-21. AAPL pasa de 143,82 a 180,69 USD
  (bear 102,19, bull 207,73): ROIC terminal 44,76 % de la industria contra
  82,28 % propio, crecimiento 6,65 %. AMZN queda en 143,40 USD (bear 108,25,
  bull 151,56): ROIC terminal 13,59 %, crecimiento 12,51 %. Ninguno con checks
  fallados. Las cinco corridas `1.0.0` guardadas se reproducen.
- El precio de AAPL (333,02 USD) sigue 1,84 veces arriba del valor. El DCF
  inverso dice ahora que exige 17,98 % de crecimiento cinco años o 62,60 % de
  margen. La regla deja de castigar por un supuesto mecánico, y lo que queda
  es una diferencia de expectativas que tiene que juzgarse con evidencia
  (`F6-11`).
- Se registraron 96 filas de `damodaran.eva-us`, sin rechazos; un request.

## Límites que quedan nombrados

- **Año base anual.** La corrida descuenta desde el cierre del último 10-K;
  con un `as_of` casi un año después, el valor queda un año atrás. El TTM desde
  10-Q cambia toda la normalización y es un issue propio.
- **Una sola industria.** El beta y el ROC son de la industria del SIC; una
  empresa con segmentos de distinto riesgo (hardware y servicios) no se
  descompone.
- **Margen fijo.** El margen y el sales-to-capital del año base no convergen a
  la industria. Para empresas con márgenes muy por encima de su industria,
  converger destruiría la ventaja que el ROIC terminal ya acota; se dejó fuera
  a propósito.

## Alternativas descartadas

**ROIC terminal igual al propio.** Supone una ventaja eterna intacta; queda
como bull.

**Promedio de industria y empresa.** No tiene una lectura económica que lo
justifique; el mínimo sí: ninguna de las dos referencias se supera.

**Escenarios por multiplicador.** Prohibidos por la ADR 0039.
