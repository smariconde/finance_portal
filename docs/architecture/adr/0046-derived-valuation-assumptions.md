# ADR 0046: los supuestos de una corrida por ticker se derivan de lo guardado

- Estado: aceptado
- Fecha: 2026-10-21
- Alcance: `F6-07`. Arma el snapshot `fcff_base` de una empresa desde lo que la
  base ya tiene, corre el motor y registra la corrida en `valuation_runs`. No
  muestra el valor, no baja fundamentals y no llama al modelo.
- Decisiones relacionadas: [ADR 0045](0045-ticker-valuation-job.md) (el job),
  [ADR 0038](0038-reported-adjusted-normalization.md) (el ejercicio base
  ajustado), [ADR 0040](0040-failure-probability-employee-options.md) (las
  opciones de empleados), [ADR 0039](0039-coherent-valuation-scenarios.md)
  (escenarios)

## Contexto

`F6-01` dejó el job terminando en `snapshot_not_assembled`. Todo lo que el
snapshot necesita ya existe y se recalcula —selección, completitud, rigor,
costo de capital, capitalización, normalización, equity de empleados,
probabilidad de fracaso—, salvo los supuestos: crecimiento, margen, impuesto,
WACC y reinversión por período, más el terminal. En el repositorio sólo los
escribían a mano los fixtures.

Sin ellos `F6-02` no tiene corridas que listar y el gate de la Fase 6 —«un
ticker escrito produce una valuación completa, persistida y reproducible»—
queda fuera de alcance. El owner eligió, entre derivarlos por código,
proponerlos con la IA o declararlos por ticker, **derivarlos por código** como
slice propio antes de `F6-02`, dejando lugar a una declaración del owner que
la pise más adelante.

## Decisión 1 — una regla versionada, `derived-assumptions-1.0.0`

Diez años explícitos. Los cinco primeros sostienen el punto de partida y los
cinco siguientes convergen en línea recta al terminal (el esquema de dos
etapas de Damodaran):

| Supuesto              | Años 1–5                                     | Años 6–10         | Terminal             |
| --------------------- | -------------------------------------------- | ----------------- | -------------------- |
| Crecimiento de ventas | CAGR de las ventas reportadas                | → libre de riesgo | libre de riesgo      |
| Margen EBIT           | ajustado del ejercicio base                  | igual             | igual                |
| Impuesto              | tasa aplicada del ejercicio base             | → marginal        | marginal             |
| WACC                  | el de la corrida                             | → WACC terminal   | WACC terminal        |
| Reinversión           | sales-to-capital ajustado del ejercicio base | igual             | ROIC = WACC terminal |

- El CAGR usa la racha de ejercicios **consecutivos** que termina en el año
  base: tres como mínimo (dos tasas) y seis como máximo (cinco tasas, lo que
  guarda la ventana de la ADR 0017). Un hueco corta la racha. Una historia en
  caída da un crecimiento negativo: no se recorta a cero.
- `g` terminal igual a la libre de riesgo es el techo que `F4-02` ya exige, y
  un ROIC terminal igual al WACC terminal es el supuesto de Damodaran de que
  los retornos en exceso no duran para siempre. Las dos cosas hacen que el
  valor terminal no dependa de `g`: es conservador a propósito.
- El margen y el sales-to-capital no convergen a la industria porque el
  dataset de márgenes de Damodaran no está ingerido. Es la primera cosa que
  una `2.0.0` debería cambiar.
- Sensibilidad: WACC terminal ± 2 puntos de a uno y `g` de 0 a 4 % de a uno.
- Sin escenarios: un bear y un bull derivados por regla serían otro
  multiplicador, que la ADR 0039 prohibió.

Lo que no alcanza se nombra: `revenue_history_insufficient`,
`revenue_history_non_positive`, `base_margin_unavailable`,
`sales_to_capital_unavailable`, `tax_rate_unavailable`.

## Decisión 2 — la derivación viaja en el snapshot y se recalcula

`ValuationInput.derivedAssumptions` congela lo único que no estaba ya en el
snapshot: la historia de ventas. El check `assumptions_derived_recomputed`
(`reject`) reconstruye períodos, terminal y sensibilidad desde esa historia,
la normalización y el costo de capital de la corrida, y exige que la primera
venta sea el `baseRevenue`, el método `fcff_base` y ningún escenario. Un
supuesto escrito a mano encima de una derivación es un rechazo.

El campo es **opcional**. Sin él el check no corre, así que los snapshots
anteriores —la corrida de referencia, las corridas guardadas— conservan sus
checks y sus hashes. Por eso no cambian `fcff-1.6.0` ni la metodología
`0.12.0`.

## Decisión 3 — el ensamblado, `valuation-snapshot-1.0.0`

`assembleValuationSnapshot` es pura: recibe la evaluación de la Fase 3, la
transcripción de opciones aceptada al corte, las acciones de la carátula y la
serie de precios, todo ya leído. Sólo arma `fcff_base`; para cualquier otro
método el job nombra `method_not_derived`.

- **Fecha de valuación**: el último cierre guardado que el corte admite; sin
  serie, el día del corte.
- **Puente**: la deuda y la caja son las que deriva la normalización y los
  arrendamientos los de la capitalización; sin receta quedan `missing` y la
  corrida se rechaza con nombre. Un pasivo por arrendamiento que no se publica
  y un minoritario que no aparece en el balance se declaran ausentes con ese
  motivo. **Activos no operativos y otras claims se declaran ausentes con el
  nombre de la regla**: ninguna receta los lee todavía, y el motivo lo dice.
- **Opciones de empleados**: sin una transcripción aceptada al corte el
  snapshot no se arma (`employee_equity_not_proposed`). El worker no la pide:
  `pnpm valuation:employee-equity --ticker … --apply` gasta IA y es del owner.
  Con opciones vivas hace falta el cierre del `as_of` y cinco años de serie
  (`market_unavailable`).

Lo que alcanza para un snapshot pero no pasa un check **se valúa igual**: una
corrida `rejected` con motivo también es audit trail (`TM-16`).

## Decisión 4 — el job registra la corrida, `valuation-job-1.1.0`

Migración `0032`: el hueco `run_recorded`, el motivo `snapshot_gap` y la
corrida `valuation_run_id` (FK a `valuation_runs`) con su `run_status`. Un
job `1.1.0` en `snapshot_not_assembled` siempre nombra el motivo; uno `1.0.0`
conserva lo que dijo. Un job encolado bajo `1.0.0` termina bajo la regla del
worker que lo corrió.

El valor `run_recorded` se agrega al enum en la misma transacción de la
migración y PostgreSQL no deja usarlo ahí, así que los checks lo comparan
como texto. El rollback se niega mientras exista una fila `1.1.0` y
reconstruye el tipo.

Registrar es idempotente por clave de replay: volver a encolar el mismo
ticker con el mismo snapshot devuelve la corrida que ya estaba. La vista
pública devuelve el estado de la corrida, nunca su ID ni su valor; mostrarlo
es `F6-03`.

## Consecuencias

- Medido sobre una réplica de la base personal el 2026-10-21: AAPL y AMZN
  terminan `run_recorded` con la corrida `computed` y ningún check fallado, y
  las dos se reproducen con `pnpm valuation:replay`. GOOGL frena en
  `employee_equity_not_proposed` (la escalera no encontró la nota) y JNJ en
  `base_margin_unavailable`: no publica EBIT.
- En la base personal hoy toda empresa `fcff_base` frena en
  `employee_equity_not_proposed`: no hay transcripciones guardadas ahí.
- `F6-02` ya tiene corridas que listar.

## Alternativas descartadas

**Supuestos propuestos por la IA.** Gasta en cada corrida, necesita evals y
deja un número que depende de un modelo. Puede llegar después como propuesta
bajo policy, igual que el mix geográfico.

**Supuestos declarados por el owner.** Es la palanca correcta para una
empresa que el owner conoce, pero no escala como default. Queda como
precedencia futura sobre la regla.

**Converger el margen a un objetivo de industria inventado.** Sin el dataset
de márgenes sería un número sin fuente.
