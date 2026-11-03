# ADR 0065: catálogo y vintages de Estadísticas Monetarias v4 del BCRA

- Estado: aceptado
- Fecha: 2026-11-02
- Alcance: `F9-01`. Decide con qué derechos entra la API de Estadísticas
  Monetarias v4 del BCRA, qué se descarga, cómo se versionan la definición de
  cada variable y sus puntos, cómo se detectan revisiones sin volver a bajar la
  historia y qué hace el parser cuando el cable cambia.
- Decisiones relacionadas: [ADR 0009](0009-egress-boundary.md) (una sola puerta
  de salida), [ADR 0017](0017-sec-history-window.md) (versión de selección y su
  ancla), [ADR 0018](0018-lighter-observation-rows.md) (filas livianas),
  [ADR 0020](0020-source-daily-budget-kill-switch.md) (cuota diaria),
  [ADR 0027](0027-cedear-registry-sources.md) (disponibilidad igual a la
  observación, guarda de retiros), [ADR 0032](0032-damodaran-reference-datasets.md)
  (releases de referencia)

## Contexto

La Fase 9 empieza por el BCRA. La versión vigente es Estadísticas Monetarias
v4: Principales Variables v3 quedó deprecada el 2026-02-28. Se midió el cable el
2026-11-02 contra `api.bcra.gob.ar/estadisticas/v4.0`:

- **Catálogo** (`/monetarias`): 1.610 variables en páginas de 1.000, cada una
  con diez campos: id, descripción, categoría, tipo de serie, periodicidad
  (`D` o `M`; el manual admite también `T`/`Q`), unidad, moneda (`ML`, `ME`,
  `MEyML`, `USD`, y `ARS` según el manual), primera y última fecha informadas, y
  último valor.
- **Metodología** (`/Metodologia`): un texto por variable, en páginas de 250.
  Promedian 310 caracteres y el más largo tiene 976.
- **Datos** (`/monetarias/{id}`): `fecha` y `valor`, nada más. El orden es de la
  fecha más reciente a la más vieja, y el límite es de 3.000 por página. El CER
  completo son 9.053 puntos. Los valores llegan siempre con once decimales.
- Errores: un `400` con `errorMessages` para id, fecha o límite inválidos. No se
  publica cuota: el control de tráfico es por IP y no tiene cifra.

Del mismo sondeo salieron tres hechos que deciden el diseño:

1. **La fecha no es la disponibilidad.** El CER ya estaba publicado hasta el
   2026-11-15, y la inflación de septiembre se fecha el 30 de ese mes aunque se
   conoce en octubre.
2. **El catálogo no sirve como sonda de frescura.** Para el CER decía
   `ultFechaInformada = 2026-11-02`, mientras los datos llegaban al 15.
3. **Hay revisiones y nadie las fecha.** La metodología de reservas avisa que el
   saldo del último día hábil del año incorpora después los ajustes del cierre
   del balance. La respuesta no trae fecha de publicación ni de revisión.

## Decisión 1 — derechos

El [aviso legal](https://www.bcra.gob.ar/aviso-legal/) es el que la página de
APIs enlaza para cada API, y su punto 6 nombra los datos que se proveen por
API. Fue leído el 2026-11-02. Permite reutilizar los contenidos «con fines
informativos, educativos o académicos» con tres condiciones: citar «Banco
Central de la República Argentina» o «BCRA», no alterar el significado ni el
contexto, y no usarlos con fines comerciales sin autorización. La
[página de APIs](https://www.bcra.gob.ar/apis-banco-central/) las ofrece «para
integrar de forma automatizada la información que publica el Banco en sistemas
propios».

El owner eligió el 2026-11-02 `approved_personal` con estos derechos:

- `allowed`: uso personal, acceso automatizado, guardado normalizado,
  derivados y export propio con atribución;
- `restricted`: la respuesta cruda, la exhibición pública y la transferencia a
  IA.

A diferencia de Yahoo o de Damodaran, el acceso automatizado **no** es
`owner_accepted`, porque la fuente lo ofrece por escrito.

## Decisión 2 — qué se baja

- El **catálogo y la metodología completos**, dos y siete requests. Son las
  definiciones de las 1.610 variables, y pesan medio megabyte.
- Las **observaciones** sólo de un set declarado en código
  (`declared-bcra-series.ts`): las 35 variables de la categoría «Principales
  Variables» tal como el catálogo la mostró el 2026-11-02. Un id nuevo es un
  diff revisable, y el runtime nunca toma «la categoría de hoy» por su cuenta.
- La **historia completa** de cada una. Sirve para comparar épocas y gobiernos
  (convertibilidad, 2001–2002, 2018–2019, las bandas de 2025) y para que la
  Fase 9 normalice en moneda: real por inflación (desde 1943) o por CER (desde
  2002), y en dólares por el mayorista (desde 2002).

Medido sobre el catálogo, la historia completa del set son unos 205.000 puntos
y 88 requests.

## Decisión 3 — una revisión por request, no una historia por corrida

La API cobra por request y no por punto: una página trae hasta 3.000. Volver a
bajar la historia completa para detectar revisiones costaría 88 requests en cada
corrida. La regla `bcra-revision-window-1.0.0` es otra:

- **Primera descarga** de una serie, o `--full`: la historia entera, paginada.
- **Actualización**: **una** request sin `desde`, que trae los 3.000 puntos más
  recientes. Equivalen a unos once años de una serie diaria hábil, ocho de una
  serie que publica todos los días, y la inflación mensual entera desde 1943.
  El set se actualiza con 35 requests.
- Se comparan sólo los puntos guardados dentro de la ventana recibida, es decir,
  desde su fecha más vieja. La corrida registra `selectionVersion =
bcra-revision-window-1.0.0` y su `selectionAnchorOn` es esa fecha. Juntas
  dicen hasta dónde se controló. Lo anterior no se mira y la corrida no afirma
  nada sobre eso.

El orden de más reciente a más viejo es parte del contrato: una página que no
viene estrictamente ordenada por fecha descendente se rechaza, porque la
ventana dejaría de ser «lo más reciente».

## Decisión 4 — disponibilidad, revisiones y retiros

Como en el registro CEDEAR, `available_at` es la **observación**: el instante en
que se recibió la última página de la corrida. Un corte anterior a la primera
descarga no ve el punto y lo dice. Nunca se usa la `fecha` del punto, que en el
CER es futura.

Cada punto es una cadena de revisiones (`macro_series_observations`):

- un punto nuevo es la revisión 0;
- un valor distinto al guardado abre la revisión siguiente y supersede la
  vigente en la observación;
- un punto guardado que deja de venir dentro de la ventana es un **retiro**:
  una revisión sin valor y marcada `withdrawn`, que una lectura no confunde con
  un faltante;
- el mismo valor no escribe nada, y una corrida sin cambios queda `duplicate`.

Si una corrida revisaría o retiraría más de un décimo de los puntos comparados
(con al menos veinte), se rechaza (`mass_change_guard`). La causa más probable
es un cambio de unidad que el catálogo no avisó, y el owner lo acepta con
`--accept-mass-change`. Un punto que el parser rechaza no cuenta como retirado.

## Decisión 5 — la definición de una variable es una versión temporal

Cada variable tiene una identidad estable (`macro_series`: fuente e id
externo, con un entero sustituto) y versiones de su definición
(`macro_series_definitions`):

- campos de la definición: descripción, categoría, tipo de serie, frecuencia
  normalizada (`daily`, `monthly`, `quarterly`), unidad, código de moneda del
  BCRA, primera fecha informada y metodología;
- campos que **no** entran: la última fecha y el último valor, que cambian todos
  los días y no definen nada.

Una definición distinta supersede a la vigente en la observación. Una variable
que el catálogo deja de listar se cierra sin sucesora. Una corrida que cerraría
más de un décimo del catálogo se rechaza (`withdrawal_guard`).

La primera descarga de observaciones **fija la base** de la serie: frecuencia,
unidad y moneda. Si una definición posterior cambia cualquiera de las tres, la
descarga de esa serie se rechaza con `definition_basis_changed`, nombrando las
dos. Mezclar miles con millones en una cadena sería un dato falso que ningún
test vería. La descripción y la metodología pueden cambiar sin bloquear.

## Decisión 6 — fallo seguro ante cambios del cable

El parser `bcra-monetarias-v4-1.0.0` lee contra el cable medido, no contra el
manual:

- **Sobre de cada respuesta**: objeto **cerrado** (una clave nueva o faltante
  rechaza la página entera), `status` igual al HTTP y paginación coherente:
  cada página trae lo que su `offset` promete, el total es el mismo en todas y
  la unión no repite ids ni fechas. Un catálogo truncado no publica nada.
- **El `count` no significa lo mismo en cada endpoint**, y el manual no lo dice.
  Medido: en el catálogo es lo que **queda** desde el `offset` (con `offset`
  1.609 da 1), mientras que en metodología y en datos es el total. El parser lo
  fija por endpoint: si la API unificara el criterio, la paginación dejaría de
  cerrar y la corrida se rechazaría en vez de leer de menos.
- **Fila del catálogo** con un vocabulario desconocido (otra periodicidad u
  otra moneda): se rechaza esa fila por campo y nombre, y la corrida queda
  `partial`. La variable conserva su definición vigente y **no** se la da por
  retirada.
- **Valores**: se leen desde el texto fuente (`parseJsonWithExactNumbers`) y
  nunca pasan por `double`. Un `valor` nulo rechaza ese punto y no se escribe
  como cero.
- **Respuestas que no son `200`**: un `400` o un `404` nombran el id; un `429` o
  un `503` cortan la corrida con su `Retry-After` sin reintentar. Ninguna
  respuesta se guarda.

## Consecuencias

- **Medido el 2026-11-02 sobre una réplica vacía**, contra el cable real:
  - catálogo: 9 requests y 1,4 MB leídos, 1.610 definiciones con su
    metodología, sin rechazos; ocupan 1,8 MB;
  - primera descarga del set: 89 requests en 3 min 18 s, 198.529 puntos,
    ninguno rechazado; 25 MB, unos 130 bytes por punto con sus índices;
  - actualización: 35 requests en 1 min 29 s y las 35 corridas `duplicate`.
    Diez series entran enteras en una página; el resto controla revisiones
    desde 2014 a 2018, según la serie;
  - conciliación: 35 de 35 `reconciled`. En nueve el dato llega más lejos que
    el catálogo (el CER y la UVA, hasta el 15 de noviembre; las bandas
    cambiarias, hasta el 30);
  - rollback: la migración baja limpia y deja las corridas.
- Las corridas son a mano (`pnpm bcra:catalog`, `pnpm bcra:series`): una para
  el catálogo y una por serie, sin cron. Dos procesos a la vez no duplican
  puntos: el índice único de la revisión vigente y la actualización condicionada
  a la revisión que el plan vio abortan al segundo.
- El ritmo es de una request cada dos segundos (30 por minuto, el de la matriz
  de uso), con un techo de 500 por proceso y 300 por día UTC.
- La conciliación con la última publicación oficial compara el último valor que
  el catálogo informa con el punto guardado en esa fecha. Si los datos ya
  llegan más lejos, como en el CER, se informa `catalog_behind` en vez de un
  error.
- El texto de la metodología se guarda: es el dato que explica la serie y está
  dentro del guardado normalizado. La respuesta cruda no se guarda, y las
  fixtures son sintéticas.
- No hay superficie: `F9-06` dibuja las series. Las transformaciones real y en
  dólares son `F9-02`.
- La revisión de derechos vence el 2027-05-01.
