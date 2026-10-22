# ADR 0053: leer los conceptos que los filers usan de verdad

- Estado: aceptado
- Fecha: 2026-10-22
- Alcance: `F6-14`. La selección de la SEC y la serie anual leen los conceptos
  equivalentes que medimos sobre el índice; los intereses pasan a ser una receta
  con bases nombradas; la corrida re-baja una ventana guardada con una selección
  vieja. Las decisiones 4 y 5 son de `F6-15` y se registran acá porque el owner
  las tomó juntas.
- Decisiones relacionadas: [ADR 0017](0017-sec-history-window.md) (ventana),
  [ADR 0031](0031-on-demand-company-assessment.md) (evaluación),
  [ADR 0038](0038-reported-adjusted-normalization.md) (deuda reportada),
  [ADR 0051](0051-on-demand-valuation-data.md) (la corrida baja lo que falta),
  [ADR 0052](0052-qualitative-decisions-in-valuation-job.md) (la IA en la
  corrida)

## Contexto

Con la IA en la corrida (`F6-13`), cinco de diez empresas nuevas llegaron a un
valor. Las otras cinco no frenaron por nada cualitativo: les faltaba un insumo
del WACC o del capital invertido que el filing sí trae, con otro concepto.

El 2026-10-22 medimos la companyfacts de 80 empresas del índice, una request
cada una, sin IA y sin escribir. De las 76 no financieras, **32** resolvían a la
vez deuda, intereses, EBIT y D&A del último ejercicio.

| Insumo    | Hoy   | Con los conceptos que se usan | Ejemplo                                                                    |
| --------- | ----- | ----------------------------- | -------------------------------------------------------------------------- |
| Deuda     | 56/76 | 64/76                         | Coca-Cola: vencimientos en `LongTermDebtAndCapitalLeaseObligationsCurrent` |
| Intereses | 53/76 | 58/76 con el bruto            | Walmart: `InterestExpenseDebt` + `FinanceLeaseInterestExpense`             |
| D&A       | 55/76 | 72/76                         | Walmart: `DepreciationAmortizationAndAccretionNet`                         |
| EBIT      | 65/76 | —                             | Nike, ADP, Merck, Eaton y D.R. Horton no publican `OperatingIncomeLoss`    |

Los cuatro juntos: de 32 a 51. Sin intereses brutos siguen Waste Management,
Cencora, General Dynamics y Zimmer, que publican sólo el **neto**, e IDEX y CDW,
que publican sólo lo **pagado**.

## Decisión 1 — la selección y la serie leen los equivalentes

`sec-core-concepts-6.0.0` suma siete conceptos y `annual-fundamentals-1.3.0` los
lee como **alternativas en orden** o como partidas propias, nunca sumados por la
serie:

- vencimientos corrientes y deuda corriente: también
  `LongTermDebtAndCapitalLeaseObligationsCurrent`. Va detrás de
  `LongTermDebtCurrent` y no cambia la receta de deuda: con la no corriente que
  incluye arrendamientos financieros, la receta ya los excluye;
- D&A: también `DepreciationAmortizationAndAccretionNet`;
- intereses, como partidas propias: el de la deuda, el de los arrendamientos
  financieros, el neto (`InterestIncomeExpenseNonoperatingNet` o
  `InterestIncomeExpenseNet`) y el pagado (`InterestPaidNet`).

No entran `LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities` ni
`NotesAndLoansPayable`. El primero obligaría a cambiar la receta de deuda para no
sumar dos veces los arrendamientos. El segundo es corriente en unos filers y
total en otros.

## Decisión 2 — `interest-expense-1.0.0`

El gasto de intereses es la primera base que cierra, y la salida la nombra:

1. `gross`: el bruto publicado;
2. `debt_plus_finance_leases`: el de la deuda más el de los arrendamientos
   financieros, que no se solapan;
3. `net_nonoperating`: el neto, cuando es un gasto. Subestima el bruto en lo que
   la empresa ganó de intereses, así que la cobertura queda algo alta;
4. `interest_paid`: lo pagado en el ejercicio, caja y no devengado.

El owner eligió las cuatro el 2026-10-22. Un neto que es ingreso no es un gasto y
no da cobertura. Sin ninguna base, `null`.

Para pasar del resultado antes de impuestos al EBIT (`netInterestForEbit`), el
neto vale con su signo: un neto de ingreso se resta. Así Nike, sin resultado
operativo ni intereses brutos, tiene EBIT en las señales de
`fundamental-profile-signals-1.1.0`, y el selector deja de abstenerse por falta
de evidencia de pérdidas. `completeness-profile-1.3.0` cuenta ese EBIT.

La cobertura que entra al costo de capital lleva `interestBasis` **sólo** cuando
no es el bruto, y el costo de capital lo declara
(`coverage_interest_net_nonoperating`, por ejemplo). Una corrida con el bruto
queda igual byte por byte: su hash no se mueve.

## Decisión 3 — una ventana vieja se baja otra vez

Hasta ahora, una ventana guardada con una selección anterior contaba como
presente (ADR 0051), y los conceptos nuevos no llegaban nunca. Desde
`F6-14`, si la última corrida anclada del CIK registra otra `selection_version`,
la corrida baja companyfacts **una vez**. El paso de datos lo dice
(`selectionOutdated`) y el job que continúa valúa con lo nuevo.

Una ventana vieja sigue sirviendo:

- un job que continúa a otro no la reemplaza;
- si la fuente está ocupada o sin cuota, se valúa con lo que hay.

Sólo se baja lo que falta: la ingesta publica lo nuevo y deja igual lo ya
publicado.

## Decisión 4 (`F6-15`) — deuda cero con evidencia

No publicar deuda no prueba que no haya (`TM-05`). Pero Vertex, Intuitive Surgical,
Align, Moderna, Expeditors y Deckers no tienen deuda financiera, y hoy no se
valúan. El owner decidió que la deuda vale cero sólo con evidencia: ningún
componente de deuda en los cinco ejercicios de la ventana y gasto de intereses
nulo o ausente. La base se nombra y el rigor baja un nivel. Es un cambio del
snapshot: va con su versión de la receta y su recálculo.

## Decisión 5 (`F6-15`) — EBIT sin resultado operativo

ADP, Merck, Eaton y D.R. Horton no publican `OperatingIncomeLoss`. El puente de
capitalización tomará `pretax + netInterestForEbit`, con la derivación congelada
(las dos observaciones y la base del interés) y recalculada por el motor.

## Consecuencias

- Una empresa ya guardada baja companyfacts una vez más la próxima vez que se la
  valúe: unas pocas requests de la SEC por empresa.
- La cobertura puede salir de un neto o de lo pagado, y la página lo dice.
- Las corridas registradas no cambian: ninguna regla del snapshot se movió.

## Límites

- Las empresas sin deuda y sin resultado operativo esperan a `F6-15`.
- La transcripción de opciones de empleados es `F6-16`.
