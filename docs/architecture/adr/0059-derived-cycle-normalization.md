# ADR 0059: la corrida por ticker valúa cíclicas y commodities con el margen de ciclo

- Estado: aceptado; modelo `experimental`
- Fecha: 2026-10-27
- Alcance: `F6-18`. Lleva `normalized_fcff` (ADR 0042) al job por ticker.
  Motor `normalized-fcff-1.0.0`, metodología `cycle-fcff-1.0.0` y
  `fcff-1.6.0` no cambian; el job sigue en `valuation-job-1.3.0`.
- Decisiones relacionadas: [ADR 0042](0042-cycle-normalized-fcff.md),
  [ADR 0046](0046-derived-valuation-assumptions.md),
  [ADR 0049](0049-derived-assumptions-v2.md),
  [ADR 0037](0037-lease-rd-capitalization.md),
  [ADR 0038](0038-reported-adjusted-normalization.md)

## Contexto

CAT terminó `unsupported_method` con perfil cíclico. El motor de ciclo existía
desde la Fase 4, pero pedía al owner un snapshot privado: la historia, los
años hasta normalizar y un corrimiento de margen. El job no lo armaba.

Se midió sobre una réplica con nueve empresas. Seis tenían perfil cíclico o
commodity, y en todas la ventana guardada daba seis ejercicios (2020–2025):

| Empresa | Perfil    | Margen último | Media  | Rango        | Otro bloqueo                |
| ------- | --------- | ------------- | ------ | ------------ | --------------------------- |
| CAT     | cíclica   | 16,5 %        | 15,6 % | 10,9–20,2 %  | deuda sin receta            |
| DE      | cíclica   | 20,6 %        | 17,9 % | 12,1–21,2 %  | deuda sin receta            |
| NUE     | cíclica   | 8,4 %         | 15,5 % | 5,0–25,7 %   | —                           |
| FCX     | commodity | 25,2 %        | 27,3 % | 17,2–36,6 %  | —                           |
| CVX     | commodity | 11,1 %        | 11,2 % | −7,1–20,4 %  | industria ambigua (IA)      |
| XOM     | commodity | 12,6 %        | 9,6 %  | −15,3–19,0 % | acciones diluidas faltantes |

MU no es cíclica para el selector: sale `high_growth`, así que es `F6-21`.

## Decisión 1 — la historia sale de la serie, en la base ajustada

`derived-cycle-1.0.0` toma, del ejercicio base hacia atrás, los ejercicios
consecutivos con ventas y EBIT, entre cinco y diez. Dos ejercicios cuentan
como consecutivos si sus cierres están a entre 350 y 380 días.

El motor exige que el último año sea el EBIT ajustado de la normalización, y
la ADR 0042 prohíbe mezclar en silencio años reportados con uno ajustado. Por
eso cada año anterior lleva la capitalización de arrendamientos e I+D de sus
propios hechos, con el costo de deuda y la industria de la corrida. Así toda
la historia queda en la misma base. Sólo el ejercicio base revierte además
los cargos no recurrentes. El texto `accountingBasis` del snapshot lo dice.

Sin cinco años, sin base ajustada o con un margen medio no positivo, la regla
no arma nada y nombra el motivo. En ese caso el selector sigue pidiendo
`cycle_margins`, y `valuation:assess` imprime la línea `ciclo`.

## Decisión 2 — tres años de convergencia, sin corrimiento

Decisión del owner del 2026-10-26: el margen converge al promedio del ciclo
en tres años. En NUE pasa de 8,4 % a 15,5 % sin saltar de golpe ni tardar
medio horizonte. Un corrimiento del margen es un juicio, y ninguna regla lo
pone: `marginShift` queda en `null`.

## Decisión 3 — en una cíclica, las ventas crecen al ritmo de la economía

Con la tendencia de `derived-assumptions-2.0.0`, la ventana 2020–2025 arranca
en el piso del ciclo, y la regla lee la recuperación como crecimiento: FCX
crecía 10 % por año y CVX 11,8 %. Normalizar el margen y no las ventas es
incoherente. Decisión del owner del mismo día: en una corrida de ciclo, las
ventas crecen a la tasa terminal desde el año 1.

Medido con el mismo motor:

| Empresa | Con tendencia | Con la tasa terminal | Precio |
| ------- | ------------- | -------------------- | ------ |
| NUE     | 242,81        | 233,59               | 257,35 |
| FCX     | 56,51         | 42,60                | 65,16  |
| CVX     | 79,08         | 83,01                | 232,01 |

En CVX el crecimiento no explica la brecha. Rinde 5,6 % sobre su capital
contra un costo de 7,8 %, así que crecer no crea valor y el modelo la valúa
por su ganancia sobre la tasa. Es una lectura del modelo, no un error.

## Decisión 4 — bear y bull mueven el margen objetivo al peor y al mejor del ciclo

Con el crecimiento fijo, los escenarios de la regla derivada pierden sentido.
En una cíclica, bear lleva el margen objetivo al menor margen anual positivo
de la historia y bull al mayor. Es el único driver que la ADR 0042 admite
para escenarios de ciclo (`terminalEbitMargin`). Sin un ciclo que se mueva no
hay escenarios. El rango es ancho a propósito: en NUE va de 39 a 420.

Los dos márgenes se redondean a cuatro decimales. El materializador traduce el
objetivo en un corrimiento (`objetivo − media`) y lo vuelve a sumar, y un
margen de 34 dígitos no sobrevivía exacto a esa ida y vuelta. La réplica lo
encontró en NUE: el control de ciclo rechazaba el escenario pesimista por el
último dígito.

## Decisión 5 — una sola función para el armado y para el control

`applyDerivedCycle` toma lo que deriva `derived-assumptions-2.0.0` y le
aplica el ciclo: crecimiento terminal, márgenes de la trayectoria y
escenarios. El armado del snapshot la usa. `assumptions_derived_recomputed`
la recibe como `reshape` y compara todo lo demás exactamente: tasa,
impuestos, reinversión, ROIC terminal y sensibilidad. Los snapshots
`fcff_base` no la reciben y conservan sus hashes.

## Decisión 6 — lo que cambia en el contrato y en el job

- **Fecha efectiva.** `cycle_normalization_recomputed` exigía que la fecha
  efectiva fuera el mismo día que el `as_of`. Un job lee en el instante del
  pedido y valúa al último cierre asentado, así que ahora exige efectiva ≥
  `as_of`. Los hechos siguen acotados al corte y al `as_of`, y un snapshot
  privado anterior sigue pasando.
- **Evaluación.** Con la historia lista, la evaluación vuelve a seleccionar
  con `cycle_margins` resuelto.
- **Paso cualitativo.** La historia necesita el costo de capital, y éste la
  industria que a veces resuelve la IA. Por eso una cíclica a la que sólo le
  falta `cycle_margins` entra al paso cualitativo (`awaitsCycleHistory`). Si
  no obtiene nada nuevo, termina como antes, con el motivo del selector.
- **Resultado del job.** El resultado del job y el check
  `valuation_jobs_run_check` (migración `0036`, con rollback pareado) admiten
  una corrida `normalized_fcff`.
- **Versión del job.** Se queda en `valuation-job-1.3.0`: la forma del
  resultado no cambia, y su campo `method` ya dice qué se registró.

## Consecuencias

- Medido en la réplica: NUE, FCX y CVX registran corridas `normalized_fcff` en
  `requires_review`, el único control que falla es el aviso del modelo
  experimental, y las tres se reproducen sin red. CVX resolvió su industria y
  sus opciones con la IA por USD 0,012 antes de valuar.
- Rigor `screening`: el modelo es experimental y seis años pueden no cubrir un
  ciclo completo.
- CAT y DE eligen `normalized_fcff` pero no arman el snapshot: su deuda no
  cierra con ninguna receta porque tienen brazo financiero cautivo. Decisión
  del owner: un slice propio lo investiga.
- XOM sigue sin acciones diluidas en la serie: es un faltante previo.
- La página dice qué es una corrida de ciclo: el margen de hoy contra el
  promedio, cuánto valdría con el margen de hoy y por qué el rango es ancho.
