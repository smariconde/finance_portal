# ADR 0055: opciones de empleados robustas

- Estado: aceptado
- Fecha: 2026-10-22
- Alcance: `F6-16`. La transcripción de opciones encuentra la nota que salteaba,
  lee dos escalas y la etiqueta de un ejercicio de 52/53 semanas; sin
  transcripción aceptada, la corrida usa el XBRL de la misma presentación y,
  sin él, no resta opciones y lo dice.
- Decisiones relacionadas: [ADR 0040](0040-failure-probability-employee-options.md)
  (opciones como claim), [ADR 0052](0052-qualitative-decisions-in-valuation-job.md)
  (la IA en la corrida), [ADR 0053](0053-reported-concept-coverage.md) y
  [ADR 0054](0054-zero-debt-evidence-derived-ebit.md) (selección de conceptos)

## Contexto

Después de `F6-15`, nueve empresas frenaban en `employee_equity_not_proposed`:
KO, HD, COST, WM y Cencora (criterio de este issue), más ALGN, DECK, EXPD y MRK.
Medimos cada caso sobre su 10-K antes de cambiar nada:

| Empresa               | Qué pasaba                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| ALGN, DECK, MRK, COST | `equity_note_not_found`: filas de saldo que el extractor no reconocía, y Costco anclaba en el estado de patrimonio |
| KO                    | dos escalas en la nota —opciones en millones, unidades en miles— y una sola en la salida                           |
| HD                    | el ejercicio que cierra el 2026-02-01 se rotula «Fiscal 2025»                                                      |
| WM, EXPD, Cencora     | la tabla está en la evidencia; los escalones se abstienen o la policy rechaza                                      |

Y companyfacts publica, al cierre del ejercicio, la cantidad de opciones vivas y
su strike promedio (KO: 27 M a 55,74 USD), pero **no el plazo remanente**: desde
~2012 es un período XBRL («P5Y3M») y companyfacts sólo publica números.

## Decisión 1 — `sec-10k-equity-compensation-1.2.0`

La fila de saldo también es «Outstanding December 31, 2025» sin preposición
(Merck), «Nonvested, March 31, 2026» (Deckers), «Unvested as of …» (Align) y
«Outstanding at the end of 2026» (Costco). Sin preposición, la fecha tiene que
empezar con un nombre de mes, o «Shares Exercised 12» contaría como saldo.

El estado de patrimonio deja de ganar: un cuerpo con resultado neto y, cerca,
dividendos declarados o recompras puntúa cero, y el «BALANCE» en versalitas ya
no cuenta como fila de saldo. Medido sobre los nueve 10-K: los nueve recortan la
nota con su fila de cierre.

## Decisión 2 — `employee-equity-1.3.0`, prompt `1.4.0`, policy `1.2.0`

- `unitsScale`: las unidades llevan su propia escala, y `scale` puede quedar
  vacía sin opciones vivas. Una transcripción anterior no la tiene y su lectura
  queda igual. La primera versión de esta decisión exigía `scale` siempre: los
  modelos la dejaban vacía, con razón, en las notas sin opciones (Costco,
  Deckers, Align), y los cuatro escalones daban `schema_invalid`. Lo encontró la
  réplica y se corrigió antes de cerrar.
- La policy acepta «fiscal <año − 1>» como el ejercicio que cierra en enero o
  febrero. «fiscal <año − 2>» sigue siendo otro año.
- La policy corrobora las unidades contra el XBRL del mismo 10-K por **orden de
  magnitud** (`units_scale_contradicts_xbrl`, factor 10). Costco imprime
  «1,877,000 time-based RSUs» en una frase y «(in 000's)» en la tabla, y un
  modelo multiplicó las dos: 2.000 millones de unidades, 4,5 veces las acciones
  en circulación, y un valor por acción de 96,53 USD en lugar de 529,79 USD. No
  se exige igualdad porque muchos filers etiquetan sólo las RSU y la nota suma
  también las PSU; un error de escala siempre es un factor de mil.

## Decisión 3 — sin transcripción, el XBRL de la misma presentación

`sec-core-concepts-8.0.0` suma tres conceptos al cierre: las opciones vivas, su
strike promedio ponderado y las unidades no consolidadas.
`employee-options-xbrl-1.0.0` toma la última presentación conocida al corte que
publica la cantidad al cierre del ejercicio base, con el strike **de esa misma
presentación**. Una cantidad positiva sin strike, o dos valores de un concepto
en la misma presentación, no son respaldo.

Sin plazo publicado, las opciones se valúan a **diez años**, el plazo
contractual de una opción de empleado y su cota superior. Es el mismo lado
conservador que un strike desconocido valuado en cero (ADR 0040): resta lo más
posible. Decisión del owner del 2026-10-22. Sin unidades publicadas, el
denominador no las suma y la lectura lo nombra (`not_reported`).

## Decisión 4 — sin nada, no restar y decirlo

Ni transcripción ni XBRL: la decisión es `not_subtracted`, la claim
`employeeOptions` es `declared_absent` con la regla, la página dice que el valor
por acción es una cota superior y el rigor baja un nivel
(`employee_options_not_subtracted`, también declarado). Decisión del owner del
2026-10-22. El job deja de terminar en `employee_equity_not_proposed`.

El orden es fijo: transcripción aceptada, XBRL, `not_subtracted`.

## Decisión 5 — el snapshot

`employeeEquity.decision` pasa a ser una unión por `basis` —`ai_proposal`,
`xbrl_same_10k`, `not_subtracted`—. La primera es la de siempre, byte por byte;
las otras dos derivan con `employee-equity-reading-1.1.0`.
`employee_equity_recomputed` recalcula cada base y exige que los hechos XBRL
sean del cierre y de la presentación que la decisión dice.
`rigor_derived_from_completeness` recalcula el rigor con la base congelada. Motor
y metodología no cambian.

## Medición

Réplica de la base personal con el worker real, el 2026-10-22: las nueve
empresas llegan a una corrida, ocho `computed` y WM `requires_review` por
`terminal_value_share` (no por opciones).

| Base             | Empresas                  | Rigor       |
| ---------------- | ------------------------- | ----------- |
| `ai_proposal`    | KO, MRK, COST, DECK, ALGN | `standard`  |
| `xbrl_same_10k`  | Cencora, EXPD             | `standard`  |
| `not_subtracted` | HD, WM                    | `screening` |

HD aceptó en una corrida en seco (escalón 2) y se abstuvo en la del job: los
escalones no son deterministas, y sin XBRL de opciones queda sin restarlas,
dicho. Las 44 corridas guardadas de quince empresas se reproducen. USD 0,26 de
IA en la última tanda.

## Consecuencias

- Toda empresa guardada vuelve a bajar companyfacts una vez (`selectionOutdated`).
- Una transcripción guardada con la tarea `1.2.0` deja de contar como «ya
  preguntado»: la corrida vuelve a preguntar una vez.
- Una corrida con `not_subtracted` puede dar un valor más alto que el que daría
  con la transcripción: la página y el rigor lo dicen.

## Límites

- Diez años sobrestima el valor de opciones que vencen antes; lo correcto es
  leer el plazo del iXBRL del 10-K, que queda pendiente.
- La cantidad y el strike del XBRL están en la base de acciones del cierre; un
  split entre el cierre y el `as_of` no se re-expresa, igual que en la
  transcripción.
- No hay evals de esta tarea: la regresión se mide con sus tests y la réplica.
