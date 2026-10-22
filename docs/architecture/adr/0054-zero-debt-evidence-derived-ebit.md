# ADR 0054: deuda cero con evidencia y EBIT sin resultado operativo

- Estado: aceptado
- Fecha: 2026-10-22
- Alcance: `F6-15`. Precisa las decisiones 4 y 5 de la
  [ADR 0053](0053-reported-concept-coverage.md) después de medirlas.
- Decisiones relacionadas: [ADR 0017](0017-sec-history-window.md) (ventana),
  [ADR 0037](0037-lease-rd-capitalization.md) (puente de capitalización),
  [ADR 0038](0038-reported-adjusted-normalization.md) (deuda reportada),
  [ADR 0053](0053-reported-concept-coverage.md) (intereses con base nombrada)

## Contexto

La ADR 0053 registró dos decisiones del owner para este slice: la deuda vale
cero sólo con evidencia —ningún componente de deuda en los cinco ejercicios y
gasto de intereses nulo o ausente—, y el puente toma `pretax + intereses` cuando
no hay `OperatingIncomeLoss`.

Antes de escribir código medimos la primera contra la muestra de 80 empresas de
`F6-14` y la réplica. Tal como estaba escrita:

| Empresa     | Qué publica                                       | Regla literal             |
| ----------- | ------------------------------------------------- | ------------------------- |
| Intuitive   | nada de deuda ni intereses                        | cero, correcto            |
| Align       | intereses de 2011, fuera de la ventana            | cero, correcto            |
| Vertex      | `FinanceLeaseLiability` 112 M, intereses 13 M     | no aplica                 |
| Deckers     | intereses 2,5 M (línea sin usar), cobertura ~500× | no aplica                 |
| Expeditors  | intereses 4,8 M en 2023                           | no aplica                 |
| Moderna     | `LongTermDebtNoncurrent` 590 M                    | no aplica, y es correcto  |
| D.R. Horton | ningún componente; intereses capitalizados        | **cero, y debe ~5.000 M** |

Y una empresa sin intereses tampoco tiene cobertura: el costo de capital no
puede elegir un rating sintético y frena igual, aunque la deuda resuelva.

## Decisión 1 — la guardia de deuda

`sec-core-concepts-7.0.0` y `annual-fundamentals-1.4.0` leen catorce conceptos
que **ninguna receta suma** y que prueban que hay deuda: las seis filas del
cronograma de vencimientos (`LongTermDebtMaturitiesRepaymentsOfPrincipal…`),
`NotesPayable`, `NotesAndLoansPayable`, `LineOfCredit`, `SeniorNotes`,
`ConvertibleNotesPayable`, `DebtInstrumentCarryingAmount`,
`DebtLongtermAndShorttermCombinedAmount` y
`LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities`. D.R. Horton
sólo se delata por el cronograma.

Cada concepto es una partida propia. Como alternativas en orden, un cero en la
primera taparía un monto en la siguiente (D.R. Horton publica `InYearFive = 0`
y `AfterYearFive = 2.400 M`). La ADR 0053 dejó afuera dos de ellos porque
habrían cambiado la receta; como guardia no se suman, así que no la cambian.

Con 68 conceptos, la serie supera las 64 métricas que admite una lectura: el
lector parte la lectura en tandas que no se solapan.

## Decisión 2 — `zero-debt-evidence-1.0.0`

La evidencia son los **cinco ejercicios** más recientes de la serie, todos con
ventas, y en cada uno:

- ningún componente de préstamos ni partida de la guardia con un monto distinto
  de cero; uno publicado en cero es evidencia, no deuda;
- gasto de intereses (`interest-expense-1.0.0`) nulo, ausente, o con una
  cobertura `EBIT / intereses` igual o mayor que el **piso de la banda más alta**
  de la tabla de rating sintético visible al corte. Son las comisiones de una
  línea sin usar o los intereses de los arrendamientos, no el servicio de una
  deuda material. El piso sale de la tabla, no de un número del proyecto.

Los arrendamientos financieros no son préstamos: son deuda. Decisión del owner
del 2026-10-22.

Se congela lo que la regla leyó —ventas, partidas en cero, intereses y EBIT de
cada año con su provenance, y el piso con su release y su fila— en
`normalization.facts.zeroDebtEvidence`. Los montos de intereses y EBIT no se
guardan: se recalculan desde los hechos.

## Decisión 3 — `reported-debt-1.1.0`

Sólo cuando **ninguna receta cierra** y la evidencia se cumple:

- con arrendamientos financieros, la deuda son ellos
  (`finance_leases_only`, Vertex);
- sin ellos, `zero_with_evidence` vale cero y la claim del puente es
  `declared_absent`, nombrando la regla. Nunca `reported`: nadie publicó ese
  monto.

Un componente de préstamos publicado con monto impide usar la evidencia aunque
la evidencia diga otra cosa (Moderna). Donde una receta cierra, la salida es la
de `1.0.0` byte por byte y la evidencia no viaja: el snapshot de una corrida
anterior, o de una empresa con deuda, no cambia.

El rigor baja un nivel sin regla nueva: `cash_and_debt` sigue sin cumplirse
—no hay deuda publicada—, así que el rigor no llega a `full`.

## Decisión 4 — sin intereses, la banda más alta

Con la evidencia usada y ningún gasto de intereses en sus cinco ejercicios, la
cobertura del costo de capital es el piso de la banda más alta, con
`interestBasis: "no_interest_expense"` y la declaración
`coverage_no_interest_expense`. Es la convención de Damodaran para quien no paga
intereses. Decisión del owner del 2026-10-22.

El check `zero_debt_evidence_consistent` (`reject`) exige que el piso de la
evidencia sea la fila y la release del `company_default_spread` de la corrida,
y que una cobertura `no_interest_expense` exista sólo con evidencia sin
intereses y valga ese piso. Sin evidencia ni esa cobertura, el check no existe y
el resultado de una corrida anterior no cambia.

La señal de distress no necesita cambio: una empresa sin intereses, con
patrimonio y EBIT positivos dos años, ya da `absent` por la otra rama.

## Decisión 5 — `ebit-from-pretax-1.0.0`

Sin `OperatingIncomeLoss` en el ejercicio base, el EBIT del puente es el
resultado antes de impuestos más `netInterestForEbit` —un neto de ingreso se
resta—. `capitalization.ebitDerivation` congela el resultado y los intereses con
su base, `ledger.ebit.basis` dice `pretax_plus_interest`, y
`capitalization_recomputed` lo recalcula y rechaza un EBIT derivado al lado de
uno publicado. Con resultado operativo, ninguno de los dos campos existe.

## Consecuencias

- Toda empresa guardada baja companyfacts una vez más (`selectionOutdated`).
- Las versiones del motor y de la metodología no se mueven: los campos nuevos
  son opcionales y sólo aparecen cuando se usan, así que toda corrida anterior
  se re-ejecuta igual.
- La página dice en el libro de ajustes cuándo el EBIT es derivado y cuándo la
  deuda salió de la evidencia.

## Límites

- La guardia es una lista de conceptos: una deuda que un filer etiquete sólo con
  un concepto fuera de ella y sin intereses pasaría como cero. Lo que se mide en
  la réplica es que D.R. Horton no pasa.
- Una empresa sin deuda pero clasificada `high_growth` o `loss_making` (Moderna)
  sigue sin método: eso no es deuda.
