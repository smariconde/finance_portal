# ADR 0081: año base TTM desde el último 10-Q

- Estado: aceptado
- Fecha: 2026-11-17
- Alcance: `F6-24`.
- Decisiones relacionadas: [ADR 0017](0017-sec-history-window.md) (ventana),
  [ADR 0037](0037-lease-rd-capitalization.md) (capitalización),
  [ADR 0038](0038-reported-adjusted-normalization.md) (normalización),
  [ADR 0049](0049-derived-assumptions-v2.md) (supuestos derivados),
  [ADR 0054](0054-zero-debt-evidence-derived-ebit.md) (deuda cero y EBIT
  derivado)

## Contexto

La corrida descontaba desde el último 10-K. La ADR 0049 ya nombró el límite:
con un `as_of` cerca de un año después del cierre, el valor queda un año atrás.
El owner pidió el 2026-10-27 que el último 10-Q entre al año base.

Antes de escribir la regla medimos sobre la base personal: 51 filers con
fundamentals y 47 con un 10-Q posterior a su último 10-K.

| Partida                | Con el dato en el 10-K | Con las tres patas TTM, mismo concepto |
| ---------------------- | ---------------------- | -------------------------------------- |
| Ventas                 | 47                     | 44                                     |
| Resultado operativo    | 31                     | 30                                     |
| Resultado antes de imp | 47                     | 44                                     |
| Impuesto               | 47                     | 46                                     |
| SBC                    | 33                     | 32                                     |
| I+D                    | 17                     | 14                                     |
| Deterioros             | 28                     | 8                                      |

Las ventas TTM se apartan del ejercicio una mediana de +4,3 % (p90 +14,6 %,
máximo +43 %). El balance del 10-Q viene incompleto: el pasivo por
arrendamientos operativos está en 46 cierres anuales y es usable (total o sus
dos partes) en 23 trimestrales, y entre las 26 empresas cuya deuda resuelve al
10-K, la receta deja de cerrar en 5 al 10-Q.

## Decisión 1 — `ttm-base-period-1.0.0`

Los flujos del año base de una corrida `fcff_base` son los doce meses al
último 10-Q visible al corte:

    TTM = ejercicio + acumulado del año en curso − acumulado comparable

- **Un concepto por flujo** en las tres patas: el que eligió la serie anual. Una
  pata con otro concepto es una pata que falta.
- El acumulado actual empieza el día siguiente al cierre del ejercicio; el
  comparable empieza y termina un año antes, a 10 días (los ejercicios de 52/53
  semanas mueven los bordes), y su duración no se aparta más de 7 días. Un
  trimestre no es el comparable de un semestre.
- Los flujos son los que el año base usa: ventas, resultado operativo (o, sin
  él, resultado antes de impuestos más los intereses de la base que eligió
  `interest-expense-1.0.0`), resultado antes de impuestos, impuesto y SBC.
- **Sin las tres patas de uno de ellos, la corrida entera queda anual** y
  nombra la partida (`ttm_leg_missing`). Un margen con ventas TTM y EBIT anual no
  es el margen de ningún período. Un nulo nunca es cero.
- Si el ejercicio revierte un cargo no recurrente, la corrida queda anual
  (`non_recurring_charge_applied`): los deterioros casi nunca tienen acumulado
  (8 de 28) y el cargo es de un ejercicio. Sin 10-Q posterior, anual con
  `no_interim_after_fiscal_year`.

Un hecho TTM no tiene observación propia: lleva el monto derivado, la fecha
del 10-Q, la disponibilidad de su última pata, el documento del acumulado
actual y la marca `ttm`. Sus patas viajan congeladas en el snapshot.

## Decisión 2 — balance por bloques (owner, 2026-11-17)

Con la tabla a la vista, el owner eligió bloques en vez de «todo al trimestre o
nada» (11 de 30 no financieras en TTM) o «balance del 10-K» (deuda y caja hasta
un año atrás):

- **Deuda, caja, patrimonio y minoritarios** al cierre del 10-Q si la receta de
  deuda cierra ahí y está cada partida que el 10-K tenía; si no, al cierre del
  10-K, con el motivo (`debt_recipe_not_at_quarter`,
  `balance_item_not_at_quarter`).
- **Arrendamientos operativos** al 10-Q si publica el total o sus dos partes; si
  no, al 10-K (`lease_liability_not_at_quarter`).

Cada claim del puente lleva la fecha de su bloque. La evidencia de deuda cero
se prueba en ejercicios, así que sólo viaja con el bloque al 10-K.

## Decisión 3 — lo que sigue anual

- La historia de ventas de la tendencia: el TTM no es un punto de una serie
  anual. Los períodos proyectados sí se cuentan desde el 10-Q.
- La capitalización de I+D: su calendario es de ejercicios, y poner el TTM como
  año corriente contaría meses dos veces (o dejaría meses sin contar). El
  activo, la amortización y su ajuste al EBIT son los del 10-K; el error es el
  crecimiento de la I+D en la fracción de año.
- La historia de cargos, la evidencia de deuda cero, la cobertura de intereses
  del rating sintético y las opciones de empleados.
- Cíclicas (`normalized_fcff`), crecimiento, financieras y REIT: su regla mira
  ejercicios. Una cíclica normaliza el margen al ciclo; el año base pesa poco.

## Decisión 4 — snapshot y check

`ValuationInput.basePeriod` es opcional: ausente, la corrida es la de antes y
conserva su hash; presente es `ttm` con sus patas y bloques, o `annual` con su
motivo. `capitalization.basePeriod` y `normalization.facts.basePeriod` llevan la
fecha del 10-K y la de cada bloque, y sólo existen en un TTM.

`base_period_recomputed` (rechazo) recalcula cada flujo desde sus patas y exige
que ventas, EBIT, EBIT derivado, impuestos y SBC del snapshot sean exactamente
esos hechos, que cada bloque esté en la fecha que declara y que ningún cargo
se revierta. El motor y la metodología no cambian de versión.

Lo que se lee por ejercicio —la lectura de expectativas, la ficha, la ganancia
neta del P/E de los pares, la base de acciones— usa el cierre del 10-K
(`baseFiscalYearEndOf`).

## Decisión 5 — ventana

La ventana (ADR 0017) sólo corta hacia atrás: los acumulados del ejercicio en
curso y su comparable ya se guardan. No cambia.

## Consecuencias

Medido sobre una réplica de la base personal, mismo corte, contra el código
anterior:

| Empresa | Base                       | Anual  | TTM    |
| ------- | -------------------------- | ------ | ------ |
| AAPL    | TTM al 27/06/2026          | 151,76 | 176,23 |
| JNJ     | TTM al 28/06/2026          | 184,72 | 133,36 |
| AMZN    | TTM al 30/06/2026          | 143,40 | 134,58 |
| INCY    | TTM al 31/03/2026          | 173,51 | 186,78 |
| DUK     | TTM al 31/03/2026          | 10,70  | 19,43  |
| CRL     | anual: falta pretax del 1S | −33,92 | −33,92 |

JNJ baja porque el FY2025 incluía la reversión del cargo por talco del 1T 2025
(pretax 32.581 M contra 25.196 M TTM). AMZN duplicó su deuda de largo plazo en
el semestre (68.836 → 132.995 M) y pasa a revisión por el peso del valor
terminal. Las 16 corridas guardadas y las nuevas TTM reproducen sus dos hashes.

Un filer (CIK 1415404) no se puede leer: su lectura de linaje supera las 1.000
revisiones (`LineageReadLimitError`). Es anterior a este slice y queda anotado.
