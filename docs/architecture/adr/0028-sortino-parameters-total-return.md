# ADR 0028: parámetros del Sortino y base total return

- Estado: aceptado
- Fecha: 2026-09-30
- Alcance: resuelve `F7-04`. Fija los parámetros que la
  [ADR 0016](0016-analysis-scope-sector-matrices.md) §4 dejó para el owner, define
  la base de retorno (`total-return-1.0.0`) y la fórmula (`sortino-1.0.0`), y
  corrige dos defectos de la ingesta de precios que esa base destapó. No decide
  cómo se ingiere ni dónde se guarda la serie de la referencia, ni cómo la matriz
  la dibuja (`F7-05`).
- Decisiones relacionadas: [ADR 0003](0003-decimal-arithmetic-valuation-engine.md)
  (aritmética decimal), [ADR 0016](0016-analysis-scope-sector-matrices.md) (la
  matriz y su fórmula), [ADR 0017](0017-sec-history-window.md) (el margen de 14
  días), [ADR 0026](0026-daily-prices-source.md) (serie cruda, dividendos sin
  aplicar)

## Contexto

La ADR 0016 fijó la forma de la fórmula:

```text
excess_t            = r_t − mar
downside_deviation  = sqrt( (1/N) · Σ min(0, excess_t)² )     sobre los N períodos
sortino             = mean(excess_t) / downside_deviation · sqrt(k)
```

Dejó abiertos el retorno mínimo aceptable, la frecuencia, la base de retorno, la
referencia y los límites de la ventana. `03_DATA_AND_PROVENANCE.md` agregó el
numerador y las clases de un mismo emisor con recomendación inicial.

## Decisión 1 — los parámetros, decididos por el owner el 2026-09-30

| Parámetro          | Decisión                                                      | Por qué                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mar`              | **cero**                                                      | Una tasa libre de riesgo sería una fuente nueva, con su ADR, derechos, cuota y serie point-in-time. Un `mar` común mueve a todos los puntos del sector y a la referencia por igual, y la pregunta de la matriz es comparativa. |
| Frecuencia         | **diaria, `k = 252`**                                         | Unos 500 retornos a 2 años y 1.250 a 5: la desviación a la baja se estima con cientos de observaciones negativas. La mensual deja 24 retornos a 2 años y un Sortino inestable. Usa la serie tal como está guardada.            |
| Base de retorno    | **total return**, dividendo reinvertido al cierre del ex-date | Sólo precio castiga a quien paga dividendos altos. Medido: JPM a 5 años da 1,17 en total return y 1,01 sólo precio.                                                                                                            |
| Referencia         | **`^SP500TR`**                                                | El índice total return oficial reinvierte en el ex-date, como `total-return-1.0.0`, y no carga el 0,09 % anual de gastos de un ETF. La allowlist de Yahoo (`/v8/finance/chart/`) ya lo alcanza.                                |
| Límites de ventana | **calendario**                                                | De `as_of` menos 2 o 5 años a `as_of`. La base del primer retorno es el último cierre en o antes del inicio. Un 29 de febrero cae en el 28, con la misma regla que la ventana de la SEC.                                       |
| Numerador          | media aritmética                                              | La definición estándar; ya era la recomendación.                                                                                                                                                                               |
| Clases de emisor   | todas, un punto por security                                  | Ya fijado por la ADR 0016.                                                                                                                                                                                                     |

Los parámetros son **parte de la versión**. `SORTINO_PARAMETERS` los congela, y
cambiar cualquiera de ellos crea otra fórmula, no otro argumento.

## Decisión 2 — `total-return-1.0.0`

Cada retorno se expresa en la base de la rueda anterior:

```text
r_t = ( P_t × Π ratio(s)  +  Σ D_d × Π ratio(s) ) / P_{t−1} − 1
             s ∈ (t−1, t]         d ∈ (t−1, t]   s ∈ (t−1, d]
```

- **El split entra en la tenencia.** Así, el día del 10:1 de NVDA no es una caída
  del 90 %.
- **El dividendo se reinvierte al cierre de su ex-date.** Si cae el mismo día que
  un split, ya está en la base nueva y se cobra sobre las acciones nuevas.
- **Un evento en un día sin rueda cae en el cierre siguiente**, que es cuando el
  mercado lo refleja.
- **No se puede componer, y se nombra:**
  - una moneda distinta, en el cierre o en el dividendo, es `currency_mismatch`;
  - un cierre en cero es `non_positive_close`.

## Decisión 3 — `sortino-1.0.0` y sus `null`

La fórmula es pura. Ignora todo cierre y todo evento posterior al `as_of`, y eso
es exacto y no una aproximación: la serie guardada es cruda y un split futuro no
la cambia. Cuando no da número, devuelve `null` con un motivo y nunca un cero ni
un infinito:

| Motivo                     | Cuándo                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `no_close_at_as_of`        | La security no tiene cierre en el `as_of`: su ventana no terminaría donde las demás. |
| `insufficient_history`     | No hay cierre en o antes del inicio de la ventana. La ventana no se acorta.          |
| `missing_period`           | Dos cierres consecutivos separados por más de 5 días de calendario.                  |
| `no_downside_observations` | Ningún exceso negativo: el denominador es cero.                                      |
| `currency_mismatch`        | Ver la decisión 2.                                                                   |
| `non_positive_close`       | Ver la decisión 2.                                                                   |

La tolerancia de 5 días admite un fin de semana largo con feriado, que son 4
días, más un cierre extraordinario del mercado. Una entrada que viola el contrato
—dos cierres para la misma rueda, un número que no es decimal canónico— lanza
`MetricInputError`: no es un dato que falta, sino una serie que no debió llegar.

El resultado lleva lo necesario para auditarlo:

- la base y el inicio de la ventana;
- `N` y los retornos negativos;
- la media del exceso y la desviación a la baja;
- la versión de la fórmula.

## Decisión 4 — un catálogo de métricas acotado a las matrices

`metric-catalog-1.0.0` registra `sortino_2y` y `sortino_5y` como implementadas,
con la fórmula, la unidad, la periodicidad, qué significa un negativo y los
motivos de `null`.

Las métricas de divergencias (`market_cap_cagr_pct`, `diluted_eps_cagr_pct`,
`net_income_cagr_pct`, `price_cagr_pct`, `fundamental_gap_pp` y
`share_count_bias_pp`) entran como `planned`, sin versión de fórmula:

- su definición la fija la ADR 0016 §5;
- su fórmula se escribe en `F8-01`;
- el catálogo las nombra para que las dos matrices no inventen dos vocabularios,
  pero no finge que se calculan.

El esquema no admite una métrica implementada sin versión ni una planeada con
una. La valuación versiona sus fórmulas en su propio módulo y entra al catálogo
cuando la Fase 3 la exponga a comparaciones.

## Decisión 5 — dos defectos de la ingesta de precios, corregidos

La base total return los destapó; con sólo precio habrían seguido invisibles.

**1. Los dividendos estaban en la base de la fuente.** Yahoo divide los
dividendos por los splits posteriores, igual que los cierres, y
`price-unadjust-1.0.0` sólo des-ajustaba los cierres.

- NVDA pagó US$ 0,04 el 2024-03-05 y quedó guardado como 0,004, al lado de un
  cierre crudo de 859,64.
- Afectaba a 10 de los 60 dividendos de la base personal: todos los de NVDA
  anteriores a su 10:1.
- **`price-unadjust-1.1.0`** los des-ajusta con el mismo factor que los cierres,
  y la fila deja de cambiar con cada split futuro.

**2. Un evento que cambiaba de valor se contaba como duplicado.** La escritura de
eventos usaba `onConflictDoNothing`. Ahora, igual que un cierre:

- se lee lo guardado;
- un valor distinto se reporta en `eventsConflicting`;
- no se pisa.

Verificado en una réplica de la base personal: la re-descarga de NVDA nombra los
10 dividendos y deja las filas como estaban.

**3. La historia pedida no alcanzaba para la ventana de 5 años.** Con
`range=5y`, las tres series guardadas empezaban el 2021-09-23, un día **después**
del inicio de una ventana de 5 años al último cierre. Las tres habrían sido
`insufficient_history`. La ingesta ahora pide `period1`/`period2` explícitos:

- cinco años de calendario más 14 días, el mismo margen que la ventana de la SEC
  ([ADR 0017](0017-sec-history-window.md));
- el costo es de unas 10 filas por security.

### Corrección de las filas ya guardadas

Una fila cruda es inmutable, y la re-descarga no pisa un evento en conflicto. Los
dividendos guardados con la regla vieja se corrigen a mano:

1. Borrar los dividendos anteriores a un split de la misma security, que son
   exactamente los que la regla vieja dejó mal:

   ```sql
   delete from price_events d
   where d.event_type = 'dividend'
     and exists (
       select 1 from price_events s
       where s.security_id = d.security_id
         and s.event_type = 'split'
         and s.effective_on > d.effective_on
     );
   ```

2. Correr `pnpm prices:ingest --ticker … --apply` para esas securities: los
   dividendos vuelven crudos, y el margen de historia entra en la misma corrida.

## Medición

Sobre una réplica de la base personal, con la corrección aplicada y `as_of`
2026-09-30:

| Security | 2 años total return | 5 años total return | 5 años sólo precio | Retornos (2a / 5a) |
| -------- | ------------------: | ------------------: | -----------------: | ------------------ |
| AAPL     |              1,1530 |              1,1395 |             1,1127 | 501 / 1.254        |
| NVDA     |              1,3776 |              1,8473 |             1,8445 | 501 / 1.254        |
| JPM      |              1,6549 |              1,1652 |             1,0076 | 501 / 1.254        |

Cada ventana se calcula en 5 a 28 ms con aritmética decimal de 34 dígitos. Un
sector de 70 securities, a dos ventanas cada una, queda en el orden de dos o tres
segundos si se calcula todo al pedir la matriz.

## Límites declarados

1. **La tolerancia de huecos es de calendario, no de sesiones.** Un día hábil
   suelto que falta en mitad de semana no supera los 5 días. En ese caso el
   retorno siguiente abarca dos ruedas y `N` pierde una. Con la serie de la
   referencia en la base, `F7-05` puede contar sesiones contra su calendario; eso
   sería `sortino-1.1.0`.
2. **La referencia todavía no se ingiere.** `^SP500TR` no es una security del
   grafo de identidad. Dónde se guarda su serie y cómo se la nombra se decide en
   `F7-05`. **Resuelto** por la [ADR 0029](0029-reference-series-sector-risk-matrix.md):
   la serie vive en `benchmark_prices`.
3. **Un cierre del día en curso se guardaría como definitivo.** La ingesta no
   distingue una rueda abierta de una cerrada. Correrla con el mercado abierto
   guarda un precio intradía como cierre inmutable, y el cierre real de esa
   rueda después aparece como pasado cambiado. Es un defecto de `F7-01`,
   registrado para corregirse antes de automatizar la ingesta. **Resuelto** por
   la ADR 0029 con `settled-session-1.0.0`.
4. **`mar = 0` no es un exceso sobre la tasa libre de riesgo.** Un Sortino con
   `mar = 0` en un período de tasas altas se ve mejor que uno sobre la tasa.
   Como la referencia y los puntos comparten el `mar`, el orden relativo se
   mantiene, pero el número no es comparable con uno publicado con otro `mar`.

## Condición de revisión

- **el owner quiere comparar contra un exceso sobre la tasa.** Sería
  `sortino-2.0.0` con una fuente de tasas propia;
- **la matriz muestra huecos que la tolerancia de calendario no ve.** Se pasa a
  sesiones contra la referencia.

## Consecuencias

- `src/modules/metrics/` nace con dominio puro:
  - `total-return.ts`;
  - `sortino.ts`;
  - `metric-catalog.ts`;
  - `metric-input-error.ts`.
- `subtractCalendarYears` y `subtractDays` se mudan de la ventana de la SEC a
  `src/modules/temporal/domain/calendar-date.ts`: las dos ventanas del proyecto
  cortan con la misma regla.
- `price-unadjust` pasa a `1.1.0`; `PriceWriteSummary` gana `eventsConflicting`,
  y el comando lo muestra como «evento cambiado».
- La ingesta de precios pide la historia con fechas explícitas y recibe el reloj
  inyectado.

## Alternativas descartadas

- **Calcular la total return con los dividendos tal como estaban y des-ajustarlos
  al leer.** La fila seguiría cambiando con cada split futuro: el mismo problema
  que la ADR 0026 resolvió para los cierres.
- **Acortar la ventana cuando falta la base.** Una ventana de 5 años con un día
  menos no sería la misma para todos los puntos, y la especificación lo prohíbe.
- **`SPY` como referencia.** Su total return se calcularía con el mismo motor,
  pero carga gastos y no es el índice.
- **Retornos logarítmicos.** No son lo que define la ADR 0016, y la media
  aritmética de retornos simples es la convención del Sortino publicado.
