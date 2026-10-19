# ADR 0037: capitalización de arrendamientos operativos e I+D

- Estado: aceptado
- Fecha: 2026-10-19
- Alcance: `F4-01`. Decide cómo el motor reclasifica los arrendamientos
  operativos como deuda y la I+D como inversión, qué datos lo sostienen, de dónde
  sale la vida amortizable y cómo viaja el puente en la corrida.
- Decisiones relacionadas: [ADR 0017](0017-sec-history-window.md) (ventana de
  historia), [ADR 0019](0019-observation-history-prune.md) (poda),
  [ADR 0031](0031-on-demand-company-assessment.md) (evaluación y completitud),
  [ADR 0032](0032-damodaran-reference-datasets.md) (releases de Damodaran)

## Contexto

La metodología pide «capitalizar R&D cuando sea material y exista historia
suficiente» y «tratar leases de forma consistente entre EBIT, reinversión y
deuda». `fcff-1.0.0` no hace ninguna de las dos cosas: proyecta EBIT como
ventas por margen, y el margen, la reinversión y el puente EV-equity llegan como
inputs sin una base declarada. Una empresa que alquila sus tiendas o que gasta
el 15 % de sus ventas en investigación queda medida con un EBIT, un capital y
una deuda que no son comparables con los de una que compra sus activos.

Lo medido en la base personal el 2026-10-19:

- **I+D.** Doce empresas de la muestra publican `ResearchAndDevelopmentExpense`
  con seis ejercicios (la ventana de cinco más el cierre base); Johnson &
  Johnson, con cinco. Amazon no publica I+D: su «technology and
  infrastructure» es otro concepto y no se reinterpreta.
- **Arrendamientos.** 30 de 31 sujetos publican el pasivo por arrendamientos
  operativos de ASC 842 (`OperatingLeaseLiability` o sus partes corriente y no
  corriente). No se ingiere el gasto anual de arrendamientos ni el cronograma de
  pagos.

La referencia es Damodaran, _Valuing Companies with Intangible Assets_ (2009) y
su planilla `R&DConv.xls` (guardada por última vez el 2025-01-22), que trae una
hoja «Amortizable Lives Look-up Table» de 98 industrias.

## Decisión 1 — arrendamientos: el pasivo de ASC 842 y su interés implícito

`lease-capitalization-1.0.0`, decidido por el owner:

```text
lease_debt          = pasivo por arrendamientos operativos al cierre del ejercicio base
imputed_interest    = lease_debt × pre_tax_cost_of_debt
adjusted_ebit       = ebit + imputed_interest
invested_capital   += lease_debt
debt               += lease_debt          (claim propia del puente: leaseDebt)
```

Desde ASC 842 el balance ya publica el valor presente de los compromisos,
descontado a la tasa incremental del arrendatario: es exactamente la deuda que
el método completo de Damodaran reconstruye desde el cronograma. Lo que el EBIT
reportado todavía resta es el gasto lineal del arrendamiento, que mezcla
depreciación e interés; sumarle el interés implícito al costo de deuda antes de
impuestos de la corrida (`costOfCapital.preTaxCostOfDebt`) es la aproximación
que Damodaran propone cuando no se tiene el gasto. No pide conceptos nuevos ni
reingesta, y cada número se audita contra el balance del 10-K.

El pasivo se lee como `OperatingLeaseLiability` o, si falta, como la suma de
`OperatingLeaseLiabilityCurrent` y `OperatingLeaseLiabilityNoncurrent` **del
mismo cierre**; una sola de las dos partes no es el pasivo y queda `missing`.
Los arrendamientos financieros ya son deuda en el balance y no se tocan acá.
La beta de la industria de Damodaran ya incluye los arrendamientos en su D/E
desde 2019, así que el costo de capital es coherente con esta deuda.

## Decisión 2 — I+D: vida por industria, con la tabla de Damodaran

`rd-capitalization-1.0.0`, con las fórmulas del paper:

```text
research_asset  = Σ_{t=0..n-1} rd_{-t} × (n − t) / n
amortization    = Σ_{t=1..n}   rd_{-t} / n
adjusted_ebit   = ebit + rd_0 − amortization
invested_capital += research_asset
net_rd_reinvestment = rd_0 − amortization
```

Sin ajuste fiscal: la I+D es deducible entera, y el paper muestra que el
término `(1 − t)` se cancela.

La vida `n` sale de `rd-amortizable-life-1.0.0`, una tabla declarada que asigna
a cada una de las 96 industrias del dataset de betas una fila de la hoja de
Damodaran, con la fila citada: «Drugs (Pharmaceutical)» y «Drugs
(Biotechnology)» toman «Drug» (10), «Software (System & Application)» toma
«Computer Software & Svcs» (3), «Semiconductor» toma «Semiconductor» (5). Las
industrias que la hoja no nombra toman su categoría genérica (servicio no
tecnológico 2, servicio tecnológico o minorista 3, manufactura liviana 5,
manufactura pesada 10, investigación con patentes 10), y la tabla dice cuál.
Sin industria asignada no hay vida, y la I+D queda sin capitalizar con
`industry_unassigned`.

Las condiciones, en orden; la primera que falla deja la I+D **reportada** y la
nombra, nunca la completa con cero:

| Código                 | Cuándo                                                      |
| ---------------------- | ----------------------------------------------------------- |
| `not_reported`         | el emisor no publica I+D en el ejercicio base               |
| `industry_unassigned`  | no hay industria de Damodaran visible al corte              |
| `immaterial`           | `rd_0 / ventas_0 < 1 %` (umbral decidido por el owner)      |
| `insufficient_history` | falta alguno de los `n` ejercicios anteriores, consecutivos |

## Decisión 3 — diez ejercicios de I+D

Una vida de 10 años pide el ejercicio base y los diez anteriores, y la ventana
guarda cinco. El owner decidió extenderla sólo para la I+D, igual que la
evidencia de splits ya conserva un ejercicio más: `sec-history-5fy-2.0.0`
agrega un tercer corte (`ancla − 10 años − 14 días`) y `sec-core-concepts-4.0.0`
lo registra. Es un concepto anual por empresa: once puntos en lugar de seis.

La reingesta encontró que Johnson & Johnson publica su I+D recurrente sólo como
`ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost` (USD 14.665 M en
2025, historia desde 2007); con `ResearchAndDevelopmentExpense` declara la I+D
en proceso adquirida (109 M en 2025, cero en 2021 y 2022). Leída así, la regla
del 1 % la habría llamado inmaterial. La `4.0.0` selecciona ese concepto, que
también conserva diez ejercicios, y la serie anual lo prefiere: la I+D
adquirida es una compra, no gasto recurrente.

La poda es el complemento exacto de la ventana, así que tiene que conocer el
corte nuevo o la próxima poda borraría lo que la ingesta acaba de traer.
`sec-history-prune-1.1.0` agrega una lista de cortes por grupo de conceptos
(`concept_cuts`, migración `0029`); la evidencia de splits conserva su par de
columnas para que las podas ya registradas se lean igual. El rollback de `0029`
se niega mientras exista una poda con cortes de grupo.

Medido el 2026-10-19 al reingerir los 31 filers seguidos (unos 110 requests):
diez emisores quedan con once ejercicios de I+D, Moderna con diez (su historia
pública empieza en 2016) y Johnson & Johnson con once de la variante
recurrente. Traer 2015 obligó a leer los históricos más viejos de Incyte y
NVIDIA, y eso destapó los marcadores de fecha que corrige la enmienda de la
[ADR 0036](0036-sec-acceptance-clock.md).

## Decisión 4 — el puente viaja en la corrida y el motor lo recalcula

`ValuationInput.capitalization` (`capitalization-bridge-1.0.0`) lleva los hechos
con su provenance —la I+D de cada ejercicio, el pasivo y el EBIT reportado del
ejercicio base—, la vida y su fila de la tabla, el umbral, el costo de deuda de
`costOfCapital`, y el puente:

| Partida           | Reportado | Leases            | I+D                     | Ajustado |
| ----------------- | --------- | ----------------- | ----------------------- | -------- |
| EBIT              | `ebit`    | `+ interés impl.` | `+ rd_0 − amortización` | ...      |
| Capital invertido | —         | `+ lease_debt`    | `+ activo de I+D`       | Δ        |
| Deuda             | —         | `+ lease_debt`    | —                       | Δ        |

El capital invertido se publica como **delta**: el capital reportado es
normalización de `F4-03`, y un total armado acá sería una definición sin
versión.

El check `capitalization_recomputed` recalcula el puente desde los hechos y
rechaza un número escrito a mano, como `wacc_built_from_components` con el
costo de capital. La deuda por arrendamientos entra al puente EV-equity como
claim propia (`leaseDebt`), que el check exige igual a la del puente: nunca
mezclada en `debt`, donde se contaría dos veces o ninguna. Una I+D no
capitalizada viaja con su código.

El motor sube a `fcff-1.1.0` por la claim nueva; las corridas guardadas no se
reescriben (no hay ninguna real en la base personal). La metodología pasa a
`0.7.0`. El margen y la reinversión siguen siendo supuestos: el puente publica
el margen EBIT ajustado del ejercicio base al lado de ellos para que la base sea
visible, pero no los fija. Fijarlos es la normalización (`F4-03`) y los
escenarios (`F4-04`).

## Consecuencias

- Las empresas con arrendamientos tienen más deuda y más EBIT; con I+D
  creciente, más EBIT y más capital. Su ROIC y su margen ajustados son
  comparables con los de una empresa que compra sus activos.
- La completitud de `F3-02` ya mide `leases` y `research_development`; ahora
  esas comprobaciones tienen un consumidor.
- Reingerir a quienes publican I+D cuesta una descarga de companyfacts por
  filer.

## Alternativas descartadas

- **El método completo de arrendamientos** (cronograma de pagos y gasto anual):
  más fiel, pero ~8 conceptos nuevos, reingesta y dependencia de que cada filer
  etiquete el cronograma. El pasivo de ASC 842 ya es su valor presente.
- **Vida acotada a la ventana**: dejaba sin capitalizar a toda la farma.
- **Una vida única**: subestima farma y sobrestima software.
- **Capitalizar toda I+D positiva**: la metodología pide materialidad.
