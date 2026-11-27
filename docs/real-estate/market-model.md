# Inmuebles de Córdoba: identidad, captura y motor

- Fecha: 2026-11-27 (revisión de la propuesta del 2026-11-26)
- Fase: 13, `F13-01` a `F13-10`
- Decisión: [ADR 0089](../architecture/adr/0089-real-estate-intelligence-cordoba.md)
- Estado: aprobada por el owner el 2026-11-27

Este documento fija el modelo del dominio. Las razones —por qué una extensión,
por qué una banda— están en la ADR 0089. Acá van identidades, contratos,
fórmulas y límites.

## 1. Qué responde y qué no

Responde, con lo observado y su fecha:

1. ¿Este aviso está caro o barato para lo que es y donde está?
2. ¿Su precio viene bajando, hace cuánto está publicado, lo republicaron?
3. ¿Qué se puede construir en esa parcela y con qué certeza?
4. ¿Qué rinde como cochera, como flip, como casa para vivir, en alquiler o
   demolida y desarrollada?
5. ¿Con qué margen se puede negociar?

No responde cuánto vale con validez legal, a cuánto se cerró, ni los
impuestos, tasas o ajustes de la operatoria. Es _screening_ a grandes rasgos
y así se rotula.

## 2. Identidad

| Tabla                 | Qué es                                   | Clave                                                      | Versionado                                       |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| `re_parcel`           | Parcela catastral                        | Nomenclatura (provincial y municipal como alias entre sí)  | `re_parcel_version` con `valid_from`/`valid_to`  |
| `re_property`         | Unidad vendible                          | Surrogate; vínculo a parcela como afirmación con confianza | El vínculo se versiona; la unidad no             |
| `re_listing`          | Aviso de un portal                       | `(source_id, external_id)`                                 | `first_seen_at`, `last_seen_at` y estado de vida |
| `re_listing_revision` | Lo que cambió de un aviso en un instante | `(listing_id, revision_number)`                            | Append-only, **sólo cuando algo cambia**         |

Reglas:

- **El ticker de este dominio es `(fuente, id externo)`.** Un precio o una
  dirección nunca son clave.
- **Una revisión sólo cuando cambia** precio, moneda, superficie, estado o
  hash del contenido. Ver un aviso igual mueve `last_seen_at` y nada más.
- **No verlo no es una baja.** `removed` sólo cuando la ficha visitada dice
  «finalizado» o responde `404`. Lo demás es «no visto desde
  `last_seen_at`».
- **Una parcela que se subdivide o se fusiona** cierra una versión y abre otra.
- **Una fila guarda sólo lo que no puede reconstruir** (ADR 0018): ni el texto
  de la descripción, ni las fotos, ni el contacto.

## 3. Contrato de captura `listing-capture-1.0.0`

Cerrado: un campo fuera del contrato rechaza la captura.

```
source              portal declarado en el registro
external_id         identificador del aviso en el portal
canonical_url       URL sin parámetros de seguimiento
page_kind           listing_detail | search_result
parse_basis         json_ld | embedded_state | dom
operation           sale | rent
property_type       house | apartment | ph | land | parking | office | retail
price_amount        decimal > 0, o null con price_status
price_status        published | on_request
price_currency      USD | ARS
expenses_amount     opcional
expenses_currency   opcional
covered_area_m2     opcional
total_area_m2       opcional
land_area_m2        opcional (casas y terrenos)
rooms               opcional
bedrooms            opcional
bathrooms           opcional
parking_spaces      opcional
age_years           opcional
floor               opcional
amenities           conjunto cerrado: pool | gym | sum | security | grill | elevator | balcony | garden
condition           new | good | to_renovate | unknown
legal_flags         conjunto cerrado: credit_eligible | deed | boleto_only | succession | possession
address_declared    texto tal como lo publica el portal
neighborhood        texto tal como lo publica el portal
latitude            opcional, sólo si el portal la publica
longitude           opcional
agency              opcional
published_at        opcional, fecha declarada por el portal
description_simhash 64 bits del texto normalizado
photo_dhashes       hasta 5 dHash de 64 bits
photo_count         entero
captured_at         instante de la captura
```

`condition` y `legal_flags` se extraen **en el navegador** con reglas
versionadas (`listing-features-1.0.0`: «a reciclar», «a estrenar», «apto
crédito», «escriturado», «boleto», «sucesión», …). Viaja el enum, nunca el
texto. Un campo que el portal no publica queda `null`, nunca en cero. Un precio
en ARS se guarda en ARS.

Lo que **no** entra: texto de la descripción, URLs de fotos, teléfono, correo,
cookies ni encabezados.

## 4. Extensión

### Adapters

Cada portal es un adapter con `slug`, `match`, `selectors`, `parseListing`,
`parseSearchPage` y `detectChallenge`. Lee JSON-LD, después estado embebido y
después selectores, y declara `parse_basis`. `portals/registry.ts` es la única
lista y de ahí salen los `host_permissions`, incluida la CDN de fotos para los
dHash.

Antes de fijar un adapter, el agente abre el portal en Brave o Chrome y mide
qué datos estructurados hay, qué campos trae la ficha y cuáles el listado,
cuántos avisos por página, cómo pagina y cómo se ve un desafío.

### Barrido programado `listing-sweep-1.0.0`

- Perfil dedicado, sin sesión en ningún portal, ventana propia.
- Una vez por día de Buenos Aires, jitter de ±90 minutos.
- Una pestaña, en serie, 8–15 s entre páginas con jitter y una pausa larga cada
  pocas páginas.
- Tope de **25 páginas por portal por día**; una ficha cuenta como página. El
  tope guardado sólo puede bajar el declarado en código.
- Cola con prioridad: avisos seguidos → búsquedas guardadas por «más
  recientes» → fichas sin ver hace más de N días (para confirmar estado) →
  rotación del resto.
- Cursor persistido: si el navegador se cierra, retoma.
- `detectChallenge` detiene el portal por el día («bloqueado»); dos días
  seguidos lo pausan hasta que el owner lo reactive.
- Cobertura publicada: páginas visitadas, avisos vistos, búsquedas cubiertas,
  antigüedad del último visto.

### Envío

Desde el service worker a `POST /api/inmuebles/captura`, idempotente por
`(source, external_id, content_hash)`, con cola local si el endpoint no
responde.

## 5. Deduplicación `listing-dedup-1.0.0`

Puntaje con pesos versionados sobre:

- distancia de Hamming entre `photo_dhashes` (la mejor evidencia entre
  agencias);
- distancia entre `description_simhash`;
- calle y altura normalizadas por Georef;
- superficie dentro de ±5 %, mismo tipo y mismos ambientes.

Arriba del umbral alto el vínculo se afirma; en la franja media queda
**candidato** y el owner lo confirma o lo descarta desde la ficha; un candidato
nunca entra en un cálculo. El mismo mecanismo detecta **republicaciones**
dentro de un mismo portal.

`duplicate_spread_pct = (max_precio − min_precio) / min_precio`.

## 6. Historial y señales

| Señal                  | Definición                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `days_listed`          | Desde el primer avistaje de la unidad (republicaciones incluidas) a hoy o a `removed` |
| `price_cut_count`      | Revisiones con precio menor al anterior                                               |
| `price_cut_total_pct`  | `(precio_inicial − precio_actual) / precio_inicial`                                   |
| `relist_count`         | Republicaciones unidas por la deduplicación                                           |
| `last_change_at`       | Última revisión con precio distinto                                                   |
| `is_stale`             | `days_listed` sobre el p75 de su segmento y sin cambios                               |
| `avm_percentile`       | Percentil del precio en la banda (§8)                                                 |
| `duplicate_spread_pct` | §5                                                                                    |

`days_listed` es una cota inferior. Cuando el portal declara `published_at`,
se muestran las dos y se nombra la diferencia.

## 7. Ubicación `location-precision-1.0.0`

1. Dirección con altura → Georef `/direcciones` (provincia Córdoba,
   departamento Capital, lotes por `POST`) → calle normalizada y coordenadas.
2. Pin del portal, si existe. Un pin repetido en muchos avisos es el centro del
   barrio (`portal_pin_shared`).
3. Punto en polígono: barrio oficial, parcela y patrón urbanístico.

| Precisión           | Qué significa                                     |
| ------------------- | ------------------------------------------------- |
| `address_geocoded`  | Dirección con número que Georef resolvió          |
| `portal_pin`        | Sólo el pin del portal, no repetido               |
| `portal_pin_shared` | Pin compartido: vale como barrio, no como parcela |
| `neighborhood_only` | Sólo el texto del barrio                          |

Si el geocodificado y el pin están a más de 150 m, se marca. El vínculo con la
parcela sólo se afirma con `address_geocoded` o `portal_pin`; el owner puede
confirmarlo o corregirlo.

## 8. Comparables `avm-comparable-1.0.0`

### Modelo

Hedónico sobre `log(USD/m²)`:

```
log(p/m²) = β₀ + efecto_barrio + efecto_mes
          + β₁·log(m²) + β₂·ambientes + β₃·baños + β₄·cocheras
          + β₅·antigüedad + β₆·piso + Σ β·amenity + Σ β·condition + Σ β·legal_flag + ε
```

Ridge con `λ` fijo y declarado. El efecto de un barrio se contrae hacia la
ciudad con `n/(n+k)`, `k = 30`, y la ficha dice «barrio con pocos avisos»
cuando `n < 30`. La superficie es la cubierta para departamentos y la total
para casas y terrenos (`surface_basis`). Los avisos en ARS pasan a USD al tipo de
cambio oficial del día de su revisión (§10).

### Banda

Intervalo **predictivo** de la unidad: predicción × cuantiles 25/50/75 de los
residuos fuera de muestra de su segmento. Salen `p25`, `p50` y `p75` de USD/m²,
el percentil del precio publicado, `n` y la ventana.

### Negativas

- Un segmento (tipo × ciudad) con menos de 30 avisos no publica banda:
  `comparable_band_unavailable`, con cuántos faltan.
- Un barrio con pocos avisos sí publica, contraído y dicho.

### Backtest

Se ajusta sin los últimos 90 días y se miden dos cosas por segmento:

- error absoluto porcentual mediano del `p50`;
- **cobertura**: qué fracción de los avisos no vistos cae en p25–p75. Si se
  aleja del 50 % por más de 10 puntos, la banda se publica marcada «mal
  calibrada».

### Comparables a la vista

Los ocho avisos más cercanos del mismo tipo, con superficie dentro de ±30 % y
en la ventana, con distancia, precio, USD/m² y en qué difieren.

### Descuento de cierre

`closing-discount-1.0.0`: cada caso se muestra con 0, 5 y 10 %. La medición de
Mudafy (mediana 0 %, noviembre de 2026) se cita como la de una sola
inmobiliaria.

## 9. Zonificación y envolvente

### `zoning-resolution-1.0.0`

```
patron_urbanistico   código del patrón o del área/corredor
fos                  factor de ocupación del suelo
fot                  factor de ocupación total
height_max_m         altura máxima
uses_allowed         vivienda | cochera | comercio | mixto
ordinance_version    norma y año (8256/1986 con sus modificaciones)
observed_at          cuándo se leyó
confidence           official_query | official_map | corridor_inferred | unknown
evidence_url         la consulta o la capa
```

Sólo `official_query` es documento oficial. `unknown` no se completa con el
promedio del barrio. La capa que se lee se mide en `F13-06`.

### `buildable-envelope-1.0.0`

```
planta_max   = fos × area_parcela
total_max    = fot × area_parcela
pisos_max    = floor((height_max_m − planta_baja) / altura_piso) + 1
construible  = min(total_max, planta_max × pisos_max)
```

Con sensibilidad a `fot ± 0,3`.

## 10. Costos y conversiones

`transaction-costs-cordoba-1.0.0`, a grandes rasgos y con el rango medido en
2026:

| Parámetro        | Por defecto | Rango   | Qué incluye                        |
| ---------------- | ----------- | ------- | ---------------------------------- |
| `buy_cost_pct`   | 3,5 %       | 3–4 %   | Sellos, escribano, certificados    |
| `sell_cost_pct`  | 1,75 %      | 1–2,5 % | Sellos y certificados del vendedor |
| `commission_pct` | 3,5 %       | 3–4 %   | Comisión inmobiliaria, por lado    |

Un cambio de ley o de criterio es una versión nueva.

**Costo de obra** (`remodel-scope-1.0.0`): costo por m² del ICC-Córdoba del
mes, pasado a USD al tipo de cambio oficial del día, por un multiplicador
por alcance —cosmético, cocina y baño, integral, obra nueva— que se investiga
en `F13-08`. El owner puede declarar un presupuesto propio que reemplaza al
calculado.

**Pesos a dólares:** tipo de cambio oficial mayorista del BCRA (Comunicación
A 3500, variable 5), guardado por la Fase 9: el del día o el último publicado
antes, con 7 días como máximo (un aviso visto un sábado usa el viernes). Más
viejo que eso, `fx_unavailable`. Es una decisión del owner: el oficial antes
que el CCL.

**Parámetros que se investigan en `F13-08`.** Superficie por plaza
(`m2_por_plaza`), costos de demolición y de tinglado por m², portón, piso e
iluminación, porcentaje de gastos operativos, eficiencia vendible, margen del
desarrollador y multiplicadores de obra. Ninguno tiene un valor fijado antes
de ese slice; cada uno entra con su fuente y su fecha.

## 11. Los cinco casos

Todos: costo en USD, corrida con hash y sensibilidad sobre sus dos variables
más fuertes. `gastos_pct` es un porcentaje del ingreso que el owner puede
cambiar; no hay impuestos ni tasas.

### `deal-parking-1.0.0` — cocheras mensuales con tinglado

La idea del owner: una inversión baja sobre el **lote**, no sobre la casa.
Se demuele parte o toda la construcción, se pone un tinglado y un portón y
entran autos. Puede ser el destino final o una **etapa de espera** que paga el
lote hasta un desarrollo mayor (§11, `deal-develop-1.0.0` con etapa previa).

```
area_libre      = area_lote − cubierta_que_queda               # demoler todo → cubierta_que_queda = 0
tinglado_m2     = min(tinglado_declarado, fos × area_lote)     # la cubierta nueva no pasa el FOS
plazas          = floor(area_libre / m2_por_plaza)             # con circulación y maniobra (§10)
capex           = demolido_m2 × costo_demolicion_m2
                + tinglado_m2 × costo_tinglado_m2
                + porton + piso_e_iluminacion
costo_total     = precio × (1 + buy_cost_pct + commission_pct) + capex
ingreso_mes     = plazas × alquiler_cochera_p25 × ocupacion
noi_anual       = ingreso_mes × 12 × (1 − gastos_pct)
rendimiento     = noi_anual / costo_total
repago_capex    = capex / noi_anual                             # años en recuperar lo invertido sobre el lote
```

- `m2_por_plaza` incluye circulación y maniobra en un lote abierto; un garaje en planta con rampas es otro caso y no entra.
- `demolido_m2`, `tinglado_declarado` y los costos unitarios se investigan
  en `F13-08` (§10) y el owner los ajusta por caso; el tinglado va por m² de
  cubierta, el portón como un monto.
- Que el uso admita cocheras (`uses_allowed`) es condición: sin eso el caso se
  niega con `parking_use_not_allowed`. Si un tinglado computa o no para el FOS
  se confirma en la consulta del municipio; mientras tanto se toma el FOS como
  tope, que es lo conservador.
- `alquiler_cochera_p25` es la banda de avisos de cochera en alquiler de la
  zona: el p25. El rango medido en Córdoba va de ARS 10.000 a ARS 105.000 por
  mes; un promedio de ciudad sería el error más caro del caso.

Dos lecturas: **rendimiento sobre el total** (lote incluido), que dice si la
cochera se sostiene sola como inversión final, y **repago del capex**, que dice
cuánto tarda en volver lo que se puso encima del lote. Sensibilidad: ocupación
60/75/90 % × alquiler p25/p50/p75.

### `deal-flip-1.0.0` — remodelar y revender

```
costo_total   = precio × (1 + buy_cost_pct + commission_pct) + obra + tenencia_mes × meses
venta_neta    = p50_terminado × m² × (1 − descuento) × (1 − sell_cost_pct − commission_pct)
ganancia      = venta_neta − costo_total
margen        = ganancia / costo_total
margen_anual  = (1 + margen)^(12 / meses) − 1
equilibrio    = costo_total / (m² × (1 − descuento) × (1 − sell_cost_pct − commission_pct))
```

`p50_terminado` sale de la banda del producto **terminado** (`condition` =
`good` o `new`), nunca del aviso a refaccionar. Sensibilidad: obra ±25 % ×
meses ±50 %.

### `deal-livein-1.0.0` — remodelar para vivir

```
costo_propio  = precio × (1 + buy_cost_pct + commission_pct) + obra + alquiler_mes × meses_obra
alternativa   = p50_terminado × m² × (1 − descuento) × (1 + buy_cost_pct + commission_pct)
diferencia    = costo_propio − alternativa          # negativo = ahorra
meses_equiv   = diferencia / alquiler_mes
```

Sin IRR: responde «¿esta casa en Juniors me sale más o menos que una terminada
en Juniors?», en dólares y en meses de alquiler. Sensibilidad: obra ±25 % ×
descuento 0/5/10 %.

### `deal-rental-1.0.0` — alquilarla

```
alquiler_anual = alquiler_p50 × 12 × (1 − vacancia)      # en USD al oficial del día
bruto          = alquiler_anual / precio
neto           = alquiler_anual × (1 − gastos_pct) / (precio × (1 + buy_cost_pct + commission_pct))
```

Es una foto del día: sin indexación ni sendero de tipo de cambio.
Sensibilidad: alquiler p25/p50/p75 × vacancia 0/8/16 %.

### `deal-develop-1.0.0` — demoler y desarrollar

```
construible     = buildable-envelope (§9)
vendible        = construible × eficiencia            # se investiga en F13-08
ventas_netas    = vendible × p50_nuevo × (1 − descuento) × (1 − sell_cost_pct − commission_pct)
costo_obra      = construible × costo_m2_obra_nueva + demolicion
residual        = (ventas_netas − costo_obra) / (1 + margen_desarrollador)
oferta_maxima   = residual / (1 + buy_cost_pct + commission_pct)
incidencia      = precio / construible                  # USD por m² construible
```

`p50_nuevo` sale de la banda de departamentos a estrenar de la zona. La
incidencia del aviso se compara con la mediana de incidencia de los terrenos y
casas a demoler del mismo barrio. `margen_desarrollador` se investiga en
`F13-08`. Sensibilidad: FOT ±0,3 × precio nuevo p25/p50/p75. Sin
zonificación, el caso se muestra sólo como sensibilidad sobre FOT.

#### Con cocheras como etapa previa

El owner puede comprar hoy, explotar el lote como cochera `años_espera` años y
desarrollar después. A grandes rasgos y a precios de hoy (sin crecimiento ni
inflación):

```
noi_espera        = noi_anual_cochera × años_espera
costo_entrada     = precio × (1 + buy_cost_pct + commission_pct) + capex_cochera
residual_luego    = residual con demolicion ya pagada       # el tinglado se desarma, sin valor de rescate
resultado_espera  = residual_luego + noi_espera − costo_entrada
resultado_ya      = residual − precio × (1 + buy_cost_pct + commission_pct)
cobertura_espera  = noi_anual_cochera / costo_entrada      # cuánto paga la cochera por año de espera
```

Se muestran juntos **desarrollar ya** y **cochera y después desarrollar**, con
`cobertura_espera` a la vista: es la cifra que dice si la cochera paga la
espera o sólo la hace más larga. Sensibilidad: `años_espera` 2/5/10 × alquiler
de cochera p25/p50/p75.

## 12. Negociación

`re_negotiation` guarda por unidad: fecha, parte, monto, moneda, condiciones y
resultado (`open`, `accepted`, `rejected`, `withdrawn`).

`negotiation-leverage-1.0.0`:

- Rango de oferta: del `p25` de la banda al precio del aviso, descontada la
  baja ya observada.
- Punto de retirada: el menor entre el `p50` y lo que el caso elegido tolera
  (equilibrio del flip, oferta máxima del desarrollo).
- Palancas con su cifra: días publicado, bajas, republicaciones, dispersión
  entre duplicados y percentil en la banda.

## 13. Lo que falta y cómo se nombra

| Código                        | Qué falta                                                    |
| ----------------------------- | ------------------------------------------------------------ |
| `zoning_unknown`              | Parcela sin zonificación; el caso va con sensibilidad de FOT |
| `location_imprecise`          | Sin dirección con número ni pin propio; sin parcela          |
| `comparable_band_unavailable` | Menos de 30 avisos del segmento                              |
| `parking_use_not_allowed`     | El patrón urbanístico no admite cocheras en esa parcela      |
| `rent_band_unavailable`       | Menos de 30 avisos de alquiler (o de cochera) en la zona     |
| `remodel_scope_undeclared`    | Sin alcance de obra ni presupuesto propio                    |
| `surface_missing`             | El aviso no publica superficie                               |
| `price_on_request`            | «Consultar precio»                                           |
| `price_currency_ambiguous`    | El aviso mezcla monedas                                      |
| `fx_unavailable`              | No hay tipo de cambio oficial en los 7 días previos          |

Nunca se completa con cero, con el promedio de la ciudad ni con otro barrio.

## 14. Oráculos

1. **Fixtures sintéticas** con los bordes: superficie nula, precio en ARS,
   «consultar precio», parcela sin zonificación, la misma casa en tres agencias,
   una republicación, un pin compartido.
2. **Capturas reales reducidas** de cada portal, congeladas en el repositorio
   por excepción del owner a la ADR 0023 (ADR 0089, Decisión 10):
   `listing-corpus-reducer-1.0.0` borra teléfonos, correos, nombres de
   particulares, URLs de fotos y scripts que no son datos; un manifiesto fija
   cada archivo por `sha256` con su fecha y su `parse_basis`.
3. **El backtest** de §8: error y cobertura contra avisos que el modelo no vio.

La suite no abre red (`tests/setup/no-network.ts`). La extensión se prueba
con Playwright cargándola desempaquetada sobre las fixtures y las capturas
congeladas.
