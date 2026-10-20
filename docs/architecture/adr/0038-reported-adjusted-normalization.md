# ADR 0038: normalización reported/adjusted del ejercicio base

- Estado: aceptado
- Fecha: 2026-10-19
- Alcance: `F4-03`. Decide qué se normaliza del ejercicio base, con qué
  evidencia, qué regla versiona cada ajuste, cómo se arma el capital invertido
  reportado y cómo la deuda y la caja del puente EV-equity dejan de ser inputs.
- Decisiones relacionadas: [ADR 0017](0017-sec-history-window.md) (ventana),
  [ADR 0031](0031-on-demand-company-assessment.md) (evaluación),
  [ADR 0037](0037-lease-rd-capitalization.md) (capitalización)

## Contexto

La metodología pide que «reported y normalized se preserven en paralelo» y que
cada ajuste declare «monto, moneda, período, evidencia, regla y transformación
versionada». `F4-01` capitalizó arrendamientos e I+D, pero dejó dos cosas
pendientes, a propósito:

- el **capital invertido reportado**: la capitalización publica sólo su delta,
  porque un total armado allí sería una definición sin versión;
- el **puente EV-equity**: `debt` y `excessCash` siguen llegando como inputs
  del snapshot, sin regla que diga de qué hechos salen.

Además, el EBIT reportado incluye cargos de reestructuración y deterioros, que
la serie anual no ingería. Sondeado el 2026-10-19 sobre los 31 filers seguidos
(`companyfacts`, un request cada uno, payload fuera del repositorio):

- **Los conceptos de deterioro se solapan.** `AssetImpairmentCharges` incluye el
  goodwill en Carnival (2020: 4.063 M = 2.100 de goodwill + 1.794 de activos de
  largo plazo + otros) y no lo incluye en otros filers. Sumar conceptos cuenta
  dos veces sin que el filing diga cuándo.
- **Hay etiquetas que no son el cargo del año.** Norwegian publica
  `GoodwillImpairmentLoss` de 1.291 M cuatro ejercicios seguidos: es el
  acumulado.
- **La recurrencia es la regla, no la excepción.** Salesforce tiene
  reestructuración en cada uno de los últimos cuatro ejercicios, Caterpillar en
  los siete, Johnson & Johnson deterioros en los siete. Para Damodaran un cargo
  que vuelve es un costo del negocio.
- **La deuda no tiene un concepto.** Devon etiqueta los mismos 998 M como
  `LongTermDebtCurrent` y como `ShortTermBorrowings`; `LongTermDebt` es el total
  con vencimientos corrientes y `LongTermDebtNoncurrent` no los tiene; Exxon,
  American Tower y Charles River usan `LongTermDebtAndCapitalLeaseObligations`;
  Ford, Deere, Caterpillar y Moderna no publican sin dimensiones lo que haría
  falta para cerrar el total.

## Decisión 1 — un libro reported → ajustes → ajustado en la corrida

`ValuationInput.normalization` (`normalization-1.0.0`) lleva los hechos del
ejercicio base con su provenance **y su concepto**, cada ajuste como una
entrada del libro y lo que el libro deriva. Cada entrada declara:

- `id` y `target` (`ebit`, `invested_capital` o `debt`);
- `status`: `applied` o `not_applied` con su motivo —un ajuste que no se hace
  también se declara—;
- monto y moneda, ejercicio, regla con versión y las rutas de los hechos que lo
  sostienen.

El motor lo **recalcula** (`normalization_recomputed`, `reject`): un monto
escrito a mano no pasa, igual que el WACC o la capitalización. Los ajustes de
arrendamientos e I+D no se recalculan dos veces: el libro los toma de
`capitalization.ledger`, que ya tiene su check.

## Decisión 2 — capital invertido por el lado de la financiación

`invested-capital-1.0.0`, decidido por el owner, con la definición de
Damodaran:

```text
invested_capital_reported = equity + minority_interest + debt − cash
invested_capital_adjusted = invested_capital_reported + Δ capitalización (F4-01)
```

El goodwill queda adentro: el retorno se mide sobre lo que se pagó, incluidas
las adquisiciones. Si el patrimonio publicado ya incluye a los minoritarios
(`StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest`), no
se suman otra vez. Se mide al cierre del ejercicio base y la versión lo dice:
Damodaran usa el capital al inicio del año, pero el del inicio necesitaría la
capitalización del ejercicio anterior, que la corrida no congela. Con él el
libro publica el margen EBIT, el ROIC y el sales-to-capital ajustados del
ejercicio base, al lado de los supuestos: los informa, no los fija.

El ROIC usa la **tasa efectiva** del ejercicio base (`income_tax /
pretax_income`) y, cuando no existe —resultado antes de impuestos no positivo o
tasa fuera de `[0, 1]`—, la marginal del costo de capital, nombrando la base.
La marginal sigue siendo la del terminal y del escudo de la deuda.

## Decisión 3 — toda la caja es excedente

`excess-cash-1.0.0`, decidido por el owner: caja y equivalentes más las
inversiones líquidas, corrientes **y no corrientes**
(`MarketableSecuritiesNoncurrent`). Damodaran no reserva caja operativa para
empresas grandes, y un porcentaje de las ventas sería una decisión sin
evidencia por empresa. Los títulos no corrientes son títulos negociables —en
Apple, la mayor parte de su cartera—, no activos operativos. Sin caja publicada
el excedente queda `unresolved`; nunca vale cero.

## Decisión 4 — deuda por recetas que no se solapan

`reported-debt-1.0.0` arma la deuda con la **primera receta** cuyos conceptos
requeridos están, y la nombra:

| Receta                               | Componentes                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `current_plus_noncurrent`            | `DebtCurrent` (toda la deuda corriente) + no corriente (`LongTermDebtNoncurrent` o `LongTermDebtAndCapitalLeaseObligations`) |
| `long_term_total_plus_short_term`    | `LongTermDebt` (incluye los vencimientos corrientes) + `ShortTermBorrowings` o, si falta, `CommercialPaper`                  |
| `noncurrent_plus_current_maturities` | no corriente + `LongTermDebtCurrent` + `ShortTermBorrowings` o `CommercialPaper`                                             |

Más `FinanceLeaseLiability`, salvo que la no corriente sea
`LongTermDebtAndCapitalLeaseObligations`, que ya lo incluye. Un préstamo de
corto plazo **igual al centavo** a los vencimientos corrientes publicados es el
mismo saldo etiquetado dos veces (Devon) y no se suma: la salida lo nombra. Sin
receta, la deuda queda `unresolved` con los conceptos que faltan: la ausencia
de una etiqueta no prueba que no haya deuda.

## Decisión 5 — cargos no recurrentes con regla de recurrencia

`non-recurring-charge-1.0.0`, decidido por el owner. Dos categorías, cada una
**un solo concepto por ejercicio**, el primero de su lista, nunca una suma:

- reestructuración: `RestructuringCharges`;
- deterioro: `AssetImpairmentCharges`, `GoodwillAndIntangibleAssetImpairment`,
  `ImpairmentOfLongLivedAssetsHeldForUse`, `GoodwillImpairmentLoss`.

Tomar uno puede quedarse corto (Newmont publica deterioro de largo plazo y de
goodwill por separado) y ese es el error conservador: el ajuste sube el EBIT, y
la metodología no ajusta para producir un valor más atractivo.

El cargo del ejercicio base se revierte —con su signo: un recupero no
recurrente baja el EBIT— sólo si **ninguno de los cuatro ejercicios
anteriores** tuvo un cargo distinto de cero de la misma categoría, y los cuatro
están en la serie. Si no: `recurring` o `insufficient_history`. Una etiqueta
ausente en un ejercicio de la serie cuenta como sin cargo: los cargos de un
ejercicio se etiquetan, y exigir el cero explícito dejaría casi todo sin
evidencia. El acumulado mal etiquetado de Norwegian cae solo: se repite, y se
lee como recurrente.

ASC 420-10-45-3 y ASC 360-10-45-4 exigen la reestructuración y el deterioro de
activos de largo plazo dentro del subtotal operativo cuando el filer lo
presenta; el del goodwill (ASC 350-20-45-2) va antes del resultado de
operaciones continuas, y en la práctica también adentro. La regla supone que
el cargo está en `OperatingIncomeLoss`, y lo dice.

La compensación en acciones **no** se revierte: es un gasto (Damodaran). El
libro la declara como `not_applied` con su monto, para que la diferencia con un
EBIT «ajustado» de la empresa sea visible y no silenciosa.

## Decisión 6 — el puente EV-equity sale del libro

Decidido por el owner. `bridge.debt` y `bridge.excessCash` tienen que ser
exactamente lo que el libro deriva, igual que `leaseDebt` en `F4-01`: con la
deuda o la caja `unresolved`, la claim no puede ser `reported` y la corrida
queda en `missing`, que ya se rechaza. Un owner puede declararla ausente con
motivo; declarar un monto propio queda fuera de esta versión.

## Datos

`sec-core-concepts-5.0.0` agrega `RestructuringCharges`,
`AssetImpairmentCharges`, `GoodwillImpairmentLoss`,
`GoodwillAndIntangibleAssetImpairment`, `ImpairmentOfLongLivedAssetsHeldForUse`
y `LongTermDebtAndCapitalLeaseObligations`; los demás ya estaban.
`annual-fundamentals-1.2.0` agrega partidas propias para la regla de deuda
—sin tocar las que leen la completitud y las señales—, la reestructuración, el
deterioro, los títulos no corrientes y la compensación en acciones.

## Medición (2026-10-19)

La selección `5.0.0` se reingirió sobre los 31 filers seguidos con 114
requests (28 corridas `succeeded` y 3 `partial` por períodos de duración no
soportada, en cuarentena como siempre). Con `pnpm valuation:assess --offline`
sobre 20 no financieras:

- **Deuda**: 14 de 20 resueltas. `long_term_total_plus_short_term` en Apple
  (99.909 M con papeles y arrendamientos financieros), Amazon, Alphabet,
  Salesforce, Newmont, Duke, Freeport y Carnival; `current_plus_noncurrent` en
  NVIDIA, Johnson & Johnson y Exxon (arrendamientos financieros excluidos por
  estar en la no corriente); `noncurrent_plus_current_maturities` en American
  Tower y Charles River; Devon excluye su duplicado de 998 M. Sin resolver:
  Ford, Caterpillar, Deere, Incyte, Moderna y Norwegian.
- **Cargos**: se revierten el deterioro de Ford (9.435 M: EBIT −9.169 →
  2.593 M), Freeport (73 M) y Devon (254 M). Recurrentes y no revertidos: la
  reestructuración de Salesforce, J&J, Caterpillar, Charles River, Newmont,
  Duke y Carnival; el deterioro de Amazon (2022), J&J, American Tower, Newmont,
  Charles River e Incyte.
- **Tasa**: efectiva en 17; Ford y Charles River caen a la marginal por
  resultado antes de impuestos no positivo; Moderna queda sin tasa porque la
  evaluación no armó su costo de capital (en una corrida siempre hay marginal).
- **Compensación en acciones**: visible y no revertida, de 24.953 M en Alphabet
  a 71 M en Charles River.

## Consecuencias

- El motor sube a `fcff-1.3.0` y la metodología a `0.9.0`; las corridas
  guardadas no se reescriben.
- Una empresa sin receta de deuda no se valúa hasta que haya una declaración
  del owner con monto, que es otro slice.
- `F4-04` (escenarios) y `F4-05` (dilución) parten de una base ajustada
  declarada en vez de inputs sueltos.
