# ADR 0039: escenarios bear/base/bull como conjuntos coherentes de supuestos

- Estado: aceptado
- Fecha: 2026-10-20
- Alcance: `F4-04`. Decide dónde viajan los escenarios de una corrida, qué
  pueden mover, cómo se valúan, con qué controles y qué pasa cuando sus
  valores quedan desordenados.
- Decisiones relacionadas: [ADR 0003](0003-decimal-arithmetic-valuation-engine.md)
  (motor decimal), [ADR 0037](0037-lease-rd-capitalization.md) y
  [ADR 0038](0038-reported-adjusted-normalization.md) (base ajustada)

## Contexto

La metodología pide que bear, base y bull sean «conjuntos coherentes de
supuestos, no multiplicadores arbitrarios sobre el resultado», que cada
escenario declare «qué drivers cambian y por qué», y que las probabilidades
sólo se muestren «con base defendible». Hasta acá una corrida tenía un único
conjunto de supuestos y la superficie de referencia nombraba los escenarios
como planificados.

Dos atajos estaban a mano y se descartan:

- **Escalar el resultado** (bear = base × 0,8): no es una historia, no dice
  qué cambió, y un mismo factor sobre el EV y sobre el equity contradice al
  puente, que resta claims fijas.
- **Mover un parámetro a la vez**: eso ya es la sensibilidad WACC/g. Un
  escenario que sólo cambia el crecimiento no es coherente, porque con la
  reinversión por ventas sobre capital crecer más exige reinvertir más y con
  un retorno por debajo del costo de capital destruye valor.

## Decisión 1 — un snapshot, tres conjuntos

`ValuationInput.scenarios` (`scenario-set-1.0.0`) lleva bear y bull. La base es
la corrida misma: sus períodos y su terminal, así que el valor principal sigue
siendo una celda de su propia sensibilidad y el número que ya se publicaba no
cambia. Un único `input_hash` cubre los tres conjuntos: cambiar un driver de un
escenario es otra corrida (`TM-16`). `null` es una corrida con un único
conjunto de supuestos.

Cada escenario declara una **tesis** y una lista de **drivers**, cada uno con
su valor y su motivo, a lo sumo una vez por driver:

| Driver                    | Forma                                        |
| ------------------------- | -------------------------------------------- |
| `revenueGrowth`           | un valor por período, `null` = el de la base |
| `ebitMargin`              | un valor por período                         |
| `salesToCapital`          | un valor por período, en esa convención      |
| `returnOnCapital`         | un valor por período, en esa convención      |
| `terminalGrowth`          | un valor                                     |
| `terminalEbitMargin`      | un valor                                     |
| `terminalReturnOnCapital` | un valor                                     |

El check `scenario_drivers_declared` (`reject`) exige un valor por período
explícito, al menos un período cambiado, la convención de reinversión del
período —cambiar de convención es otro modelo— y que cada valor declarado sea
distinto del de la base: un driver igual a la base es un motivo sin efecto.

## Decisión 2 — el costo de capital no se mueve

Por decisión del owner, un escenario no mueve los `wacc`: salen de componentes
fechados (`wacc_built_from_components`), y la incertidumbre de tasa la cubre la
sensibilidad. Tampoco mueve la tasa impositiva —la deriva la normalización—,
los hechos del ejercicio base ni el puente EV-equity. Mover ERP o beta por
escenario queda para las cíclicas de `F4-06`, donde la metodología lo pide.

## Decisión 3 — cada escenario se valúa entero, con los mismos checks

El motor **materializa** cada escenario: la base con sus drivers reemplazados,
sin escenarios ni sensibilidad propios. Es un `ValuationInput` válido, y pasa
por los mismos checks de entrada y de salida y por el mismo `computeFcff` que
la base: no hay un camino más corto para un escenario. Su resultado guarda la
proyección entera, el EV, el equity, el valor por acción, el peso del terminal
y sus checks (`result.scenarios`).

- Un `reject` en un escenario rechaza la corrida: publicar un rango con un
  extremo indefinido sería peor que no publicarlo. Las rutas nombran el
  escenario (`scenarios.bull:terminal.growth`), así que el motivo se lee sin
  volver al snapshot.
- Un `require_review` en un escenario deja la corrida en `requires_review`.

## Decisión 4 — sin probabilidades

No hay base defendible para declararlas, así que el rango no se pondera y no
se publica un valor esperado. La superficie lo dice.

## Decisión 5 — un desorden pide revisión

`scenario_value_order` (`require_review`) exige `bear <= base <= bull` en valor
por acción. Un desorden puede ser legítimo —crecer con un retorno por debajo
del costo de capital destruye valor—, pero contradice las etiquetas, así que la
corrida se calcula y queda para revisión. La propiedad que sí se garantiza se
prueba: con todo lo demás fijo, mover sólo el margen ordena los valores.

## Medición (2026-10-20)

FixtureCo, con tesis sintéticas declaradas como tales: bear mueve crecimiento
(−3 puntos), margen (15 %), `g` (1,5 %) y retorno terminal (9 %, igual al
WACC); bull mueve crecimiento (+3 puntos con fade), margen (20 %), `g` (2,5 %,
bajo la libre de riesgo de 4 %) y retorno terminal (15 %). Valor por acción:
**9,54 / 13,55 / 17,56 USD**, ordenados; la base conserva su valor exacto. El
peso del terminal es 70 % en bear y 76 % en bull, bajo el umbral de 85 %.

## Consecuencias

- El motor sube a `fcff-1.4.0` y la metodología a `0.10.0`; las corridas
  guardadas no se reescriben. `valuation_runs` guarda input y resultado en
  `jsonb`, así que no hay migración.
- El replay recalcula los tres conjuntos desde el snapshot, sin red ni IA.
- No hay todavía una corrida real con escenarios: los supuestos de una empresa
  real los declara el owner, y el workbench editable es un slice propio.
