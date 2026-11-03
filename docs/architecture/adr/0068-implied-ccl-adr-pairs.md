# ADR 0068: CCL implícito por pares ADR, al lado del dólar oficial

- Estado: aceptado
- Fecha: 2026-11-03
- Alcance: `F9-07`. Decide de dónde sale un dólar de mercado para las épocas de
  cepo, cómo se guarda, cómo se calcula y cómo convive con el oficial.
- Decisiones relacionadas: [ADR 0026](0026-daily-prices-source.md) (Yahoo,
  series crudas), [ADR 0029](0029-reference-series-sector-risk-matrix.md)
  (series declaradas fuera del grafo), [ADR 0066](0066-macro-real-and-dollar-transformations.md)
  (transformaciones a dólares), [ADR 0067](0067-bcra-official-fx-quotes.md)
  (cotizaciones oficiales y la decisión 5)

## Contexto

En el cepo, el dólar oficial no era el que se podía comprar. El owner pidió
que la app lo tenga en cuenta (ADR 0067, decisión 5). Fuera del cepo el CCL y
el oficial coinciden, así que esas épocas sirven para verificar los ratios. Se
midió el 2026-11-03 sobre Yahoo:

- **MEP** sale de bonos (AL30/AL30D hoy, otros antes) que cambian de época en
  época, y Yahoo no los tiene.
- **CCL implícito por ADR** es `precio local × ratio / ADR`, con historia desde 2000.
  - Medido sobre cierres **crudos**, el ratio implícito
    `mayorista × ADR / local` de 2016-03 a 2019-08 da el ratio del programa con
    mediana dentro del 1 % en diez pares: GGAL 10, BMA 10, BBAR 3, TEO 5,
    EDN 20, PAM 25, CEPU 10, LOMA 5, SUPV 5 e YPF 1.
  - Sobre los cierres ajustados que publica Yahoo, YPF daba 10: la fuente
    dividió hacia atrás toda la historia local por el split 10:1 del
    2026-08-03. Es el mismo defecto que la ADR 0026 midió en NVDA.
  - TGS, CRESY e IRS se corren por dividendos en acciones y splits locales sin
    contraparte.

## Decisión 1 — fuente y derechos

Las patas se bajan de Yahoo (`yahoo-finance`, dataset `yahoo.adr-pair-close`),
cuyos derechos ya son `owner_accepted` para guardar normalizado y derivado, y
`restricted` para exhibición pública. La masterplan pedía un feed licenciado
para MEP/CCL. El owner aceptó Yahoo con la metodología visible, igual que para
los precios (ADR 0026).

## Decisión 2 — pares declarados con ratio fechado

`declared-adr-pairs-1.0.0` declara los diez pares en código. Cada uno tiene su
ratio como **versión fechada**: YPF vale 1 hasta el 2026-08-02 y 10 desde el
2026-08-03, porque un ADR pasó a representar diez acciones locales. Un par
cuenta desde su primera versión. Agregar o corregir un par es un diff revisable
con su medición.

## Decisión 3 — patas crudas fuera del grafo, ratio al leer

- **Fuera del grafo.** Las patas no son securities: sus emisores argentinos no
  están constituidos, e inventarles una identidad rompería el grafo, igual que
  con `^SP500TR`. Van a `adr_pair_closes` (migración `0047`), una fila por pata
  y rueda.
- **Cierre crudo.** Se guarda con los splits posteriores deshechos
  (`price-unadjust-1.1.0`), así que la fila es inmutable. Un re-download
  distinto se reporta, no se pisa.
- **Rueda en curso.** Se deja afuera con la regla de su mercado: Nueva York para
  el ADR y BYMA para la acción local (`settled-session-1.0.0`,
  `cedear-settled-session-1.0.0`).
- **Moneda.** Una pata que llega en otra moneda que la suya se rechaza.
- **Cuándo se la conoce.** La disponibilidad de una pata es el `recorded_at` de
  su corrida: con `as_known`, el corte sólo ve lo que ya se había registrado.
- **Al leer.** El ratio y la mediana se aplican en la lectura, así que corregir
  un ratio no obliga a volver a bajar nada.

## Decisión 4 — `ccl-implied-1.0.0`

```text
ccl_p(t) = local_p(t) × ratio_p(t) / adr_p(t)
CCL(t)   = mediana { ccl_p(t) : p con las dos patas cerradas el día t }
```

- Las dos patas cierran **el mismo día**: un feriado en un mercado deja fuera al
  par y nunca se toma otro día.
- La mediana amortigua un par raro: sola, Galicia daba +206 % en agosto de 2002.
- Con menos de tres pares el día es `null` con `insufficient_pairs`.
- Cada punto publica los pares que entraron, y el menor y el mayor implícito.
- `fx-gap-1.0.0` es `CCL / oficial − 1`, sólo en días en que publicaron las dos.

## Decisión 5 — dos conversiones lado a lado

Decisión del owner: `usd_ccl` divide por el CCL del mismo día (`En millones de
USD al CCL implícito`) y **no reemplaza** a `usd_wholesale` ni a `usd_spliced`.

- Cada una lee una sola fuente, y la app las muestra juntas con la brecha.
- `usd_ccl` lleva la advertencia `ccl_implied_market_rate`: es un tipo de cambio
  de mercado, no una cotización publicada, y en 2019–2025 lo encarecieron
  también las restricciones a operar.
- Depósitos y préstamos (`MEyML`) pueden pasar a dólares CCL. Deflactarlos sigue
  rechazado.

## Consecuencias

Medido contra Yahoo y el BCRA reales, en una réplica vacía:

- **Patas:** 20 requests en 35 s, 103.411 ruedas, 11 MB.
- **Cobertura:** hay CCL en 6.489 de 6.490 días desde 2000-01-03. Entran de 3 a
  10 pares por día, y la diferencia entre el mayor y el menor tiene mediana
  3,8 %, p95 12 % y p99 27 %.
- **Brecha CCL/mayorista, mediana anual:**
  - 0–2 % en 2003–2010 y en 2016–2019;
  - 35–55 % en 2012–2015;
  - 69–103 % en 2020–2023;
  - 28 % en 2024 y 5–6 % desde las bandas.
- **Base monetaria a fines de 2023:** 9.886 millones de dólares al CCL contra
  11.884 al oficial.

Además:

- Antes de 2002 el CCL muestra lo que la convertibilidad escondía: el
  2001-12-31 da 1,35 pesos por dólar.
- Una actualización vuelve a bajar la historia de cada pata, porque Yahoo
  responde la serie entera en una request, y escribe sólo las ruedas nuevas.
