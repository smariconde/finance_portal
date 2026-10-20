# ADR 0040: probabilidad de fracaso y opciones de empleados en el puente

- Estado: aceptado (implementado; gate de `F4-05` pendiente de confirmar el gold de opciones)
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

La descarga de la planilla Ginzu falló en el primer incremento y pudo leerse
el 2026-10-20 en esta continuación. La hoja real se llama
`Failure Rate worksheet`; contiene probabilidades acumuladas de 1 a 10 años
por siete grupos. `damodaran.failure-rates` guarda todas las columnas y la
corrida toma diez años, el horizonte que la propia hoja ilustra, con la
observación como disponibilidad. Los modificadores de rating se llevan al
grupo amplio, sin interpolar; CCC, CC y C comparten CCC/C. No hay una fila D:
un rating **sintético** D no prueba default efectivo, así que queda sin
probabilidad y exige declaración del owner si quiere valuar ese caso.

## Decisión 2 — el recupero es la mitad del capital en libros

`failure-adjustment-1.0.0`:

```text
valor_operativo = DCF × (1 − p) + recupero × p
recupero        = 0,5 × capital invertido reportado en libros (normalización, ADR 0038)
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
2. **Transcripción** (hecho; evals medidos con gold pendiente de confirmación): recorte
   de la nota, tarea de IA con su policy, persistencia (migración `0030`, con
   rollback que se niega con propuestas guardadas) y
   `pnpm valuation:employee-equity`.
3. **Corrida** (hecho):
   `ValuationInput.employeeEquity` (`employee-equity-claim-1.0.0`) congela la
   transcripción aceptada con sus versiones y el hash de la nota, las acciones
   en circulación y el mercado al `as_of`; deriva el valor de las opciones y el
   denominador, y `employee_equity_recomputed` los recalcula con la libre de
   riesgo de la corrida y exige la claim `employeeOptions` del puente igual a
   ese valor. `fcff-1.5.0`, metodología `0.11.0`. La probabilidad de fracaso
   se integró después al leerse la tabla, como se documenta en el último
   incremento de esta ADR.

## Decisión 7 — las acciones salen de la carátula

Medido el 2026-10-20: `us-gaap:CommonStockSharesOutstanding`, que la serie
anual lee al cierre, falta en seis de siete filers con opciones o está viejo,
y donde está puede ser otra cosa —Salesforce publica 929 millones contra 823
de su carátula—. El denominador usa el conteo de la carátula del 10-K o 10-Q
(`dei:EntityCommonStockSharesOutstanding`, sin dimensiones) más reciente que
la fecha de valuación y el corte admiten (`shares-outstanding-cover-1.0.0`):
es el conteo actual que Damodaran usa. Un filer con varias clases (Ford) sólo
la publica con dimensiones, que `companyfacts` no trae: queda sin conteo y la
corrida lo nombra, nunca suma una clase sola.

Las unidades son las del cierre del ejercicio y las acciones las de la última
carátula: dos fechas distintas, como en la planilla de Damodaran, que toma las
acciones actuales y las opciones del último 10-K.

## Medición de la corrida (2026-10-20)

Con las transcripciones aceptadas, las acciones de la carátula, la cotización
guardada al último cierre (19 de octubre de 2026) y la libre de riesgo en
dólares de 3,96 %:

| Empresa | Opciones | Strike | Plazo | Volatilidad | Valor de las opciones | Unidades |
| ------- | -------: | -----: | ----: | ----------: | --------------------: | -------: |
| JNJ     |  93,07 M | 151,14 | 5,5 a |      17,9 % |      9.501 M (1,55 %) |  +0,59 % |
| CRM     |   6,00 M | 207,54 | 2,8 a |      39,4 % |        500 M (0,25 %) |  +3,16 % |
| CAT     |   3,02 M | 220,52 | 5,8 a |      31,8 % |      1.563 M (0,47 %) |  +0,27 % |
| MRNA    |  27,18 M |  38,63 | 4,8 a |      81,8 % |      5.478 M (6,05 %) |  +2,81 % |
| INCY    |  10,86 M |  83,46 | 5,0 a |      30,0 % |        535 M (2,37 %) |  +4,64 % |
| AMT     |   0,13 M |  94,82 | 0,2 a |      27,3 % |         12 M (0,01 %) |  +0,35 % |

El porcentaje del valor de las opciones es sobre la capitalización y el de las
unidades sobre las acciones en circulación. FixtureCo pasa de 13,55 a 13,39
USD por acción: resta 2,0 M de opciones sintéticas sobre 12,5 M de acciones.

## Infraestructura de evals (2026-10-20)

`employee-equity-eval-cases-1.0.0` prepara casos base, inyección y abstención
sobre una nota y gold explícitos. El ejecutor por escalón y el rejuicio admiten
la tarea; `ai-eval-scoring-1.1.0` compara la lectura financiera normalizada,
conserva el estado de revisión del gold y mide las aceptaciones sin evidencia.
Los tests usan una nota sintética: no reemplazan el corpus congelado ni miden
al modelo. Captura real, gold confirmado y medición siguen pendientes del
incremento 2; la tabla de fracaso sigue pendiente del incremento 3.

## Corpus y medición de evals (2026-10-20)

El corpus `ai-eval-corpus-1.1.0` congela las diez notas elegidas y veinte
corroboraciones XBRL del mismo filing y cierre fiscal, con la procedencia de
cada descarga. Una ausencia o un conjunto de valores contradictorios no se
convierte en cero. `ai-eval-cases-1.2.0` agrega diez bases, nueve inyecciones
sobre JNJ, Ford e Incyte y tres abstenciones con sus tablas geográficas como
evidencia sin nota de compensación. Los extractos anteriores siguen idénticos.

El gold fue escrito leyendo las notas congeladas, con cantidades y citas
explícitas, en `declared-employee-equity-gold.ts`. Sigue `pending_owner`
hasta confirmación (ADR 0035, decisión 3). En Ford el strike es desconocido;
en XOM el saldo total publicado incluye unidades liquidadas en efectivo sin
cantidad separada: se conserva esa limitación de la transcripción.

Medición provisional: 34 intentos por USD 0,080276. La escalera vigente acepta
diez de diez bases y nueve de nueve inyecciones con la lectura del gold; los
tres casos sin nota, medidos en los cuatro escalones, nunca fueron aceptados.
El escalón 4 emitió una respuesta inválida por schema para JNJ y se abstuvo
en las otras dos; no equivale a tres abstenciones válidas. No se modificó
prompt, policy ni escalera. Confirmar el gold sigue siendo requisito para
cerrar la corrección; la integración de fracaso sigue pendiente.

## Incorporación de la fuente de fracaso (2026-10-20)

El alcance autorizado de `F4-05` incorpora la ruta exacta
`https://pages.stern.nyu.edu/~adamodar/pc/fcffsimpleginzu.xlsx` a la fuente
`damodaran-current-data`, sin comodines. Se revalidaron la [guía de uso](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/guide.html)
y el [índice de planillas](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/spreadsh.htm):
permiten usar y adaptar las planillas para trabajo o investigación, con
atribución y sin reventa. Se conservan los controles y derechos de la fuente
(ADR 0032): automatización `owner_accepted`, normalización personal y descarte
del libro; ninguna planilla ni tabla real se commitea. La primera lectura se
hace por la puerta con presupuesto y kill switch, en memoria, para verificar
hoja, encabezados y horizontes antes de publicar una release.

## Fracaso integrado a la corrida (2026-10-20)

`failure-risk-1.0.0` congela el rating y el parámetro de diez años, con su
release, fila, campo y ambos relojes, o una declaración del owner por CIK
con motivo y fecha real. Una declaración ajena o futura no se aplica; dos
contradictorias al mismo instante no se desempatan. Sin tabla, rating mapeado
o capital resuelto, la corrida se rechaza nombrando lo que falta.

El recupero usa `normalization.investedCapital.reported`, **antes** de los
ajustes de capitalización; `failure_risk_recomputed` controla la selección
contra el rating y corte de la corrida. `fcff-1.6.0` aplica la mezcla sobre
el DCF completo antes del puente a equity, y publica `failureAdjustment`.
Los escenarios y la sensibilidad pasan por el mismo motor. El porcentaje de
terminal se sigue midiendo sobre el DCF condicional a supervivencia.
Metodología `0.12.0`, sin migración ni reescritura de corridas.

Se publicó una release personal de siete filas con diez horizontes, sin
rechazos, desde el libro de 287.995 bytes. Los tests usan un workbook
sintético, no las probabilidades reales. Las lecturas offline de AAPL, JNJ,
XOM, CCL y NCLH resuelven grupo y parámetro; Ford nombra que el rating D no
está en la tabla y Moderna que no hay rating construido. La falta de capital
en libros de NCLH queda separada de su probabilidad disponible.

El tope de proceso de Damodaran pasa de cuatro a cinco archivos para incorporar
esta única URL; el tope diario sigue en 20 y el preflight cuenta URLs únicas.
La confirmación del gold de opciones sigue pendiente para cerrar `F4-05`.
