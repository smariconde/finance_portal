# ADR 0027: registro CEDEAR — fuentes, derechos y vigencia

- Estado: propuesto
- Fecha: 2026-09-23
- Alcance: resuelve `F7-03`. Decide de dónde sale el registro de programas CEDEAR,
  qué derechos se declaran, qué se guarda de cada programa, cómo se resuelve la
  security subyacente y qué vigencia tiene una aserción que ninguna de las dos
  fuentes fecha. No decide cómo la matriz dibuja la marca (`F7-05`) ni la
  anotación de acceso en la valuación con el precio del CEDEAR (`F6-04`).
- Decisiones relacionadas: [ADR 0004](0004-personal-first-runtime.md) (no hay
  superficie pública), [ADR 0009](0009-egress-boundary.md) (la única puerta de
  salida), [ADR 0014](0014-declared-corporate-events.md) (una tabla parcial no
  prueba una ausencia), [ADR 0016](0016-analysis-scope-sector-matrices.md) (la
  marca CEDEAR de la matriz), [ADR 0020](0020-source-daily-budget-kill-switch.md)
  (cuota diaria), [ADR 0025](0025-declared-sector-classification.md) (supersesión
  en vez de cierre), [ADR 0026](0026-daily-prices-source.md) (`owner_accepted`)

## Contexto

La matriz de riesgo sectorial tiene que distinguir las securities a las que el
owner accede por CEDEAR, y la marca «sale del programa depositario vigente al
`as_of`, que apunta a una security concreta» ([ADR 0016](0016-analysis-scope-sector-matrices.md)).
El modelo de identidad ya tenía programa y ratio en dominio, pero no una tabla
ni una fuente.

El owner había aprobado el 2026-08-25 «el scraping de Comafi para obtener
programas y ratios de CEDEAR». Al preparar el slice se midió lo que eso implica, y
aparecieron tres cosas que cambiaban la pregunta.

**Hay dos emisores, no uno.** La CNV autoriza hoy a dos emisores de CEDEAR:
Banco Comafi y Caja de Valores. Medido el 2026-09-23: Comafi publica 364 filas y
Caja de Valores 59, sin ningún subyacente en común. Contra las 503 securities del
S&P 500 del grafo personal, Comafi cubre 154 y Caja de Valores 8 —F, UAL, MU, OXY,
UBER, PANW, MOS y ABNB—. Un registro que leyera sólo a Comafi diría de esas 8 que
no tienen CEDEAR, y sería falso: una tabla parcial no prueba una ausencia.

**Comafi prohíbe almacenar, por escrito.** Sus
[términos legales](https://www.comafi.com.ar/1759-Terminos-Y-Condiciones-Legales-De-Banco-Comafi.note.aspx)
y el pie de la página de programas dicen textualmente:

> Copyright Banco Comafi. Todos los derechos reservados. Prohibida la
> duplicación, distribución o almacenamiento en cualquier medio.

No es un «no se concede», que era el caso de Yahoo: es una prohibición explícita,
y la aprobación del 2026-08-25 es anterior a este hallazgo. Caja de Valores no
publica términos de uso para su sitio público; la
[matriz de uso](../../data/provider-use-matrix.md) la tenía en `blocked_rights`
por falta de términos que autoricen, no por una prohibición.

**Las publicaciones de un mismo emisor no coinciden.** Comafi publica el mismo
registro dos veces: una planilla descargable («LISTA TOTAL DE CEDEARS AL
17.9.2026») y el JSON que alimenta la tabla de su sitio. Comparadas por ISIN del
CEDEAR:

- la planilla tiene ratios mal escritos —`3.1` para Oracle, `25.1` para Deckers—
  que el JSON trae como `3:1` y `25:1`;
- el ISIN subyacente de Carnival es el panameño en la planilla y el bermudeño en
  el JSON, que es el vigente tras su redomicilio;
- AstraZeneca vale `2:1` en una y `4:1` en la otra;
- cada una trae programas que la otra no tiene: el JSON marca EA como «Programa
  dado de baja», y la planilla ya no lo lista.

El JSON también tiene sus errores, pero son de otra naturaleza: una segunda fila
de Western Digital sin ISIN ni ratio y con «MS» como ticker de origen, junto a la
fila válida; Talen Energy declarando el ticker de GE Vernova en su descripción;
el `15.1` de AST SpaceMobile. Son campos vacíos o que se contradicen dentro de la
misma fila, que un parser estricto puede rechazar por nombre. Los de la planilla
son valores bien formados y viejos, que ningún parser puede distinguir de los
buenos.

## Decisión 1 — las dos fuentes, declaradas `owner_accepted`

El owner decidió el 2026-09-23, sobre esta evidencia, **usar las dos fuentes**: es
la única forma de que el registro sea completo, y una marca incompleta en la
matriz sería peor que ninguna.

Las filas del registro quedan:

- `comafi-cedear` y `caja-valores-cedear` con `personalUse`, `automatedAccess`,
  `normalizedStorage`, `derivedStorage` y `export` en **`owner_accepted`**;
- `rawStorage`, `publicDisplay` y `aiTransfer` en `restricted`;
- `approved_personal`, nunca `approved_public_demo`.

`owner_accepted` significa exactamente lo que la [ADR 0026](0026-daily-prices-source.md)
le hizo significar: ninguna fuente concede el uso y el owner decidió proceder,
fechado y con motivo. Para Comafi la fila dice además **qué** prohíbe la fuente,
citando la cláusula en vez de resumirla: `owner_accepted` no borra una prohibición,
la deja a la vista en cada lectura de derechos.

Lo que se guarda son **hechos normalizados**: que existe un programa, su ISIN y
su código de Caja de Valores, el ratio como fracción exacta, el estado y la
security subyacente resuelta. Ni la respuesta JSON ni el HTML se conservan, y el
gate lo haría cumplir aunque alguien lo intentara: `rawStorage` es `restricted`.
Las fixtures de los tests son **sintéticas** por la misma razón.

## Decisión 2 — una publicación de registro por emisor

- **Comafi:** el JSON que alimenta la tabla de su sitio
  (`/custodiaglobal/json/apps/getproducts.aspx`), no la planilla. Es lo que la
  página muestra hoy y fue el correcto en cada desacuerdo que se pudo verificar.
  Sus errores son rechazables por nombre; los de la planilla, no.
- **Caja de Valores:** la tabla HTML de su página de CEDEAR
  (`/Servicios/Cedears`), que el servidor entrega renderizada y tiene columnas
  fijas.

Un request por emisor y por corrida: dos requests en total.

Se descartó exigir que las dos publicaciones de Comafi coincidan para registrar
un programa. La idea es buena —dos evidencias de la misma fuente, como en los
splits de la [ADR 0012](0012-stock-splits-share-basis.md)—, pero la planilla
arrastra valores viejos que harían fallar la coincidencia justo donde el JSON
está bien, y leerla exige un lector de XLSX —zip y XML— que el proyecto no tiene.
El desacuerdo medido queda en esta ADR como la razón de la elección.

## Decisión 3 — sólo se registra lo que resuelve a una security del grafo

El registro no constituye identidad de emisores. Un programa entra sólo si su
subyacente resuelve a una security que el grafo **ya tiene**; los demás —ETF,
ADR de empresas fuera del índice, acciones brasileñas— se cuentan fuera del
universo con su motivo (`symbol_not_in_universe`, `foreign_market`,
`debt_program`) y no se escriben. Crear entidades y securities para
esos ~260 subyacentes desde el listado de un depositario sería dejar que una
fuente sin autoridad sobre esos emisores los constituya.

La regla de resolución (`cedear-underlying-resolution-1.0.0`):

1. el **ticker de origen** identifica: se busca entre los símbolos vigentes del
   grafo en el instante de la observación. El separador de clase de la fuente
   (`BRK/B`) se traduce al del grafo (`BRK-B`);
2. el **mercado declarado** corrobora pero no decide. Un mercado estadounidense
   que no coincide con el del listing se registra con la marca
   `origin_market_stale`, porque identifica el mismo instrumento con un dato
   viejo: KMB figura en NYSE y ya cotiza en Nasdaq. Un mercado ilegible —la
   industria cargada en el campo de mercado, como en LIN, PLD y SHW— se marca
   `origin_market_unrecognized`;
3. un mercado **no estadounidense** reconocido deja el programa afuera sin buscar
   el ticker: el universo sólo tiene venues de Estados Unidos, y un ticker de B3
   o de Londres que coincidiera con uno local sería una colisión, no una
   identidad;
4. si la fila trae dos tickers —Comafi repite el de origen en la descripción— y
   resuelven a **securities distintas**, el programa se rechaza como
   `underlying_ticker_conflict`. Si uno de los dos no resuelve, es un dato viejo
   y se marca `origin_ticker_stale`: Marsh McLennan figura como `MRSH` y `MMC`.

Medido sobre el grafo personal el 2026-09-23: Comafi registra 154 programas —149
sin marca y 5 con marca: KMB con el mercado viejo; LIN, PLD y SHW con el mercado
ilegible; MRSH, que declara además su ticker anterior MMC— y rechaza 4 filas por
nombre; Caja de Valores registra 8, sin marcas. Los 162 subyacentes son 162
securities distintas del índice: ninguna clase se marca por su hermana.

## Decisión 4 — el CEDEAR es una security propia, emitida por el depositario

Sin fusionar instrumentos, que es lo que el modelo de identidad exige:

- cada depositario es una **entidad legal** declarada en código —Banco Comafi como
  `bank`, Caja de Valores como `depositary`—, con un ID fijo: ningún identificador
  que el proyecto ya tenga los nombra, e inventarles uno sería peor;
- cada CEDEAR es una **security** `depositary_receipt` cuyo emisor es el
  depositario, identificada por su **ISIN** y su **código de Caja de Valores**;
- el **programa** vincula esa security con la subyacente, con estado, alcance de
  inversor y la evidencia de la resolución —el ticker y el ISIN subyacente que la
  fuente declaró—;
- el **ratio** es una fracción exacta en su propia tabla, versionada aparte del
  programa.

El CEDEAR todavía no tiene listing ni símbolo: sólo Caja de Valores publica el
símbolo de BYMA, y el precio del CEDEAR es de `F6-04`.

## Decisión 5 — la vigencia es la observación, y los cambios supersiden

Ninguna de las dos publicaciones dice desde cuándo vale lo que publica: el JSON de
Comafi sale con `no-store` y sin fecha, y la tabla de Caja de Valores tampoco la
trae. Entonces:

- **`available_at` y `valid_from` son el instante de la observación**, que es lo
  único defendible. No es la regla de la SEC —donde la descarga nunca es la
  disponibilidad, porque la aceptación está publicada—: acá no hay nada
  publicado, y la observación es la primera fecha que se puede probar. Nunca mete
  look-ahead, porque nunca es anterior a lo que se pudo saber;
- **un ratio distinto supersede sólo al ratio**, no al programa. Superseder en vez
  de cerrar es la regla de la [ADR 0025](0025-declared-sector-classification.md):
  fechar el cambio con la corrida inventaría la fecha efectiva, que el emisor
  publica en sus avisos a tenedores y esta ingesta no lee. Separar el ratio del
  programa hace que la existencia del programa sobreviva a un cambio de ratio;
- **un estado distinto supersede al programa**: habilitado, inhabilitado para
  emitir, inhabilitado para emitir y cancelar o dado de baja;
- **un subyacente distinto no se aplica**: se rechaza como
  `underlying_changed` y va a revisión manual, como pide el modelo de identidad;
- **un programa que el emisor deja de listar se retira**: su versión y su ratio se
  supersiden sin sucesor. A diferencia del sector de la ADR 0025, acá la lista
  **es autoritativa**: es el registro que el propio emisor publica de sus
  programas, como la lista del índice lo es de sus miembros. Una corrida que
  retiraría más de la décima parte de los programas de un emisor se niega
  (`withdrawal_guard`), porque eso se parece más a una respuesta rota que a una
  ola de bajas; el owner la destraba con un flag explícito;
- **la evidencia es la de la primera aserción.** Si la fuente cambia el ticker o
  el ISIN subyacente que declara para el mismo programa, la corrida lo informa y
  no reescribe la fila: lo que la fila guarda es lo que resolvió el programa la
  primera vez, como el `taxonomyVersion` de la ADR 0025.

Consecuencia que hay que decir: un `as_of` anterior a la primera captura no ve
ningún programa. La respuesta es `not_effective_at_cutoff`, nunca «sin CEDEAR».

## Límites declarados

1. **Comafi prohíbe almacenar su contenido.** La decisión del owner lo asume y el
   registro lo cita; no lo resuelve.
2. **La vigencia empieza en la primera observación.** El registro no afirma que un
   programa existía antes de verlo.
3. **Las fechas efectivas de los cambios de ratio no se leen.** Están en los
   avisos del emisor; hasta leerlos, un cambio se supersede al observarlo.
4. **Sólo programas con subyacente en el grafo.** Un ETF o una acción fuera del
   índice no se registran aunque tengan CEDEAR.
5. **Sin listing ni precio del CEDEAR.** Es de `F6-04`.
6. **El registro está completo mientras los emisores sean dos.** Un tercer emisor
   autorizado por la CNV es una fuente nueva, no una fila más.

## Condición de revisión

- aparece un **tercer emisor** de CEDEAR;
- Comafi o Caja de Valores **publican términos** que concedan, o que prohíban con
  una consecuencia concreta;
- el **JSON de Comafi deja de responder** o cambia de forma: la planilla es el
  respaldo medido, con un lector de XLSX como costo;
- **`F6-04` necesita el ratio a una fecha pasada**: ahí hay que leer los avisos
  fechados del emisor para reemplazar la supersesión por la fecha efectiva;
- el proyecto **deja de ser personal**: invalida la decisión 1 entera.

## Consecuencias

- `comafi-cedear` pasa de `proposed` a `integrated` y `caja-valores-cedear` de
  `technical_reviewed` a `integrated`, las dos `approved_personal` con derechos
  `owner_accepted`.
- Las dos entran en la allowlist de egress con un host y un prefijo de path cada
  una, y en `SOURCE_DAILY_REQUEST_BUDGETS` con 10 requests por día.
- La migración `0020` crea `depositary_programs`, `depositary_program_versions` y
  `depositary_ratios`; el grafo persistido deja de declarar vacíos los programas.
- `pnpm cedears:record` corre a mano, en seco por defecto.

## Alternativas descartadas

- **Sólo Comafi.** Lo aprobado el 2026-08-25, y lo que dejaba a 8 securities del
  S&P 500 con una ausencia falsa.
- **Pausar y pedir permiso a los emisores.** Correcto en abstracto; el owner
  decidió no bloquear la matriz esperando una respuesta que puede no llegar.
- **La planilla de Comafi como publicación de registro.** Tiene fecha y columnas
  limpias, pero valores viejos que ningún parser distingue de los buenos, y exige
  un lector de XLSX.
- **Exigir que las dos publicaciones de Comafi coincidan.** Ver la decisión 2.
- **Constituir los subyacentes que no están en el grafo.** Ver la decisión 3.
- **Resolver por nombre de empresa.** Es difuso, y la regla tiene que ser
  determinista.
- **Cerrar el ratio viejo en la fecha de la corrida.** Inventa una fecha efectiva.
  Ver la decisión 5.
