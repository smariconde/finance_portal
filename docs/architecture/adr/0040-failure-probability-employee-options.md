# ADR 0040: probabilidad de fracaso y opciones de empleados en el puente

- Estado: aceptado (incrementos 1 a 3 en curso)
- Fecha: 2026-10-20
- Alcance: `F4-05`. Decide de dónde sale la probabilidad de fracaso y cuánto se
  recupera, cómo se valúan las opciones de empleados vivas, con qué
  volatilidad, de dónde salen sus insumos y qué denominador tiene el valor por
  acción.
- Decisiones relacionadas: [ADR 0028](0028-sortino-parameters-total-return.md)
  (ventana de calendario), [ADR 0032](0032-damodaran-reference-datasets.md)
  (datasets de Damodaran), [ADR 0034](0034-operations-weighted-country-risk.md)
  (la IA transcribe, el código calcula), [ADR 0038](0038-reported-adjusted-normalization.md)
  (capital invertido)

## Contexto

Hasta `F4-04` el valor operativo es el de una empresa en marcha y el valor
por acción divide el equity por las acciones diluidas promedio del filing.
Damodaran trata las dos cosas de otra forma: separa la posibilidad de fracaso
en vez de esconderla en la tasa, y valúa las opciones de empleados como una
claim sobre el equity, dividiendo por acciones en circulación. Las acciones
diluidas por treasury stock cuentan sólo las opciones en el dinero, al precio
promedio, y nada de su valor temporal.

Sondeado el 2026-10-20 con `companyconcept` sobre 14 filers (56 requests,
payload fuera del repositorio):

- **El plazo restante no existe en la API.**
  `...OptionsOutstandingWeightedAverageRemainingContractualTerm2` es de tipo
  duración y da `404` en los 14; Black-Scholes lo necesita.
- **Las opciones dejaron de etiquetarse en la tecnología grande**: Apple desde
  2015, NVIDIA 2018, Amazon 2017, Alphabet 2016. Están vigentes en Johnson &
  Johnson (93 M a 151,14), Salesforce, Caterpillar, Moderna, Incyte, Ford y
  American Tower; Exxon y Norwegian nunca las etiquetaron. Un concepto que deja
  de publicarse no prueba cero (`TM-05`).
- **Las RSU sin dimensiones casi no existen** (la última, de 2013 a 2019): los
  filers las publican con la dimensión de tipo de premio, que `companyfacts`
  no trae.

## Decisión 1 — la probabilidad de fracaso sale del rating sintético

`p` es la probabilidad de default acumulada del rating sintético que el costo
de capital ya deriva, leída de una tabla fechada por rating, como los demás
parámetros de Damodaran. El owner puede declarar otra por CIK con motivo.

Pendiente: la tabla está en la hoja «Failure Rate» de la planilla Ginzu de
Damodaran, y el 2026-10-20 su servidor cortó o dejó sin respuesta cada
descarga del `.xlsx` mientras servía las páginas HTML. La fuente, su formato y
sus términos se fijan cuando el archivo pueda leerse; hasta entonces el dominio
recibe la probabilidad como insumo y no hay corrida real con fracaso.

## Decisión 2 — el recupero es la mitad del capital en libros

`failure-adjustment-1.0.0`:

```text
valor_operativo = DCF × (1 − p) + recupero × p
recupero        = 0,5 × capital invertido en libros (normalización, ADR 0038)
```

Un capital en libros no positivo —más caja que deuda y patrimonio— recupera
cero y lo dice (`non_positive_book_capital`): la responsabilidad es limitada,
y un recupero negativo sería inventar una deuda.

## Decisión 3 — las opciones se valúan y se restan del equity

`option-value-dilution-1.0.0`: Black-Scholes con rendimiento de dividendos y el
precio ajustado por dilución de Damodaran, `S_adj = (S·n + W·m)/(n + m)`,
iterado hasta que el valor por opción deja de moverse (tolerancia 1e-24, 200
iteraciones como máximo). El valor total es una claim nueva del puente
(`employeeOptions`, se resta). Es antes de impuestos: el ahorro fiscal del
ejercicio no se resta, así que el ajuste nunca hace parecer la acción más
valiosa. La normal acumulada se calcula en decimal con la serie de términos
positivos de `erf`, sin `double`.

## Decisión 4 — volatilidad de la serie de precios

`equity-volatility-1.0.0`: desvío muestral de los retornos diarios logarítmicos
de **precio** —splits llevados a la base, dividendos no, porque Black-Scholes
los recibe como rendimiento— en la ventana de calendario de cinco años de la
ADR 0028, anualizado por √252. La ventana es la misma función que usa Sortino
(`selectCalendarWindow`), así que «cinco años» significa lo mismo en las dos.
Sin serie, la corrida nombra el faltante.

## Decisión 5 — la IA transcribe opciones y RSU del 10-K

Como el mix de operaciones (ADR 0034): se recorta la nota de compensación en
acciones del 10-K del ejercicio base, la IA copia cantidad de opciones vivas,
strike y plazo promedio ponderados y RSU no consolidadas, cada una con su cita
textual, y una policy rechaza un número que no esté en su cita, una cita que no
esté en la evidencia y una cantidad o strike que contradiga el XBRL cuando el
filer lo publica. El código valúa; la propuesta se guarda y se congela en el
snapshot, así que un replay no llama al modelo.

### Lo que la medición agregó a la transcripción

Medido el 2026-10-20 sobre diez 10-K reales —Johnson & Johnson, Salesforce,
Caterpillar, Moderna, Apple, Ford, Incyte, American Tower, ExxonMobil y
NVIDIA—, como eval en el libro de gasto y después con el comando sobre una
réplica:

- **Recorte** (`sec-10k-equity-compensation-1.0.0`): cada ancla —título de la
  nota o de una tabla de actividad, también «Incentive Program»— se puntúa por
  el vocabulario propio de premios y por filas de saldo («Balance as of»,
  «Shares at», «Outstanding, end of year», «Issued and outstanding at December
  31» sin año); el estado de patrimonio, que también tiene saldos, no puntúa.
  Los diez recortes contienen todas las cifras que la tarea copia.
- **Escala**: las cantidades se imprimen en unidades, miles o millones; la
  tarea copia la escala y el código la aplica. Contra el XBRL la tolerancia es
  medio dígito impreso: «6» millones (Salesforce) admite medio millón, «4.2»
  millones (Ford) cincuenta mil.
- **Plazo**: impreso en años, como año de vencimiento («will expire in 2030»,
  que se lleva al 31 de diciembre de ese año) o sólo por tramos de strike
  (Incyte): la tarea copia cada tramo con su cita, la policy exige que sumen el
  total y el código promedia ponderando por cantidad. La IA nunca promedia.
- **Strike desconocido** (Ford no lo imprime y su XBRL no lo publica al
  cierre): la opción se valúa con strike cero, su valor máximo
  (`strike_unknown_upper_bound`), que nunca hace parecer la acción más valiosa.
  Si el XBRL lo publica y la nota no, se rechaza (`strike_missing`).
- **Unidades combinadas**: Incyte informa RSU y PSU en un mismo saldo; la línea
  es `combined`, porque los modelos se negaban, con razón, a llamarla de una
  sola clase.
- **El cierre**: una cita vale si trae el año del ejercicio, o si nombra el
  cierre —su mes y día, o «end of year»— y ningún otro año. Así ExxonMobil
  pasa y «December 31, 2024» de un filer de año calendario no.
- **Las ausencias**: «sin opciones» se acepta sólo si la nota no tiene tabla de
  opciones y el XBRL del mismo 10-K no tiene el hecho (Apple, NVIDIA,
  ExxonMobil).
- **El XBRL del mismo 10-K**: la corroboración usa sólo los hechos de esa
  presentación al cierre, así que no hay otra disponibilidad que razonar.

Versiones medidas: tarea `employee-equity-1.2.0`, prompt `1.3.0`, policy
`1.1.0`. Resultado final: diez de diez aceptadas, siete en el primer escalón y
tres en el segundo, USD 0,029 en total; las cantidades y strikes coinciden con
el XBRL en los siete filers que lo publican. La transcripción aceptada se
guarda como `jsonb` validado por el schema de su tarea: el próximo cambio de
schema, con filas reales guardadas, necesita una lectura por `taskVersion`.

## Decisión 6 — el denominador es básicas + RSU, con RSU obligatoria

Acciones en circulación al cierre del ejercicio base más las RSU no
consolidadas de la transcripción. Sin RSU conocidas la corrida nombra el
faltante: no se asumen cero. Las opciones no se suman al denominador —ya
restan su valor del equity—; sumarlas las contaría dos veces.

## Incrementos

1. **Dominio** (hecho): `equity-volatility-1.0.0`, la normal acumulada,
   Black-Scholes, `option-value-dilution-1.0.0` y `failure-adjustment-1.0.0`,
   puros, con oráculos de doble precisión de Python y bordes.
2. **Transcripción** (hecho, salvo los evals del corpus congelado): recorte
   de la nota, tarea de IA con su policy, persistencia (migración `0030`, con
   rollback que se niega con propuestas guardadas) y
   `pnpm valuation:employee-equity`.
3. **Corrida**: tabla de default de Damodaran, insumos en
   `ValuationInput`, claim `employeeOptions`, denominador nuevo, checks que
   recalculan, motor y metodología nuevos.
