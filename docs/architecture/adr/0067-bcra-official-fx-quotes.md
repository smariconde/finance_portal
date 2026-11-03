# ADR 0067: cotizaciones oficiales de Estadísticas Cambiarias del BCRA

- Estado: aceptado
- Fecha: 2026-11-03
- Alcance: `F9-03`. Decide qué fuente cambiaria oficial se suma, qué monedas,
  cómo se lee un cable que pagina por cotización y no por día, y cómo una
  conversión a dólares cubre los años anteriores al mayorista.
- Decisiones relacionadas: [ADR 0020](0020-source-daily-budget-kill-switch.md)
  (cuota diaria), [ADR 0065](0065-bcra-monetary-catalog-vintages.md) (registro
  de series del BCRA), [ADR 0066](0066-macro-real-and-dollar-transformations.md)
  (transformaciones a dólares)

## Contexto

Lo cambiario que ya había venía de Estadísticas Monetarias: el mayorista A3500
(variable 5, desde 2002-03-04), el minorista (4, desde 2010) y las bandas
(1187 y 1188, desde 2025-04-14). La masterplan pide fuentes oficiales, el Banco
Nación como referencia para Rosario, y MEP o CCL sólo con un feed licenciado.

Se midieron dos candidatas el 2026-11-03.

- **Estadísticas Cambiarias v1 del BCRA**
  (`api.bcra.gob.ar/estadisticascambiarias/v1.0`):
  - Un maestro de 44 monedas y la cotización diaria en pesos de cada una, desde
    1992-01-02. El dólar son 8.489 días en 9 requests.
  - La API exige las dos fechas y rechaza un `fechahasta` posterior a su «día
    actual».
  - El `limit` va de 10 a 1.000.
  - Ni el manual ni la página dicen de qué mercado sale la cotización. Contra el
    A3500, en 6.011 días comunes, la diferencia tiene mediana 0,04 %, p95 0,67 %
    y máximo 14,9 % (marzo de 2002).
  - Las otras monedas son un cruce contra el dólar.
- **Banco Nación**: no tiene API. El histórico es un formulario HTML con token
  antiforgery.

## Decisión 1 — fuente, derechos y monedas

Decisiones del owner del 2026-11-03:

- Se suma `bcra-cambiarias-v1` como fuente propia, con los mismos derechos que
  `bcra-monetarias-v4`. El aviso legal es el mismo y la página de APIs lo
  enlaza para cada API: `approved_personal`, acceso automatizado `allowed`, y
  crudo, exhibición pública e IA `restricted`.
- El allowlist abre sólo `Maestros/Divisas` y `Cotizaciones/<moneda>`. La
  consulta por fecha y el resto del host quedan cerrados.
- La cuota es de 100 requests por día.
- El Banco Nación queda para `F9-05`, que es donde Rosario lo necesita.
- Las monedas son el dólar y los socios principales: USD, EUR, BRL y CNY
  (`DECLARED_FX_CURRENCIES`). Cada serie se identifica por su código ISO 4217
  numérico, porque la clave de una serie macro es numérica:
  `bcra-cambiarias-v1:840`.

La cotización se describe como «publicada por el BCRA» y no se le atribuye otra
metodología: la fuente no la publica, y la definición guarda `methodology` nula
con el flag `methodology_missing`.

## Decisión 2 — mismo registro, otro perfil

El planeamiento de definiciones y de puntos de la ADR 0065 sirve igual. Siguen
valiendo la base fijada, la cadena de revisiones, las guardas de retiro y de
cambio masivo, y la ventana de una página. Lo que cambia es la fuente.
`BcraSourceProfile` lleva la fuente, los datasets, la versión del parser y de
la ventana, y cómo se nombra una serie. `recordBcraCatalog` y `recordBcraSeries`
lo reciben, y por defecto usan el perfil monetario, así que las corridas
monetarias son las mismas byte por byte. El transporte (derechos antes de la
red, `429`/`503` sin reintento, techo de páginas) queda en `createBcraTransport`.

El «catálogo» cambiario es el maestro filtrado por las monedas declaradas. La
unidad y la primera fecha son declaraciones medidas, porque el maestro sólo
publica código y denominación.

## Decisión 3 — un cable que pagina por cotización

Lo que fija `bcra-cambiarias-v1-1.0.0`:

- **El `count`, el `offset` y el `limit` cuentan cotizaciones, no días.** Un
  día puede traer la misma moneda varias veces: 8.543 cotizaciones son 8.489
  días. El paginado avanza por lo consumido (`ParsedPage.consumed`).
- **Copias.** Copias idénticas de un día son un punto. Valores distintos
  rechazan el día por nombre en vez de elegir uno. Pasa en 5 días (2017-09-06
  trae 37,35 y 17,215), y en las cuatro monedas, porque son cruces del dólar.
- **Un día partido entre dos páginas** se une con la misma regla. En una
  ventana, el último día de una página llena puede seguir en la página
  siguiente, que no se pidió, así que se deja afuera.
- **El maestro** repite un código con dos nombres (`NIO`). Ese código queda
  ambiguo y no se lee; si fuera una moneda declarada, su fila se rechaza y no se
  la da por retirada.
- **Fechas.** Se pide hasta el día de Buenos Aires (UTC−3), nunca el de UTC: a
  las 22 h de Buenos Aires ya es el día siguiente en UTC y la API rechazaría la
  fecha.
- **Rechazo del cable.** Un sobre, una clave, una paginación o un orden
  cambiados rechazan la página entera, como en el monetario.

`bcra-fx-revision-window-1.0.0`: la primera descarga trae la historia y las
siguientes, una página, que son los 1.000 días más recientes (unos cuatro años).

## Decisión 4 — dólares empalmados antes del mayorista

Decisión del owner: empalmar. `usd_spliced` divide por el mayorista desde su
primer día visible al corte y, antes, por la cotización del BCRA del mismo día:

- nunca se pegan las dos para un mismo día: desde el empalme, un día sin
  mayorista queda `reference_gap` aunque haya cotización;
- cada punto dice qué serie lo transformó (`referenceSeries`: `reference` o
  `before_splice`);
- el resultado publica el día del empalme, el tramo de la serie anterior y el
  salto de nivel `cotización / mayorista − 1` de ese día;
- `usd_wholesale` queda como estaba, sin empalme.

La serie anterior tiene su base fijada (`SPLICE_BEFORE_BASIS`), y se lee con el
mismo corte que las demás.

## Decisión 5 — el dólar de mercado en el cepo va aparte

El owner pidió que las épocas de cepo no se lean con el dólar oficial como si
fuera el accesible. Se midió el CCL implícito de Galicia (precio local × 10
sobre el ADR, Yahoo) contra el mayorista:

| Período            | Días  | Brecha mediana |
| ------------------ | ----- | -------------- |
| Sin cepo 2002–2011 | 2.330 | 0,7 %          |
| Cepo 2011–2015     | 971   | 40,9 %         |
| Sin cepo 2016–2019 | 877   | 0,2 %          |
| Cepo 2019–2025     | 1.329 | 74,5 %         |
| Bandas 2025–       | 367   | 5,1 %          |

El MEP sale de bonos que cambian de época en época y Yahoo no tiene, así que no
cubre los dos cepos con una sola regla. El CCL implícito por ADR existe desde 2000.

Decisiones del owner:

- va en un slice propio (`F9-07`), con la mediana de pares declarados y el
  ratio de cada uno verificado;
- la app muestra dos conversiones lado a lado, «dólar oficial» y «dólar CCL»,
  con la brecha visible, y nunca cambia de fuente en silencio;
- Yahoo no es un feed licenciado, así que ese uso queda `owner_accepted`.

## Consecuencias

Medido contra el cable real, en una réplica vacía:

- **Primera descarga:** el maestro y las cuatro monedas en 31 requests y 62 s.
  Son 27.276 días (USD 8.484, EUR 6.717, BRL 6.982, CNY 5.093), ~1,9 MB.
- **Actualización:** 5 requests y las cinco corridas `duplicate`.
- **Base monetaria en dólares empalmados:** 7.475 días desde 1996; con el
  mayorista solo eran 6.044.
- **Empalme:** el salto de nivel del 2002-03-04 es 2,08 %.
- **Días sin conversión:** 115 quedan `reference_gap`, fines de año y feriados
  en que el BCRA no cotizó.

Además:

- Los cinco días con cotizaciones distintas quedan sin dato, nombrados en la
  corrida (`rows_rejected`), en las cuatro monedas.
- El empalme convierte la convertibilidad a 1 a 1. Los cepos siguen en dólares
  oficiales hasta `F9-07`, con la advertencia `official_fx_under_controls`
  también en `usd_spliced`.
