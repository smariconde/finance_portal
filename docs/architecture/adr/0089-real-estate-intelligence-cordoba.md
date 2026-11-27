# ADR 0089: inmuebles de Córdoba — captura desde el navegador del owner y negocio a grandes rasgos

- Estado: aceptada (2026-11-27), propuesta el 2026-11-26 y revisada con el
  owner antes de aprobarla
- Fecha: 2026-11-27
- Alcance: Fase 13, `F13-01` a `F13-10`.
- Relacionadas: [ADR 0004](0004-personal-first-runtime.md) (runtime personal),
  [ADR 0005](0005-request-time-runtime-boundary.md) (el modo se resuelve en el
  request), [ADR 0009](0009-egress-boundary.md) (puerta de salida),
  [ADR 0018](0018-lighter-observation-rows.md) (una fila guarda sólo lo que no
  puede reconstruir), [ADR 0020](0020-source-daily-budget-kill-switch.md)
  (cuota diaria y kill switch), [ADR 0023](0023-frozen-sec-extracts-rights.md)
  (extractos congelados; esta ADR le hace una excepción),
  [ADR 0065](0065-bcra-monetary-catalog-vintages.md) (series del BCRA y tipo
  de cambio mayorista),
  [ADR 0078](0078-owner-read-only-mcp.md) (segundo secreto y bypass de Vercel
  para una superficie del owner), [ADR 0079](0079-new-data-since-last-visit.md)
  (lo nuevo desde la visita anterior), [ADR 0083](0083-consensus-estimates-forward-pe.md)
  (revisión sólo cuando algo cambia).

## Contexto

El 2026-11-26 el owner pidió sumar al portal una sección de inversión
inmobiliaria en Córdoba Capital: juntar avisos de venta de casas,
departamentos y terrenos, guardarlos y decidir con números:

1. **Si el precio está bien** para su ubicación y su tipo, y si viene bajando.
2. **Qué se puede construir** ahí según la normativa municipal.
3. **Qué conviene hacer**: cocheras mensuales, remodelar y revender, remodelar
   para vivir (Juniors, Rogelio Martínez), alquilar, o demoler y desarrollar.
   Y con qué margen se puede negociar.

Es un análisis **a grandes rasgos**: decide si un inmueble merece que el owner
lo mire en serio. Impuestos sobre la renta, tasas municipales, indexación de
contratos y la operatoria fina quedan afuera; el owner los analiza por su
cuenta cuando un caso le interesa.

El portal hoy valúa **empresas que cotizan**. Un inmueble no tiene filings ni
precio de mercado continuo. Lo que se comparte es la disciplina: identidad
versionada, observación con su fecha, fórmula determinista con versión y hash,
y provenance a la vista.

### La restricción que ordena el diseño

Los portales argentinos no publican API de avisos. Lo medido el 2026-11-26
con `curl` sin sesión:

| Host                            | `robots.txt`                  | Lectura de la búsqueda            |
| ------------------------------- | ----------------------------- | --------------------------------- |
| `remax.com.ar`                  | `403 {"message":"Forbidden"}` | `403`                             |
| `zonaprop.com.ar`               | `301` a Cloudflare            | Cloudflare challenge              |
| `www.argenprop.com`             | `403` (CloudFront)            | `403`                             |
| `inmuebles.mercadolibre.com.ar` | `403`                         | `403`                             |
| `www.properati.com.ar`          | `403`                         | `403`                             |
| `mudafy.com.ar`                 | `200`, 660 bytes              | `200`, con `sitemap_listings.xml` |

Desde un servidor no hay camino. Desde un navegador real, sí: el mismo que el
owner usa para mirar avisos.

## Antecedentes

- **PropertyWebScraper** (código abierto) mantiene mapas de campos por portal y
  extensiones que capturan la página que el usuario ya abrió: el parser vive en
  el repositorio y el servidor recibe un objeto cerrado.
- **WXT** (MIT, 0.21.x) es el framework por defecto para extensiones MV3:
  entrypoints por archivo, Vite y salida para Chrome y Brave desde el mismo
  código. Plasmo lleva más de un año sin release.
- **AVM inmobiliarios** publican una banda, no un número. La banda es lo que se
  copia.
- **El Observatorio del Mercado Inmobiliario de IDECOR** releva ofertas desde
  2017 y publica mapas de valor de la tierra urbana y de alquileres. Es un
  oráculo y un insumo posibles; se mide cuando toque su slice.

## Decisión 1 — uso personal, en el navegador del owner, sin que el portal lo distinga

La extensión es de **uso personal** y los datos son del owner. Por decisión
del owner no se leen ni se citan los términos de uso de los portales: la
extensión mira lo que el owner miraría, al ritmo en que lo miraría, en su
propio navegador. Las filas de esas fuentes en el registro son
`owner_accepted`, sin cláusula citada, y `publicDisplay`, `export` y
`aiTransfer` quedan `restricted`: los datos no salen del portal personal.

El objetivo operativo es **pasar desapercibido**, y eso se logra pareciéndose
a una persona, no peleando con el sitio:

- **Perfil dedicado** de Brave o Chrome, sin sesión iniciada en ningún portal:
  un bloqueo no puede alcanzar la cuenta de Mercado Libre ni la de Mercado
  Pago del owner.
- **Una pestaña, en serie, a paso humano**, con pausas largas intercaladas y
  sin ráfagas.
- **Un desafío detiene ese portal por el día.** Un Cloudflare challenge o un
  CAPTCHA significan que el sitio ya sospecha; insistir es lo que convierte una
  sospecha en un bloqueo. No se resuelven desafíos, no se usan proxies, no se
  rota IP ni se falsea la huella del navegador: no por pudor, sino porque son
  exactamente las señales que delatan a un robot.

## Decisión 2 — extensión WXT/MV3, cargada desempaquetada, nunca en una tienda

`extensions/listings/` con WXT, TypeScript y Manifest V3, cargada como
extensión desempaquetada en el perfil dedicado de Brave o Chrome. No se publica
en la Chrome Web Store: no hace falta revisión, política de privacidad ni
permisos mínimos para un tercero. Actualizar es `pnpm extension:build` y
«Recargar» en `brave://extensions`.

### Cómo lee una página

Cada adapter lee en orden y declara qué base usó (`parse_basis`):

1. **JSON-LD** (`schema.org`) si la página lo publica.
2. **Estado embebido** de la aplicación (`__NEXT_DATA__`,
   `__PRELOADED_STATE__` o equivalente).
3. **Selectores de CSS** (`portal-selectors-1.0.0`), como último recurso.

Los datos estructurados cambian mucho menos que el HTML. Si ninguna base cierra
el contrato, la captura se rechaza por nombre y lo ya guardado sigue
leyéndose.

### El agente mira el portal antes de escribir su parser

Antes de fijar un adapter, el agente abre el portal en Brave o Chrome
—Playwright con el navegador instalado y un perfil propio, o Claude in
Chrome— y mide: qué datos estructurados hay, qué campos publica la ficha y
cuáles el listado, cuántos avisos por página, cómo pagina, cómo se ve un
desafío. Lo medido queda en el slice y se congela como captura reducida
(Decisión 10).

### Captura al ver y barrido programado

- **Captura al ver** (`F13-02`). Todo aviso o listado que el owner abre en el
  perfil se captura.
- **Barrido programado** (`F13-03`), encendido por defecto, en su propio slice
  y sólo después de medir con la captura al ver con qué frecuencia aparecen
  desafíos. `chrome.alarms` una vez por día de Buenos Aires con jitter de ±90
  minutos; una ventana propia; prioridad por cola —avisos seguidos, búsquedas
  guardadas por «más recientes», fichas sin ver hace tiempo para confirmar su
  estado, y el resto rotando—; tope de **25 páginas por portal por día** que
  sólo puede bajar; cursor persistido, así que un Chrome cerrado a mitad del
  barrido retoma desde ahí; cobertura medida y mostrada.

  Tres interruptores independientes: el popup, el tope guardado y el kill
  switch del endpoint. Un desafío detiene el portal por el día («bloqueado»);
  dos días seguidos bloqueado lo pausan hasta que el owner lo reactive.

### Cómo se agrega un portal

Un adapter y una línea en `portals/registry.ts`, que es la única lista. El
manifest deriva los `host_permissions` de ahí. Un test falla si un adapter no
declara un campo obligatorio del contrato, si su `match` se solapa con otro o
si un selector obligatorio está vacío.

### Envío

`POST /api/inmuebles/captura`, con el patrón de dos secretos de la ADR 0078:
bypass de Vercel y `Authorization: Bearer <CAPTURE_TOKEN>`. Lo envía el
service worker, nunca el content script. Sólo en modo `personal`, esquema
cerrado, tope diario de filas, idempotente por
`(fuente, id externo, hash del contenido)`, y sin componer nada en un runtime
trabado. Si el endpoint no responde, la extensión encola y reintenta después.
Alternativa sin red: exportar un JSON y `pnpm inmuebles:import`.

## Decisión 3 — cuatro identidades; una revisión sólo cuando algo cambia

Con la misma lógica que `legal_entity → security → listing → listing_symbol`:

- **`re_parcel`**: la parcela catastral, versionada. Una subdivisión o fusión
  cierra una versión y abre otra.
- **`re_property`**: la unidad que se vende (casa, departamento, terreno,
  cochera). Su vínculo con la parcela es una **afirmación con confianza**
  (Decisión 6), porque casi ningún aviso publica la nomenclatura.
- **`re_listing`**: el aviso, con clave `(fuente, id externo)`. Lleva su
  `first_seen_at` y su `last_seen_at`.
- **`re_listing_revision`**: append-only, y **sólo cuando algo cambia**
  (precio, moneda, superficie, estado o hash del contenido). Volver a ver un
  aviso igual sólo mueve `last_seen_at`.

Dos reglas de ausencia:

- **No aparecer en un barrido no es una baja.** El barrido es parcial. Un aviso
  pasa a `removed` sólo cuando su ficha responde «finalizado» o `404`; lo que
  no se vio queda como «no visto desde».
- **Una republicación no es un aviso nuevo para el análisis.** Cuando el mismo
  inmueble vuelve con otro ID, la deduplicación lo une y los días publicados
  cuentan desde la primera aparición. La republicación misma es una palanca de
  negociación.

## Decisión 4 — deduplicación con huellas calculadas en el navegador

La misma casa publicada por tres agencias se reconoce con huellas que la
extensión calcula y envía, sin guardar texto ni fotos:

- **dHash** de las primeras fotos, calculado en el service worker con la CDN
  de fotos del portal en `host_permissions`.
- **SimHash** de la descripción normalizada, que tolera la reescritura de
  cada agencia.
- **Dirección normalizada** por Georef y superficie.

`listing-dedup-1.0.0` puntúa con pesos versionados; arriba del umbral alto
afirma el vínculo; en la franja media deja un candidato que el owner confirma
o descarta desde la ficha. La dispersión de precios entre duplicados es una
señal propia.

## Decisión 5 — el precio publicado no es el precio de cierre

Todo lo capturado es **precio de oferta**. El motor de comparables devuelve un
**intervalo predictivo para esa unidad** —p25, p50 y p75 de USD/m² dados sus
atributos— y el percentil del aviso dentro de él. No es la distribución del
barrio ni un «precio objetivo». La banda se valida contra avisos que el modelo
no vio: un rango p25–p75 tiene que contener alrededor de la mitad de ellos.
Junto a la banda van los ocho comparables más cercanos, con sus diferencias,
porque para negociar se usan avisos concretos y no coeficientes.

El descuento de cierre es un supuesto (`closing-discount-1.0.0`) y cada caso
se muestra con 0, 5 y 10 %. Mudafy midió una mediana de 0 % en noviembre de
2026, pero es una sola inmobiliaria.

## Decisión 6 — ubicación: la dirección con número manda

La ubicación perfecta no existe, pero una dirección con número alcanza para
cruzar la parcela, el barrio y la ordenanza:

1. Dirección con altura → **Georef** (`/direcciones`, provincia Córdoba,
   departamento Capital), que normaliza la calle y devuelve coordenadas. Es una
   fuente nueva del servidor: entra en el registro, la allowlist y la cuota
   antes de su primer pedido, y normaliza en lotes.
2. El pin del portal, si existe, es otra evidencia. Un pin compartido por
   muchos avisos es el centro del barrio, no la casa.
3. Punto en polígono contra las capas de barrio, parcela y patrón urbanístico.

`location-precision-1.0.0` nombra el resultado: `address_geocoded`,
`portal_pin`, `portal_pin_shared` o `neighborhood_only`. Una distancia grande
entre el geocodificado y el pin se marca. El barrio sale del polígono, nunca
del texto que escribió la agencia.

## Decisión 7 — la zonificación declara su confianza y alimenta la envolvente

`zoning-resolution-1.0.0` devuelve patrón urbanístico, FOS, FOT, altura máxima
y usos admitidos, con la norma, la fecha de observación y su confianza:
`official_query` (el owner consultó al municipio), `official_map` (capa
publicada por el municipio o IDECOR), `corridor_inferred` o `unknown`. Sólo
`official_query` es documento oficial y la ficha lo dice. `unknown` no se
completa: el caso se muestra con sensibilidad de FOT.

`buildable-envelope-1.0.0` convierte eso en metros construibles. Es el insumo
del caso desarrollo y lo que hace comparable un terreno con una casa vieja.

Qué capa se lee —IDECOR, Mapas Córdoba o los mapas que el municipio digitalizó
con IDECOR— se mide en el slice.

## Decisión 8 — cinco casos, deterministas y a grandes rasgos

Cada caso es una corrida con versión y hash y una sensibilidad sobre sus dos
variables más fuertes. Las fórmulas viven en
[`docs/real-estate/market-model.md`](../../real-estate/market-model.md).

- **`deal-parking-1.0.0`**: inversión baja sobre el **lote**: demoler parte
  o toda la construcción, tinglado dentro del FOS, portón y autos. Plazas,
  alquiler de cochera de la zona y ocupación; rendimiento sobre el total y
  repago de lo invertido encima del lote. Sólo si el patrón admite cocheras.
- **`deal-flip-1.0.0`**: compra, obra y tenencia contra la venta como producto
  **terminado**; ganancia, margen y precio de equilibrio.
- **`deal-livein-1.0.0`**: lo que cuesta la casa terminada contra comprar una
  ya hecha en la misma zona, en dólares y en meses de alquiler.
- **`deal-rental-1.0.0`**: rendimiento bruto y neto de alquilarla hoy.
- **`deal-develop-1.0.0`**: demoler y construir lo que admite la parcela.
  **Incidencia** (USD por m² construible) y **valor residual del lote** (lo
  máximo que conviene pagar). Es lo que dice si una casa vale más como terreno.
  Con una **etapa previa de cocheras** opcional: comprar, explotar el lote con
  el tinglado unos años y desarrollar después, comparado con desarrollar ya y
  con cuánto de la espera paga la cochera.

Simplificaciones deliberadas:

- Costos de compra y de venta como **dos porcentajes** con su rango medido
  (`transaction-costs-cordoba-1.0.0`), más la comisión. Sin desglose por
  impuesto.
- Gastos operativos como **un porcentaje** del ingreso. Sin impuestos sobre la
  renta, sin tasas municipales y sin indexación.
- Costo de obra anclado en el **ICC-Córdoba** (costo por m² de la Dirección
  General de Estadística y Censos) con un multiplicador por alcance
  (`remodel-scope-1.0.0`). Los valores de cada parámetro se investigan al
  hacer el slice, no se fijan antes.
- Un monto en pesos pasa a dólares al **tipo de cambio oficial mayorista del
  BCRA** (Comunicación A 3500) guardado por la Fase 9: el del día o el último
  publicado antes, con 7 días como máximo, y se nombra. Decisión del owner: el
  oficial antes que el CCL.

## Decisión 9 — la negociación se registra; el portal no contacta a nadie

`re_negotiation` guarda ofertas, contraofertas, fechas y resultado.
`negotiation-leverage-1.0.0` calcula un rango de oferta, un punto de retirada
y las palancas con su cifra: días publicado, bajas, republicaciones,
dispersión entre duplicados y percentil en la banda. Son cifras con origen; no
hay guion ni mensajes.

## Decisión 10 — excepción a la ADR 0023: capturas reales reducidas en el repositorio

Por decisión del owner, esta fase congela **capturas reales** de cada portal
en el repositorio como oráculo del parser, aunque los portales no tengan
derechos `allowed`. Es una excepción acotada a la Fase 13: cada captura pasa
por un reductor versionado (`listing-corpus-reducer-1.0.0`) que borra
teléfonos, correos, nombres de particulares, URLs de fotos y scripts que no
son datos, y queda fijada por `sha256` en un manifiesto con su fecha. La ADR
0023 sigue valiendo para todo lo demás.

## Decisión 11 — la superficie abre con lo que cambió

`/inmuebles` abre con lo nuevo desde la visita anterior (patrón ADR 0079):
avisos nuevos debajo del p25 de su banda, bajas de precio, republicaciones y
bajas confirmadas, filtrado por las búsquedas del owner. La ficha suma notas
de visita estructuradas (humedad, estructura, orientación, ruido), que
alimentan el alcance de obra.

El mapa es MapLibre con un archivo **PMTiles** de Córdoba servido como asset
propio: sin teselas de terceros en cada render, sin cuota y sin egress. Las
capas de IDECOR, si se usan, las carga el navegador como overlay.

## Decisión 12 — base de análisis, módulo propio

Tablas `re_*` en la base de análisis con la próxima migración libre, y
`src/modules/real-estate/` como dominio puro: no importa el motor de empresas
ni frameworks. No va a la base de trading. El endpoint de captura es una
frontera nueva y su superficie entra al threat model en `F13-02`.

## Fuera de alcance

- Comprar, vender, alquilar o contactar a nadie.
- Tasaciones con validez legal o bancaria: todo es _screening_ y se rotula así.
- Impuestos sobre la renta, IVA, Ingresos Brutos, tasas municipales,
  indexación de alquileres y sendero de tipo de cambio: son operatoria y el
  owner los mira por su cuenta.
- Publicar la extensión en una tienda.
- Alquiler temporario, fideicomisos y pozo: candidatos, no slices.
- Otras ciudades.
- Publicar o exponer los datos fuera del portal personal.

## Decisiones del owner

2026-11-26:

1. La captura es una extensión sobre el navegador del owner, no un bot en un
   servidor.
2. Los casos que importan son cocheras, remodelar y revender, y remodelar para
   vivir; la renta tradicional se suma como costo de oportunidad.
3. Alcance: Córdoba Capital, casas, departamentos y terrenos.
4. Empezar por Remax y sumar portales midiendo cada uno.
5. Es una fase especial, separada del motor de empresas.
6. El barrido programado va encendido por defecto, con tope, jitter y pausa.
7. Agregar un portal es un adapter y una línea en el registro.

2026-11-27:

8. Se congelan capturas reales reducidas en el repositorio (Decisión 10).
9. La extensión es de uso personal: sin tienda ni política de privacidad.
10. Una revisión sólo cuando algo cambia.
11. No se leen los términos de uso de los portales; la extensión los navega
    como el owner, sin que lo distingan.
12. Sin impuestos, tasas ni indexación: el análisis es a grandes rasgos.
13. La ubicación sale de la dirección con número, cruzada con el mapa y la
    ordenanza.
14. El barrido programado va en un slice propio, después de la captura al ver,
    y lo más robusto posible; el agente usa Brave o Chrome para medir cada
    portal antes de fijar su parser.
15. Qué fuente oficial se usa para parcelas, zonificación y valor de la tierra
    se decide en el slice que la necesita.
16. Fase aprobada el 2026-11-27.
17. Los pesos pasan a dólares al tipo de cambio oficial mayorista del BCRA,
    no al CCL.
18. Los valores de los parámetros (m² por plaza, costos de demolición y
    tinglado, eficiencia vendible, margen del desarrollador, gastos,
    multiplicadores de obra) se investigan durante la fase, en el slice que
    los usa.

## Consecuencias

- La Fase 13 comparte con la valuación de empresas sólo las convenciones.
- Un portal que cambia sus datos estructurados o su HTML rompe su adapter por
  nombre; lo guardado sigue con su fecha.
- Si Chrome está cerrado o el barrido apagado, el mercado se congela y la
  ficha lo dice: la frescura es una consecuencia de la captura.
- Ninguna cifra de un caso es una tasación: es la cuenta mínima para decidir
  si vale la pena mirar más.
- La zonificación nunca es verdad: es una lectura fechada con confianza, y un
  FOT mal leído se ve en la sensibilidad.
