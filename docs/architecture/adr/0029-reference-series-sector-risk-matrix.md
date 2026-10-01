# ADR 0029: serie de referencia y matriz de riesgo sectorial

- Estado: aceptado
- Fecha: 2026-09-30
- Alcance: `F7-05`. Decide dónde vive la serie de `^SP500TR`, cómo la ingesta
  distingue una rueda cerrada de una en curso, cómo se ingiere un sector y cómo se
  lee la matriz a un corte, y cómo la superficie la muestra sin datos del
  owner en el gate. El detalle visual vive en su brief.
- Decisiones relacionadas: [ADR 0016](0016-analysis-scope-sector-matrices.md) (la
  matriz), [ADR 0025](0025-declared-sector-classification.md) (la población),
  [ADR 0026](0026-daily-prices-source.md) (serie cruda e inmutable),
  [ADR 0027](0027-cedear-registry-sources.md) (la marca CEDEAR),
  [ADR 0028](0028-sortino-parameters-total-return.md) (la fórmula y la
  referencia elegida)

## Contexto

La ADR 0028 eligió `^SP500TR` como referencia y dejó abierto dónde se guarda su
serie. El modelo de identidad exige que **toda security referencie un emisor
legal** (invariante 2), y un índice no tiene emisor.

Tres problemas aparecieron al construir la matriz sobre datos reales:

- **La ingesta no distinguía una rueda abierta de una cerrada.** Un precio
  intradía se habría guardado como cierre inmutable.
- **`loadState` sólo devolvía versiones vigentes del grafo.** Una lectura a un
  corte pasado etiquetaba el pasado con los valores de hoy.
- **Esa misma lectura truncaba en silencio al superar su techo.**

## Decisión 1 — la referencia es una serie propia, no una security

La tabla es `benchmark_prices`, con migración `0021` y su rollback, que se niega
a correr si hay filas:

- `benchmark_id`, fecha de mercado, nivel, moneda y corrida;
- la misma fila liviana que `security_prices`.

La clave es un ID **declarado en código** (`declared-benchmarks.ts`), no el
símbolo de la fuente:

| `benchmark_id`       | Índice  | Símbolo en la fuente | Base         | Moneda |
| -------------------- | ------- | -------------------- | ------------ | ------ |
| `sp500-total-return` | `sp500` | `^SP500TR`           | total return | USD    |

La base es parte de la declaración. Un índice total return ya reinvierte, así
que la ingesta **se niega** si la respuesta trae splits o dividendos
(`benchmark_has_events`) o si la moneda no es la declarada. Cualquiera de los dos
significaría que la base no es la que se compara contra las empresas.

Descartado: una security sin emisor, o un emisor inventado para `S&P Dow Jones
Indices`. Cualquiera de los dos rompe la invariante de la que depende todo el
grafo, para ahorrar una tabla de cinco columnas.

## Decisión 2 — la rueda en curso no se guarda (`settled-session-1.0.0`)

El timestamp de la barra diaria es su apertura, igual con la rueda abierta que
cerrada. Sondeado el 2026-09-30 sobre `^SP500TR`, la respuesta declara dos datos
que el parser pasa a leer (`yahoo-chart-1.1.0`):

- `currentTradingPeriod.regular`: la sesión termina a las 20:00 UTC;
- `regularMarketTime`: el nivel total return se publicó a las 20:38 UTC.

La última rueda sólo se guarda si su fecha es la de esa sesión, el último precio
está sellado después del fin **y** la descarga ocurrió al menos 60 minutos
después. Si no, se informa como `en curso` y se descarta. Sin sesión declarada se
descarta la rueda con la fecha de mercado de la descarga, que es la regla
conservadora.

Cierra el límite 3 de la ADR 0028.

## Decisión 3 — ingesta por sector

`pnpm prices:ingest --sector <código>` toma la población del sector **a hoy**
(ADR 0025) y el ticker vigente de cada security, con `securityTickersAt`, la
dirección inversa de la resolución por símbolo. `--benchmark <id>` ingiere una
referencia declarada.

La cuota se verifica sobre el total de requests **antes** de la primera llamada.
El grafo guarda las clases con guion (`BRK-B`, `BF-B`), que es también la
convención de la fuente, así que no hace falta traducir símbolos.

## Decisión 4 — la matriz se lee al cierre del `as_of`

`loadSectorRiskMatrix` resuelve todo al mismo corte: `as_of` a las 23:59:59.999
UTC, con `as_known` en ese mismo instante.

- **Población:** membresía por clasificación, al corte (ADR 0025).
- **Ticker, emisor y nombre legal:** del grafo, con **historia completa**.
  `loadState` gana `versions: "all"`; `"open"` sigue siendo el valor por defecto
  del planner de constitución. Sin la historia, un punto de 2024 se etiquetaba con
  el ticker de hoy, y uno renombrado quedaba sin ticker.
- **CEDEAR:** `resolveCedearAccess` al corte. `not_effective_at_cutoff` no es
  «sin CEDEAR»: el registro no tenía captura a esa fecha.
- **Series:** desde la base de 5 años menos 14 días hasta el `as_of`, nunca más
  allá. Las filas son crudas e inmutables, así que la lectura reproduce
  exactamente lo que se habría calculado ese día.
- **`as_of` por defecto:** el último cierre de la referencia en los últimos 30
  días. Sin referencia guardada, la lectura se niega (`no_reference_series`).

La consulta está acotada (`TM-07`):

- 150 miembros como techo (`population_too_large`);
- una ventana de fechas por serie;
- un techo de filas por tabla del grafo. Superarlo ahora es un error; antes,
  `loadState` truncaba en silencio.

### El dominio (`sector-risk-matrix-1.0.0`)

- **Un punto por security.** GOOG y GOOGL son dos puntos con un solo sector.
- **Referencia en la misma fórmula y las mismas ventanas**, sin eventos.
- **Cuadrante respecto de la referencia,** comparado en decimal exacto:
  `beats_both`, `beats_2y_only`, `beats_5y_only` o `beats_neither`. Es `null` si
  al punto o a la referencia le falta una ventana: un `null` no se ubica en un
  cuadrante.
- **Distancia a la referencia en cada ventana**, `null` en el mismo caso.
- **Recta de ajuste** `sector-fit-ols-1.0.0`: mínimos cuadrados de 5 años sobre
  2 años, sólo con puntos que tienen las dos ventanas y **sin la referencia**.
  - Publica su `n`.
  - Con menos de 3 puntos es `too_few_points`; con X constante,
    `no_x_variance`.
  - Es un ajuste del sector, nunca un valor justo. La ventana de 5 años contiene
    a la de 2, así que parte de la pendiente es mecánica.
- **Marca CEDEAR** con el ratio vigente, la cantidad de programas y el estado del
  primero: un programa suspendido sigue siendo un programa, y se dice.

## Decisión 5 — la superficie, y cómo se prueba sin datos del owner

`/sectores` lista los once sectores con cuántas securities tienen un cierre en
los últimos 14 días. `/sectores/[sector]` muestra la matriz al `as_of`, que es el
último cierre de la referencia **en o antes** de la fecha pedida: un sábado no
deja a todos los puntos sin cierre, y la página dice a qué rueda se corrió.

Decisiones del owner el 2026-09-30:

- se entra por un índice que muestra la cobertura;
- todas las etiquetas visibles, sin superponerse;
- dominio robusto en los ejes, con los puntos extremos en el borde.

**Primer chart real, primer uso de Recharts**, vía el `ChartContainer` de shadcn,
como ya fijaba `interface-foundations.md`. Recharts dibuja ejes, grilla y
líneas; los puntos son una capa propia de botones enfocables, porque un tooltip
de hover no es un equivalente accesible.

**El gate E2E no ve la matriz con datos, y eso es a propósito.** Su servidor
personal apunta a un puerto cerrado, y las capturas nunca muestran datos del
owner (ADR 0006). El gate afirma la negativa «Base personal no disponible» en
personal y `RuntimeLockedNotice` en el runtime trabado, con axe en los dos y
sobre el mismo build: eso prueba que la frontera vive en el request. La matriz
renderizada se revisó sobre `pnpm walkthrough`, y el resultado se registra por
escrito.

Tres cosas que aparecieron al cerrar la superficie:

- **Backoff de reconexión.** postgres.js reintenta con backoff exponencial en
  un cliente que vive entre requests. Contra la base caída, el tercer request
  tardó 35 s y el cuarto 57 s en fallar. El cliente runtime pasa a `backoff: 0`:
  una superficie que lee en el request dice enseguida que la base no respondió.
- **`◐` en el build.** La ruta con segmento dinámico se marca como Partial
  Prerender, pero su cáscara está vacía (`hasHtml: false`, 0 bytes) y nada del
  modo se hornea.
- **El 404 de un sector desconocido sale con status 200.** `notFound()` llega
  con la respuesta ya en streaming, así que se ve la página de ruta inexistente
  con `noindex`. `dynamicParams` no se admite con Cache Components, y un `proxy`
  sería una superficie de request nueva para resolver un status.

## Medición

Sobre la base personal, el 2026-09-30:

- **Referencia:** 1.265 niveles desde el 2021-09-16, 1 request y 224 kB.
- **Communication Services:**
  - 24 securities, 24 requests y 4,3 MB; la base pasa de 28 a 32 MB;
  - RDDT trae 634 ruedas porque cotiza desde marzo de 2024.
- **Matriz al 2026-09-30,** en 775 ms:
  - referencia: 1,548 a 2 años y 1,232 a 5 años;
  - GOOG 2,062 y 1,118, GOOGL 2,077 y 1,122, con CEDEAR 58:1 sólo en GOOGL;
  - RDDT a 5 años es `insufficient_history`;
  - 6 securities con CEDEAR vigente;
  - recta con n = 23 y pendiente 0,400.

## Límites declarados

1. **El símbolo BYMA del CEDEAR no se muestra.** El registro identifica cada
   CEDEAR por ISIN y código de Caja de Valores, sin listing en el grafo. La marca
   lleva el ratio.
2. **La población es la del índice al `as_of`.** Quien salió del índice antes no
   aparece: el sesgo de supervivencia se declara en la superficie.
3. **Las series se ingieren a mano.** Un sector sin precios se ve con
   `no_close_at_as_of` en cada punto, no con una matriz vacía que parezca una
   respuesta.
4. **La ventana de 5 años necesita historia guardada.** Las series empiezan el
   2021-09-16, así que sólo los cortes desde el 2026-09-16 tienen base a 5 años;
   uno anterior deja todos los puntos en «Sin valor», con su motivo.
5. **Un choque residual de rótulos a 390 px.** Medido en el DOM: 0 rótulos
   superpuestos a 1440, 1024 y 360 px en todos los cortes probados, y uno a
   390 px en el corte del 27/09/2026, cuando un grupo fusionado no encuentra
   lado libre.

## Alternativas descartadas

- **Guardar la rueda en curso y reemplazarla después.** Rompe la inmutabilidad
  de la fila cruda, que es la decisión central de la ADR 0026.
- **Un grafo al corte armado en SQL.** El dominio ya decide la vigencia con
  `isEffectiveAt` e `isKnownAt`. Duplicar esa regla en SQL crearía dos
  definiciones de «vigente».
