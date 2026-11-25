# ADR 0086: beta por mezcla de negocios

- Estado: aceptado
- Fecha: 2026-11-24
- Alcance: `F6-48`. Cambia cómo se construyen la beta desapalancada y la
  estructura objetivo del costo de capital (`cost-of-capital-1.2.0`) cuando la
  empresa tiene más de un negocio; sin mezcla, todo queda como en `1.1.0`.
- Decisiones relacionadas: [ADR 0032](0032-damodaran-reference-datasets.md)
  (las releases de Damodaran), [ADR 0033](0033-ai-layer-industry-resolution.md)
  (la industria por IA), [ADR 0034](0034-operations-weighted-country-risk.md)
  (el mix de operaciones, el mismo patrón), [ADR 0082](0082-captive-finance-split.md)
  (el instance XBRL del 10-K), [ADR 0052](0052-qualitative-decisions-in-valuation-job.md)
  (el paso cualitativo del job)

## Contexto

`F6-47` midió el sesgo precio/valor de las 11 corridas `fcff_base` de
Production con el DCF inverso: el ROIC terminal no lo explica, la tasa que
exige el precio está 1,5 pp debajo de la de la corrida en la mediana, y las
cuatro brechas más grandes son las industrias de β alto (GLW, GOOGL, AAPL,
LRCX). Una sola beta de industria para Alphabet o Apple da un WACC de 10,8–12 %.
Damodaran valúa una empresa de varios negocios con la beta **ponderada por el
valor estimado de cada negocio**: las ventas del segmento por el EV/Sales de su
industria.

Antes de decidir se midió el instance XBRL del último 10-K de las 11 (dos
pedidos SEC cada una) y se recalculó el WACC con los parámetros de cada corrida
(ERP, CRP por operaciones, costo de deuda, tasa 25 %), mapeando cada línea a
mano de dos o tres maneras razonables:

| Ticker | WACC hoy | Pesos por ventas | Pesos por valor | Qué decide el número                                 |
| ------ | -------: | ---------------: | --------------: | ---------------------------------------------------- |
| GLW    |   9,52 % |      8,14–8,40 % |     7,92–8,73 % | seis negocios reales                                 |
| GOOGL  |  12,01 % |     8,96–11,78 % |    9,51–11,74 % | Google Services: `advertising` o `software-internet` |
| AAPL   |  10,78 % |     9,16–10,68 % |    9,56–10,64 % | el iPhone: electrónica de consumo o computadoras     |
| AMZN   |   7,49 % |      7,66–7,94 % |     7,64–8,70 % | AWS y publicidad pesan más que el retail (sube)      |
| LRCX   |  10,05 % |       sin cambio |      sin cambio | un solo segmento                                     |

WMT, COST, SBUX, KO, MCD y ADBE no cambian: sus segmentos son geográficos o de
una sola industria. Tres hallazgos:

- La mezcla cierra una o dos de las cuatro brechas grandes, no las cuatro.
- **El número lo decide el mapeo** segmento → industria, no el dato.
- El eje de segmentos no alcanza solo: Apple segmenta por geografía (lo de
  industria está en `ProductOrServiceAxis`) y Corning etiqueta sus segmentos en
  `ProductOrServiceAxis`. Elegir qué eje describe el negocio es criterio.

El owner eligió, con la tabla a la vista, que la IA mapee y el owner decida, y
pesos por valor estimado.

## Decisión

1. **Las líneas salen del XBRL, nunca del modelo.** `sec-xbrl-business-lines-1.0.0`
   lee del instance del 10-K cuyo cierre es el ejercicio base los ingresos del
   ejercicio completo (350–380 días) con **un** miembro explícito en
   `StatementBusinessSegmentsAxis` o `ProductOrServiceAxis` —acompañado, como
   mucho, de `ConsolidationItemsAxis = OperatingSegmentsMember`—, del primer
   concepto de ingresos que publique dos o más líneas en ese eje
   (`RevenueFromContractWithCustomerExcludingAssessedTax`, `Revenues`,
   `RevenueFromContractWithCustomerIncludingAssessedTax`, `SalesRevenueNet`).
   Un miembro con dos valores se descarta. Sin un eje con dos líneas positivas
   no se le pregunta a nadie (`no_business_lines`).
2. **La IA elige y mapea, nunca pondera** (`business-mix-1.0.0`). Ve el nombre
   de la empresa, el Item 1 del 10-K (`sec-10k-sections-1.0.0`), las líneas con
   su eje, miembro y monto, y las claves de industria de la release de betas
   visible al corte. Ningún valor de Damodaran viaja: su `aiTransfer` es
   `restricted`. Devuelve un eje, las líneas que lo parten sin solaparse y una
   industria por línea con una cita literal del Item 1, o se abstiene.
3. **La policy** (`business-mix-policy-1.0.0`) rechaza una línea que no se
   ofreció, líneas de dos ejes o repetidas, una que no es positiva, líneas que
   no suman los ingresos del ejercicio (2 %: atrapa un agregado solapado o un
   negocio olvidado), una clave fuera de la release, una cita que no está en la
   evidencia, y toma `low` como abstención.
4. **Una sola industria no es mezcla.** Una respuesta aceptada que mapea todo a
   una industria se guarda (no se vuelve a preguntar por el mismo 10-K) pero no
   entra a la corrida: la beta sigue siendo la de la industria de la empresa.
5. **Pesos por valor estimado** (`business-mix-weights-1.0.0`): el valor de cada
   industria es la suma de sus ventas por el EV/Sales de la industria
   (`damodaran.ev-sales-us`, la página `psdata.html`, misma lectura que betas y
   márgenes); el peso es su parte del total. La beta desapalancada corregida por
   caja y la D/E objetivo son las de cada industria ponderadas por esos pesos, y
   Hamada reapalanca como siempre. Una industria sin beta o sin EV/Sales positivo
   deja el WACC `unsupported` con su nombre, como una fila faltante del CRP.
6. **El owner manda.** Una declaración por CIK en `declared-business-mixes.ts`
   —industrias con su peso como fracción exacta que suma 1 y un motivo escrito—
   es el lock: con ella no se le pregunta al modelo ni se lee una propuesta.
7. **El snapshot lleva la decisión.** `qualitativeDecisions.businessMix`
   (`qualitative-decisions-1.2.0`, opcional) congela la declaración o la
   propuesta aceptada con cada línea —eje, miembro, concepto, monto, industria y
   cita— y la evidencia por hash. `costOfCapital.businessExposure` (opcional)
   lleva por industria la beta, la D/E, el EV/Sales con su fila y su peso, más
   la beta y la D/E combinadas. Los nueve parámetros no cambian: la beta y la
   D/E de la industria propia quedan como referencia y se declaran
   `beta_by_business_mix` y `target_structure_business_mix` en lugar de
   `industry_beta_us` y `target_structure_industry_average`.
   `wacc_built_from_components` recalcula con la mezcla, y
   `qualitative_decisions_drive_cost_of_capital` recalcula los pesos desde la
   decisión.
8. **Sólo la beta y la estructura.** Márgenes, ROC terminal, vida del I+D y
   ventas sobre capital siguen leyendo la industria de la empresa.
9. **En el job**, después del mix de operaciones (`valuation-qualitative-1.1.0`),
   sólo para métodos con WACC: comparte el `submissions` y el 10-K del paso y
   suma un pedido SEC (el instance). Una respuesta aceptada pide un corte nuevo.

## Consecuencias

- GLW y quizás GOOGL bajan su WACC; AMZN lo sube; LRCX no cambia. El sesgo
  precio/valor se mueve sólo donde hay más de un negocio: no se persigue el
  precio.
- El mapeo es criterio. La cita del Item 1 lo hace auditable y el owner lo
  corrige con una declaración; evals de esta tarea quedan para después.
- Las corridas anteriores conservan su hash y se reproducen igual: todos los
  campos nuevos son opcionales y `1.1.0` se sigue leyendo.
- Un dataset nuevo de Damodaran que hay que cargar también en Neon.
