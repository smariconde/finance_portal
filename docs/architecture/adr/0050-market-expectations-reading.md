# ADR 0050: la IA lee el 10-K y el código lo compara con lo que exige el precio

- Estado: aceptado
- Fecha: 2026-10-21
- Alcance: `F6-11`. Una tarea nueva de la capa IA, manual, con su tabla
  (migración `0033`). Nada de lo que devuelve entra a un cálculo ni a un
  snapshot.
- Decisiones relacionadas: [ADR 0033](0033-ai-layer-industry-resolution.md)
  (capa IA), [ADR 0035](0035-ai-layer-evals.md) (evals),
  [ADR 0048](0048-market-price-implied-expectations.md) (lo que exige el
  precio), [ADR 0049](0049-derived-assumptions-v2.md)

## Contexto

El DCF inverso de `F6-09` responde qué tiene que pasar para que el precio
sea razonable: en AAPL, crecer 17,98 % por año durante cinco años, o llevar
el margen a 62,60 %. Decidir si eso es creíble es un juicio cualitativo, y el
owner preguntó si la IA puede ayudar a hacerlo. Sin ese juicio, el número
exigido queda solo, al lado de la historia.

## Decisión 1 — el modelo no ve el precio ni lo exigido

Lo que exige el precio sale de Yahoo (el cierre) y de Damodaran (el costo de
capital), y el `aiTransfer` de las dos fuentes es `restricted`
(ADR 0033): no pueden viajar a un modelo, tampoco como un derivado del que se
reconstruye el dato. Hay además una razón de método: un modelo que sabe qué
cifra tiene que justificar la justifica, y además conoce el precio de su
entrenamiento.

El modelo ve sólo el 10-K del año base —`sec-edgar`, `aiTransfer: allowed`—:
el Item 1, el MD&A y el comienzo del Item 1A, recortados por
`sec-10k-outlook-1.0.0` a 8, 18 y 4 KB. Del MD&A se quitan las advertencias
prospectivas, las estimaciones contables críticas, la liquidez y los
pronunciamientos contables, desde su encabezado hasta el próximo que habla del
desempeño. Medido sobre Amazon: sin esto, los primeros 14 KB no llegaban a la
discusión de ventas.

## Decisión 2 — devuelve categorías citadas, no números

`market-expectations-reading-1.0.0` pide, por driver, una perspectiva en una
escala ordinal declarada:

| Driver                            | Escala                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| Crecimiento de ventas, cinco años | `decline` (< 0 %), `low` (0–5 %), `moderate` (5–10 %), `high` (10–20 %), `very_high` (> 20 %) |
| Margen operativo                  | `contracting`, `stable`, `expanding`                                                          |
| Ventaja competitiva               | `none`, `narrow`, `wide`                                                                      |

Cada driver lleva entre una y cuatro señales con dirección, resumen y una
cita literal de un bloque; `not_addressed` no lleva ninguna. Se agregan hasta
cinco riesgos citados. `market-expectations-policy-1.0.0` rechaza:

- una cita que no está en el bloque que dice;
- una cifra del resumen que no está en ese bloque. En la primera medición, la
  exigencia de que estuviera en el fragmento citado rechazó los cuatro
  escalones sobre AAPL: el modelo resume con el dato de la oración de al lado;
- un driver repetido o faltante;
- una perspectiva de otra escala;
- señales que no corresponden con la perspectiva.

Confianza `low` es abstención.

## Decisión 3 — la comparación es del código, `expectations-plausibility-1.0.0`

Lo exigido se lleva a la misma escala:

- **Crecimiento:** los mismos cortes del prompt.
- **Margen:** el cambio contra el margen ajustado del año base. Hasta dos
  puntos es estable; más de quince, un escalón más allá de «se expande».
- **Ventaja:** el ROIC terminal exigido menos el WACC terminal. Hasta dos
  puntos es ninguna, hasta quince acotada.

El veredicto es `within`, `above` (un escalón) o `far_above` (dos o más),
o se nombra: `unreachable`, `not_addressed`, `no_requirement`. La tasa de
descuento no tiene lectura, porque el 10-K no habla del costo de capital del
inversor.

## Decisión 4 — se guarda todo y se lee por ejercicio

Toda pregunta queda en `market_expectations_readings`, también la abstención
y el freno, con las secciones enviadas, su `sha256` y las versiones. Su
`reading_id` es el `task_run_id` del libro de gasto. La página muestra la
última aceptada **del ejercicio base de la corrida**: una lectura de otro 10-K
no se pone al lado de supuestos que no salieron de él. El comando es manual,
como las demás tareas de la capa; la página no llama al modelo (`TM-03`).

## Consecuencias

- Medido el 2026-10-21. AAPL: crecimiento moderado, margen estable, ventaja
  amplia, en el escalón 2. El precio exige un escalón más de crecimiento
  («alto») y dos de margen.
- AMZN: crecimiento alto, margen en expansión, ventaja amplia, en el
  escalón 3. El precio exige un escalón más de crecimiento («muy alto») y un
  margen dentro de lo que sostiene.
- Dos corridas: la primera, USD 0,066 (AAPL rechazada en los cuatro
  escalones por la regla de cifras, AMZN abstenida con el MD&A sin recortar).
  La segunda, USD 0,043.
- Los resúmenes quedan en inglés, como los escribe el modelo; la página los
  muestra como propuesta de IA, con su cita y su sección.
- No hay evals de esta tarea todavía: la corrección es provisional, igual que
  los oros `pending_owner` de `F5-07`. Medirla contra un corpus congelado es
  trabajo aparte.

## Alternativas descartadas

**Mandarle al modelo lo que exige el precio y pedirle un veredicto.** Viola
el `aiTransfer` de Yahoo y de Damodaran y ancla la respuesta.

**Que el modelo devuelva rangos numéricos.** Un número de texto libre no se
puede verificar contra la evidencia; una categoría con citas sí se puede
discutir.

**Leer el documento entero.** El costo y la reserva por bytes lo impiden, y el
ruido de las notas contables diluye la evidencia.
