# ADR 0060: la brecha frente a lo demás que se valuó

- Estado: aceptado
- Fecha: 2026-10-27
- Alcance: `F6-19`. Regla `valuation-peer-context-1.0.0`, de lectura. No
  cambia el snapshot, sus hashes, el motor, la metodología ni el job.
- Decisiones relacionadas: [ADR 0016](0016-analysis-scope-sector-matrices.md),
  [ADR 0025](0025-declared-sector-classification.md),
  [ADR 0048](0048-market-price-implied-expectations.md),
  [ADR 0058](0058-didactic-valuation-result.md)

## Contexto

La página de una corrida dice dónde cae el precio respecto del valor, pero no
si esa brecha es de la empresa, de su sector o del modelo. Un DCF que valúa
casi todo por debajo del mercado produce una brecha en todas las empresas, y
leerla como propia de una de ellas es un error.

Se midió lo guardado el 2026-10-27:

| Base     | Corridas | Empresas | Sectores con valuadas               |
| -------- | -------: | -------: | ----------------------------------- |
| personal |       10 |        2 | Consumer Discretionary, IT          |
| Neon     |       15 |        3 | Consumer Discretionary, Staples, IT |
| réplica  |       27 |        5 | además Energy y Materials           |

Ningún sector tiene más de dos empresas valuadas.

## Decisiones del owner (2026-10-27)

1. **Ventana.** Un par cuenta si su última corrida tiene un `as_of` entre
   siete días antes del de la empresa y el mismo día. Fuera de la ventana no
   cuenta.
2. **Estados.** Entran `computed` y `requires_review`. Las cíclicas siempre
   quedan en revisión (ADR 0059); sin ellas, Energy y Materials quedarían
   vacíos. Cada mediana dice cuántos de sus `n` están en revisión.
3. **Múltiplos.** P/E y EV/EBIT salen **sólo de las empresas valuadas**, no de
   toda la población del sector.
4. **Sin lote.** La valuación por sector sale del slice. La comparación crece
   con lo que el owner valúa, coherente con la ADR 0016, y no gasta IA por
   adelantado.

## Decisión — tres lecturas separadas

`valuation-peer-context-1.0.0` arma, al render:

- **el modelo**: la mediana de precio sobre valor de todas las corridas de la
  ventana, de cualquier sector, sin la empresa;
- **el sector**: la mediana de precio sobre valor, P/E y EV/EBIT entre los
  pares de su sector;
- **la empresa**: sus tres cifras y cada una frente a la mediana del sector,
  como `empresa ÷ mediana − 1`. También el sector frente al modelo.

Con menos de **tres** valores no hay mediana: la lectura dice «pares
insuficientes» con su `n`. Con `n` par, la mediana es el promedio exacto de
los dos del medio.

### Las cifras de cada corrida

Cada cifra usa el cierre del día de **su propia** corrida y pasa por
`market-price-comparison-1.0.0`. Si no hay cierre, la moneda no coincide o hay
un split entre la base de acciones y el cierre, las tres cifras quedan nulas
con ese motivo.

- **Precio sobre valor**: el de la comparación.
- **P/E**: capitalización (cierre × acciones de carátula del snapshot) sobre
  la ganancia neta reportada del ejercicio base, leída de la serie anual al
  corte de esa corrida. Se exige el mismo cierre de ejercicio que el base.
  Si falta, es cero o negativa, o está en otra moneda, el P/E es nulo con su
  motivo.
- **EV/EBIT**: (capitalización + deuda + deuda por arrendamientos +
  minoritarios − caja) sobre el EBIT ajustado del año base. Son los montos
  del puente y de la normalización de la corrida, así que el EV y el EBIT son
  los del modelo, con los arrendamientos de los dos lados. Un reclamo
  `declared_absent` vale cero porque tiene su motivo escrito; uno `missing` no
  se completa y deja el múltiplo nulo. EBIT o EV no positivos también lo
  dejan nulo.

El sector de la empresa y de cada par se lee al corte de la corrida de la
empresa: un par reclasificado después no cambia de grupo en una lectura
anterior. La ganancia neta sólo se lee para los pares del sector.

### Lectura

`ValuationRunRepository.listLatestInWindow` devuelve una corrida por empresa
—la de `as_of` más reciente y, en empate, la registrada última— entre
`fcff_base` y `normalized_fcff`, con valor por acción. El techo es 600
empresas; superarlo es un error, no un truncado. No hay migración: la tabla
es chica y la consulta usa `DISTINCT ON`.

## Consecuencias

- La página gana la sección «Frente a sus pares», después de «Qué tendría que
  pasar». Es una tabla: con estas `n`, un gráfico no agrega nada.
- Una corrida registrada después puede entrar a la ventana de una anterior:
  la lectura es del render y puede cambiar al volver a abrir la página. Nada
  de esto entra al snapshot.
- Valuar más empresas del mismo sector en la misma semana es lo que da
  medianas. La ventana de siete días hace que una empresa valuada días
  después del resto todavía compare.

## Medición

En la réplica, con las corridas de `F6-18`:

- FCX: P/V 1,53, P/E 42,46 y EV/EBIT 16,88.
- CVX: P/V 2,79, P/E 37,27 y EV/EBIT 24,18. Se recalculó a mano: USD 232,01 ×
  1.976 M de acciones son USD 458.000 M, y con P/E 37,27 dan una ganancia neta
  de USD 12.300 M.
- AAPL: P/V 1,84, P/E 43,39 y EV/EBIT 33,96.

En las tres los pares son insuficientes: `n` va de 0 a 2. Axe no tuvo
hallazgos en la sección, y no hubo desborde en 1280 px claro ni en 390 px
oscuro.
