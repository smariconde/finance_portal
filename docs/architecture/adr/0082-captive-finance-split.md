# ADR 0082: la financiera cautiva se separa

- Estado: aceptado
- Fecha: 2026-11-18
- Alcance: `F6-23`.
- Decisiones relacionadas: [ADR 0038](0038-reported-adjusted-normalization.md)
  (normalización y recetas de deuda),
  [ADR 0053](0053-reported-concept-coverage.md) (bases de intereses),
  [ADR 0054](0054-zero-debt-evidence-derived-ebit.md) (deuda cero y EBIT
  derivado), [ADR 0059](0059-derived-cycle-normalization.md) (cíclicas),
  [ADR 0081](0081-ttm-base-period.md) (año base TTM)

## Contexto

`F6-18` dejó a CAT y DE sin corrida: ninguna receta de `reported-debt` cierra
y el job termina en `sales_to_capital_unavailable`. Antes de decidir medimos el
último 10-K de seis emisores del índice con financiera cautiva, en companyfacts
y en el instance XBRL de la presentación (millones de USD):

| Emisor | Deuda consolidada | Industrial | Financiera | Sin dimensión (companyfacts)                                 | Apertura en el instance                              |
| ------ | ----------------- | ---------- | ---------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| CAT    | 43.330            | 10.713     | 32.617     | no corriente y préstamos; vencimientos sólo en el cronograma | `ProductOrServiceAxis`                               |
| DE     | 57.340            | —          | —          | `DebtCurrent`; el largo plazo en un elemento propio `de:`    | **no**: Equipment / Financial Services sin etiquetar |
| GM     | 131.574           | 16.247     | ~115.000   | sólo el total de la guardia                                  | `BusinessGroupAxis`                                  |
| F      | 163.336           | 21.919     | 141.417    | nada                                                         | `StatementBusinessSegmentsAxis`                      |
| PCAR   | 15.666            | sin línea  | 15.666     | nada                                                         | sólo la financiera                                   |
| TXT    | 3.878             | 3.539      | 339        | nada                                                         | `ConsolidatedEntitiesAxis`                           |

Como control, IBM (IBM Financing adentro), Honeywell y Cummins ya resuelven con
las recetas actuales.

El EBIT consolidado (`OperatingIncomeLoss`) de CAT, GM y F ya descuenta el
interés de la financiera: está arriba del resultado operativo. DE, PCAR y TXT no
publican resultado operativo, y el EBIT de `ebit-from-pretax-1.0.0` le devuelve
el interés que elige `interest-expense-1.0.0`, que en PCAR es el de la
financiera. La caja no tiene una apertura pareja: CAT y GM no etiquetan la caja
industrial ni la de la financiera.

## Decisión 1 — separar la financiera (owner, 2026-11-18)

Con la tabla a la vista, el owner eligió el criterio de Damodaran: **la deuda
que se resta es la industrial**. La financiera queda dentro del negocio como
capital neto: su ganancia después de sus propios intereses ya está en el EBIT, y
sus activos netos de su deuda, en el capital invertido. Sumar su deuda como
deuda de la empresa valuaría un negocio de diferencial con el WACC industrial y
restaría dos veces lo que el EBIT ya descontó.

La alternativa consolidada (toda la deuda, con el EBIT antes de todo interés) y
el rechazo trazable de todas se descartaron.

## Decisión 2 — declarada por CIK, leída del instance

Qué miembro es la parte industrial **se declara**, como una sucesión: nada en la
presentación dice cuál de sus segmentos es la financiera.
`captive-finance-declarations-1.0.0` guarda por CIK el nombre de la financiera y,
para cada uso, un eje y un miembro (nombres locales, sin prefijo):

- la deuda industrial (CAT `MachineryPowerEnergyMember`, GM `AutomotiveMember`,
  F `CompanyExcludingFordCreditMember`, TXT `ManufacturingGroupMember`, PCAR
  `TruckPartsAndOtherMember`);
- el interés industrial, que puede ser otro miembro (CAT
  `AllOtherExcludingFinancialProductsMember`);
- la deuda de la financiera, que sólo se muestra.

DE se declara **sin apertura etiquetada**: el job la nombra en vez de caer en
`no_recipe`.

companyfacts no trae dimensiones, así que el dato sale del instance XBRL del
10-K: el `<documento primario>_htm.xml` que EDGAR extrae del iXBRL, en la misma
carpeta que el 10-K. `sec-xbrl-instance-1.0.0` es un lector cerrado: contextos
con un solo miembro explícito y sin miembro tipado, hechos `us-gaap` numéricos
en USD, y un concepto con dos valores distintos en el mismo contexto se
descarta por nombre.

## Decisión 3 — `captive-finance-split-1.0.0`

Sobre el 10-K visible al corte cuyo cierre es el del ejercicio base:

1. **Deuda industrial**: las mismas partidas y las mismas recetas de
   `reported-debt-1.0.0`, aplicadas a los hechos del miembro industrial. Sin
   receta, `industrial_debt_unresolved`.
2. **Interés industrial**: la regla de `interest-expense-1.0.0` sobre los hechos
   del miembro del interés en el ejercicio (de 357 a 373 días). Sin gasto,
   `industrial_interest_missing`.
3. **EBIT**: tiene que ser el resultado operativo publicado. Uno derivado del
   resultado antes de impuestos no prueba que ya descuente el interés de la
   financiera: `ebit_derived_from_pretax`.

La cobertura del rating sintético es el EBIT sobre el interés industrial
(`coverage_interest_industrial_only`): con el interés consolidado, GM tendría
una cobertura de 0,44 y un rating de bono basura.

La caja sigue consolidada, y la corrida lo dice: la caja de la financiera cuenta
como excedente, lo que sobrestima el valor en ese monto (Ford Credit tiene unos
9.270 M). Es una aproximación nombrada, no un dato.

La apertura se lee al 10-K: una corrida que la usa queda con año base anual
(`captive_finance_split`), porque el balance industrial del 10-Q no se leyó.

## Decisión 4 — cómo viaja

El job lee el 10-K cuando el CIK está declarado (submissions y el instance, dos
pedidos medidos) y vuelve a evaluar con la apertura, como la nota financiera de
`F6-20`. No hay tabla nueva: la apertura se congela en
`normalization.facts.captiveFinance` (opcional, así que los snapshots anteriores
conservan su hash), con cada hecho fechado en la aceptación del 10-K y el
miembro en sus `qualityFlags`. `normalization_recomputed` recalcula la deuda
desde esos hechos, y `captive_finance_split_consistent` exige que la cobertura
sea la industrial del mismo ejercicio y que el año base sea anual. El motor y
la metodología no cambian de versión.

Sin apertura, el job no arma el snapshot y nombra el motivo:
`captive_finance_not_tagged` (DE), `captive_finance_filing_unavailable`,
`captive_finance_debt_unresolved` (PCAR), `captive_finance_interest_missing` y
`captive_finance_ebit_derived` (TXT). Agregarlos al check de
`valuation_jobs.snapshot_gap` es la migración `0054`.

## Consecuencias

- CAT, GM y F pueden llegar a una corrida; DE, PCAR y TXT terminan en un motivo
  nombrado, nunca en una deuda inventada.
- Un pedido más al 10-K por job de una empresa declarada. El instance pesa
  entre 3 y 12 MB, por debajo del techo de 32 MB de `sec-edgar`.
- `valuation:assess --offline` no lee la red: muestra la apertura como pendiente.
- Queda para otro slice la caja industrial, el EBIT derivado de TXT y PCAR, y
  una transcripción de la tabla complementaria de DE.

## Medido después

Con el job real sobre una réplica de la base personal (descarga e IA, USD
0,009 en total):

| Emisor | Resultado                                                      | Deuda que se resta | Cobertura → rating | Valor por acción |
| ------ | -------------------------------------------------------------- | ------------------ | ------------------ | ---------------- |
| CAT    | `normalized_fcff`, `requires_review` (modelo de ciclo)         | 10.713 M           | 22,2 → Aaa/AAA     | 393,45           |
| GM     | `normalized_fcff`, `requires_review` (modelo de ciclo)         | 16.247 M           | 4,0 → A3/A−        | 130,06           |
| F      | separa la deuda; frena en `shares_outstanding_unavailable`     | —                  | —                  | —                |
| DE     | `captive_finance_not_tagged`, sin gasto de IA                  | —                  | —                  | —                |
| TXT    | `captive_finance_ebit_derived`, sin gasto de IA                | —                  | —                  | —                |
| PCAR   | `missing_required_input`: no publica EBIT ni caja consolidados | —                  | —                  | —                |

Las 18 corridas de la réplica, las dos nuevas incluidas, se reproducen sin red
con sus hashes. Ford publica dos clases en la carátula y eso es otro slice. La
evaluación de PACCAR sin apertura mostró que la evidencia de deuda cero podía
leer como cero una consolidada que companyfacts no muestra: un emisor declarado
nunca la usa.
