# ADR 0076: cuenta Schwab de solo lectura y diario de trading

- Estado: aceptada por el owner el 2026-11-13.
- Fecha: 2026-11-13.
- Alcance: enmienda [`01_PRODUCT_AND_SCOPE.md`](../../finance-portal-masterplan/01_PRODUCT_AND_SCOPE.md)
  para admitir la conexión de **lectura** a un broker; abre la Fase 11.
- Relacionadas: [ADR 0004](0004-personal-first-runtime.md),
  [ADR 0005](0005-request-time-runtime-boundary.md),
  [ADR 0008](0008-remote-personal-access.md),
  [ADR 0009](0009-egress-boundary.md),
  [ADR 0015](0015-durable-ingestion-jobs.md),
  [ADR 0020](0020-source-daily-budget-kill-switch.md),
  [ADR 0033](0033-ai-layer-industry-resolution.md),
  [ADR 0057](0057-neon-hosted-postgres.md) y
  [ADR 0073](0073-neon-free-network-transfer-recovery.md).

## Contexto

El owner opera acciones de EE.UU. en una cuenta de Charles Schwab. Hace swing
trading y, desde que la reforma de la FINRA Rule 4210 eliminó la figura de
_pattern day trader_ el 2026-06-04, también day trading. Ejecuta a mano en
thinkorswim.

Para seguir esos trades tiene una webapp Flask privada, revisada el
2026-11-13. Es de solo lectura y ofrece un planner con 2 % de riesgo por trade
y 6 % de cartera, una barra stop–entrada–precio–target sobre las posiciones,
un diario FIFO y un armador de URLs de Finviz. Sirve como lista de funciones,
no como código:

- guarda los tokens de Schwab en la cookie de sesión de Flask, que está firmada
  pero no cifrada;
- tiene rutas de escritura que no verifican sesión;
- calcula en `float` y no contempla cortos ni el multiplicador de opciones.

El alcance del portal excluía «ejecución de órdenes, conexión a broker o
custodia» y «datos tick-by-tick o promesa de tiempo real».

La Trader API – Individual de Schwab tiene estas propiedades:

- Agrupa dos productos: _Accounts and Trading Production_ y _Market Data
  Production_.
- Usa OAuth 2 con authorization code y un callback HTTPS registrado en la app.
- El access token dura 30 minutos. El refresh token dura 7 días y no se puede
  extender: pasado ese plazo, sólo un login humano en el navegador lo renueva.
- No ofrece paper trading. Lo que se envía opera con dinero real.
- La app tiene un _Order Limit_ de 0 a 120 órdenes por minuto por cuenta. Con
  0, Schwab rechaza toda orden con `429` aunque el resto funcione.
- El streaming admite una conexión por usuario, que thinkorswim ya ocupa.

El 2026-11-09 el proyecto Neon de análisis agotó los 5 GB de transferencia de
noviembre ([ADR 0073](0073-neon-free-network-transfer-recovery.md)).

El 2026-11-13 el owner decidió tres cosas:

- los trades se hacen a mano desde su computadora y el portal no manda
  órdenes;
- lo que importa es la cuenta conectada y lo informativo bien pulido;
- los datos de trading viven en una base aparte de la de análisis.

## Decisión

### 1. Alcance: lectura de la cuenta, nunca órdenes

Entra en el alcance:

- la conexión OAuth a la cuenta Schwab del owner;
- la cuenta en vivo: posiciones, saldos, poder de compra intradía y overnight,
  y órdenes abiertas, sólo para verlas;
- las transacciones de la cuenta guardadas como hechos y, derivados de ellas,
  los round trips, el P&L del día, el calendario y las estadísticas;
- el diario por trade (setup, notas, plan, rutina), el planner 2 % / 6 % y
  las reglas propias como alertas;
- lecciones de análisis técnico atadas a etiquetas de setup del diario.

Queda fuera:

- enviar, reemplazar o cancelar órdenes;
- la automatización;
- el streaming y los datos tick-by-tick;
- transferir datos de la cuenta a una IA, incluido un MCP de solo lectura.
  Eso pide una ADR propia. La [ADR 0078](0078-owner-read-only-mcp.md) la
  abre para lo guardado (diario, estadísticas y plan) y la mantiene cerrada
  para la cuenta en vivo y las credenciales.

`01_PRODUCT_AND_SCOPE.md` cambia en consecuencia: la conexión de lectura entra
y la ejecución de órdenes, la custodia y el tiempo real siguen fuera.

### 2. Las órdenes son inalcanzables por construcción

Hay tres controles independientes; ninguno depende de otro.

1. **La puerta de egress.** `schwab-trader` y `schwab-marketdata` se declaran
   `GET`, que la puerta acepta como único método de la fuente. La única
   fuente `POST` es `schwab-oauth`, acotada al path `/v1/oauth/token`. Ninguna
   entrada admite `POST`, `PUT` ni `DELETE` sobre `/trader/v1/`, y un test de
   la allowlist lo fija.
2. **El código.** Ningún adaptador, servicio ni Server Action expone una
   operación de orden, y el dominio no tiene tipos para órdenes salientes.
3. **Schwab.** La app se configura con _Order Limit_ 0, de modo que un token
   filtrado tampoco puede operar. El owner registra el valor en el backlog al
   configurar la app. No se prueba enviando una orden.

### 3. Una base aparte, en otro proyecto de la misma cuenta de Neon

El owner autorizó crear el proyecto, y existe desde el 2026-11-13:

| Atributo     | Valor                                                      |
| ------------ | ---------------------------------------------------------- |
| Proyecto     | `finance_portal_trading` (`wispy-term-56128846`)           |
| Cuenta       | la misma cuenta y organización que el proyecto de análisis |
| Región       | AWS N. Virginia (`aws-us-east-1`), junto a `iad1`          |
| PostgreSQL   | 17                                                         |
| Rama         | `production`                                               |
| Base y owner | `finance_portal_trading` y `finance_portal_trading_owner`  |
| Plan         | Free                                                       |

Se separa por tres razones; el volumen no es una de ellas, porque los datos
de trading son unos pocos KB por día:

- **Cuota propia.** Cada proyecto tiene sus 5 GB de transferencia y su GB de
  almacenamiento. Si el proyecto de análisis vuelve a agotar su cuota, la
  cuenta y el diario siguen funcionando.
- **Credenciales propias.** Filtrar la conexión de la base de análisis no
  expone la cuenta, y al revés.
- **Recuperación distinta.** Casi todo lo de análisis se vuelve a descargar.
  Las notas del diario no, y su base tiene su propio snapshot manual.

No se usa otra cuenta de Neon. El plan Free admite muchos proyectos por
cuenta, cada uno con su cuota. Además, la política de uso aceptable de Neon
advertía que crear varias cuentas puede terminar en un bloqueo por mal uso del
plan gratuito; la página vigente remite a la de Databricks.

La base tiene su propia configuración:

- **Conexiones.** `TRADING_DATABASE_URL` es la conexión pooled del runtime,
  con un rol limitado a DML como el de la ADR 0057.
  `TRADING_DATABASE_DIRECT_URL` es la directa y sólo la usan las migraciones.
- **Migraciones y comandos.** El schema y las migraciones son propios, en
  `drizzle-trading/` y con pares de rollback, y tienen sus comandos
  `db:trading:*`, incluido el estado contra Neon.
- **Local.** El contenedor existente suma dos bases:
  `finance_portal_trading` y `finance_portal_trading_test`.
- **Recuperación.** Rige la ADR 0073: snapshot manual verificado antes de
  migrar Production, y transferencia medida antes de una carga grande.

No hay SQL entre las dos bases. Cruzar una posición con su valuación, su
sector o su acceso CEDEAR se hace en la aplicación, con la identidad resuelta
al corte. El cruce es opcional: si la base de análisis no responde, la cuenta
se muestra igual y el cruce dice por qué falta.

### 4. Modos y configuración

- Las superficies de la cuenta sólo existen en `personal`. El modo se resuelve
  en el request ([ADR 0005](0005-request-time-runtime-boundary.md)) y las
  rutas declaran `instant = false`.
- Además necesitan su configuración: la base de trading y las credenciales de
  Schwab. Si falta alguna, la superficie nombra la variable que falta y el
  resto del portal no cambia.
- `locked` no abre ninguna de las dos bases ni Schwab.
- Las variables de Schwab y de la base de trading existen sólo en local y en
  Production. Preview no las recibe (`TM-14`): su URL cambia en cada deploy y
  no coincidiría con un callback registrado.

### 5. Credenciales, tokens y cuenta

- **App de Schwab.** `SCHWAB_APP_KEY` y `SCHWAB_APP_SECRET` llegan a Schwab
  sólo como autenticación Basic, que agrega la puerta hacia `schwab-oauth`.
- **Clave del módulo.** `TRADING_SECRET_KEY` (32 bytes) es la única clave
  propia. HKDF-SHA256 deriva de ella una subclave por uso: cifrado de tokens
  y HMAC de cuenta. Nunca se guarda en la base.
- **Tokens.** El access y el refresh token se guardan cifrados con AES-256-GCM
  en la base de trading, cada uno con su vencimiento. Si Schwab entrega un
  refresh token nuevo, reemplaza al anterior.
- **Credencial dinámica.** La puerta agrega el bearer hacia `schwab-trader` y
  `schwab-marketdata` desde un proveedor server-only que descifra y renueva el
  token. Ningún adaptador lo ve. Es una forma nueva de credencial: la
  ADR 0033 sólo leía variables de entorno.
- **Dónde no aparecen.** Ni los tokens ni las claves aparecen en cookies,
  URLs, logs, errores, HTML ni RSC. El gate de centinelas del build suma estas
  variables.
- **Número de cuenta.** Nunca se guarda completo. La cuenta se identifica con
  un HMAC-SHA256 del número y se muestran sus últimos cuatro dígitos. El
  `hashValue` que exige Schwab se resuelve con `/accounts/accountNumbers` y no
  sirve de identificador.

### 6. Conexión y login semanal

- **Inicio.** `connectSchwab` es una Server Action sin input. Genera un
  `state` de 32 bytes aleatorios y guarda su hash con 10 minutos de vida.
  Lo pone en una cookie `httpOnly`, `Secure` y `SameSite=Lax`, y redirige a
  `https://api.schwabapi.com/v1/oauth/authorize` con el `redirect_uri` de
  `SCHWAB_CALLBACK_URL`.
- **Callback.** `GET /cuenta/schwab/callback` es una Route Handler.
  Resuelve el modo y exige que el `state` del query coincida con el de la
  cookie y con uno guardado, vigente y sin usar; un `state` se usa una sola
  vez. Después cambia el código por tokens a través de la puerta, los guarda
  cifrados y redirige a `/cuenta` con un código de resultado. Nunca devuelve
  el input. Un error lleva `request_id` y no expone detalles
  ([controles de frontera](../../security/threat-model.md#route-handler-o-server-action)).
- **Callbacks registrados.** La app de Schwab registra el callback local
  (`https://127.0.0.1:<puerto>/cuenta/schwab/callback`) y el de Production.
  Cambiar los callbacks puede pedir una re-aprobación de días, así que ambos
  se piden juntos al configurar la app.
- **Login semanal.** La superficie muestra cuándo vence el refresh token y
  avisa 24 horas antes. Vencido, ofrece «Reconectar». El portal nunca guarda
  la contraseña de Schwab ni intenta un login automático.

### 7. Fuentes, derechos y presupuesto

Tres fuentes, cada una con su fila en el registro y en la allowlist de
`api.schwabapi.com`:

| Fuente              | Método | Paths                                                                            |
| ------------------- | ------ | -------------------------------------------------------------------------------- |
| `schwab-oauth`      | `POST` | `/v1/oauth/token`                                                                |
| `schwab-trader`     | `GET`  | `/trader/v1/accounts`                                                            |
| `schwab-marketdata` | `GET`  | `/marketdata/v1/quotes`, `/marketdata/v1/pricehistory`, `/marketdata/v1/markets` |

- **Derechos.** Las tres filas nacen en `rights_review_pending` y la red no se
  abre hasta que el owner lea los términos de la Trader API. Esos términos
  están detrás del login del portal de desarrolladores y no se pudieron leer
  el 2026-11-13. Se espera este resultado:
  - los datos de la cuenta son del owner y se guardan normalizados;
  - las cotizaciones se muestran y no se guardan;
  - el payload crudo, el export, la exhibición pública y la transferencia a
    IA quedan `restricted`.
- **Presupuesto.** Cada fuente tiene un tope diario en
  `SOURCE_DAILY_REQUEST_BUDGETS`, por debajo de los 120 pedidos por minuto
  que reportan fuentes secundarias, y su kill switch.
- **Cotizaciones.** Se piden sólo con la página visible y sólo para símbolos
  con posición abierta. El intervalo y los topes se fijan con mediciones en
  el slice de la cuenta.

### 8. Qué se guarda y qué se lee al momento

| Dato                                                                 | Dónde vive                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------ |
| Cuenta (HMAC, últimos cuatro dígitos, tipo)                          | base de trading                                              |
| Tokens                                                               | base de trading, cifrados                                    |
| Transacciones normalizadas                                           | base de trading, con revisiones                              |
| Anotaciones del diario y reglas propias                              | base de trading                                              |
| Posiciones, saldos, poder de compra, órdenes abiertas y cotizaciones | se leen en el request y se muestran con su hora (LIVE/STALE) |

Cada transacción guarda:

- el ID de Schwab, el tipo, la hora de ejecución y la fecha de liquidación;
- el instrumento: símbolo, CUSIP, tipo de activo y multiplicador;
- la cantidad, el precio, las comisiones y el `netAmount`, en decimal;
- la hora en que el portal la vio y su cadena de revisiones.

Una corrección de Schwab es una revisión nueva, nunca un update en el lugar.
Una transacción que desaparece queda `withdrawn`. No se guarda el payload
crudo. El parser es cerrado: un schema que cambia pone la corrida en
cuarentena (`TM-05`).

Dos datos se miden con la cuenta real antes de fijar el parser: qué campo da
la hora exacta de ejecución (la transacción o la orden ejecutada) y el rango
máximo de fechas por pedido.

Abrir la cuenta o el diario pide lo que falta desde la última marca de agua.
Lo hace un job durable `schwab_transactions_refresh` con el lease y la
admisión de las ADR 0015 y 0020, como las superficies de las ADR 0030 y 0070.

### 9. Fórmulas

Todas son puras, decimales y versionadas, con tests de nulo, cero, negativo,
moneda distinta y resultado no finito:

- `trade-round-trip-fifo-1.0.0`: empareja por FIFO, por cuenta e
  instrumento, largos y cortos, con el multiplicador de opciones y las
  comisiones prorrateadas. Invariante: el P&L de un round trip cerrado es
  exactamente la suma de los `netAmount` que consume.
- `trading-session-ny-1.0.0`: la sesión es la fecha en `America/New_York`. Un
  day trade abre y cierra en la misma sesión.
- `trade-r-multiple-1.0.0`: R es el P&L sobre el riesgo inicial,
  `|entrada − stop| × cantidad × multiplicador`. Sin stop declarado es `null`
  con el motivo `no_planned_stop`, nunca cero.
- `trading-stats-1.0.0`: win rate, expectancy en R, profit factor (`null` sin
  pérdidas, nunca infinito) y drawdown sobre la curva realizada. Corta por
  setup, hora, día de la semana, ticker y day trade o swing.
- `position-size-risk-1.0.0`: el planner 2 % / 6 % del Flask, con el valor de
  liquidación leído de Schwab.
- `trading-rules-1.0.0`: pérdida máxima diaria, máximo de trades y corte
  después de N pérdidas. Son alertas y no bloquean nada.

El método de lotes es FIFO. Si la cuenta usa otro método de costo, el total
realizado de un período no coincidirá con el de Schwab, y la diferencia se
nombra en vez de esconderse.

### 10. Diario y lecciones

- Las notas son texto y se renderizan escapadas (`TM-12`), sin HTML ni
  markdown crudo.
- El gráfico de un trade se dibuja al abrirlo, con velas de Schwab y las
  marcas de entrada y salida. No hay capturas de pantalla y nada de eso se
  guarda.
- Las lecciones son contenido estático versionado en el repo. Cada setup que
  enseñan es una etiqueta del diario, así que el portal muestra cómo le va al
  owner con cada uno. Los ejemplos usan velas de Schwab que se muestran sin
  guardarse. La infraestructura de términos se comparte con el glosario de
  `EDU-01`.

### 11. Dónde corre

- **Desarrollo.** Se desarrolla y prueba en el runtime local con la base
  local.
- **Production.** Llega cuando existan el rol de runtime y las variables. No
  espera a que el proyecto de análisis recupere su cuota el 2026-12-01: el de
  trading tiene la suya, siempre que las superficies de la cuenta no lean la
  base de análisis. El gate lo comprueba.
- **Acceso.** Desde cualquier equipo detrás de Vercel Authentication
  ([ADR 0008](0008-remote-personal-access.md)). Una sesión robada expone
  datos de la cuenta pero no puede operar (sección 2).

## Enmienda del 2026-11-13: lo que cambió al implementar `F11-03`

La conexión se implementó y se probó con la cuenta real el mismo día. Siete
puntos quedaron distintos de lo previsto:

1. **El portal de desarrolladores no se automatiza.** Sus términos («Website
   Terms of Use», actualizados el 2023-02-14) dicen: «You may not use automated
   systems (e.g., robots, spiders, etc.) to access the Site». El agente no
   maneja un navegador en developer.schwab.com, ni siquiera con la sesión del
   owner. El owner navega y modifica la app; el agente lee capturas o archivos
   que el owner guarda.
2. **Derechos `owner_accepted`, no `allowed`.** El acuerdo que rige la API
   (Developer Program Agreement) no aparece fuera del login y no se leyó. El
   owner aceptó el riesgo para un uso acotado: leer su propia cuenta, de forma
   automatizada, y guardarla normalizada. El payload crudo, la exhibición
   pública, el export y la transferencia a IA quedan `restricted`, como se
   esperaba. Se revisa al encontrar el acuerdo o antes del 2027-05-13.
3. **La app de Schwab, registrada.** Desde una captura del owner, el 2026-11-13:
   _Order Limit_ pasó de **120 a 0**. Los callbacks pasaron a ser
   `https://127.0.0.1:5000` (el del Flask), `https://127.0.0.1:3443/cuenta/schwab/callback`
   y `https://finance-portal-flame.vercel.app/cuenta/schwab/callback`; se quitó
   `schwab-portal.onrender.com`, un subdominio de Render que ya no se usa y
   que otro podría reclamar. La app siguió en «Ready For Use».
4. **Los callbacks nuevos tardan en propagarse.** Con el callback recién
   registrado, Schwab devolvía al login en un loop y nunca llamaba al portal.
   Con el del Flask la conexión funcionó a la primera. Mientras tanto, fuera de
   Vercel, `SCHWAB_CALLBACK_URL` admite la raíz de `127.0.0.1`, y la raíz del
   portal reenvía `code`, `state` y `error` al callback real
   (`schwab-callback-url`). En Vercel sólo vale `/cuenta/schwab/callback`.
5. **Dos formas de credencial en la puerta.** `env_basic` arma la
   autenticación Basic de la app desde dos variables, sólo hacia
   `schwab-oauth`. `provided_bearer` pide el access token a un proveedor
   server-only por nombre (`schwab-access-token`), recién después de autorizar
   el destino.
6. **La cuota de Schwab vive en la base de trading.** El presupuesto diario y
   el kill switch de las tres fuentes usan el mismo puerto y la misma suite de
   contrato que los de análisis, sobre tablas de la base de trading. Si la base
   de análisis no responde, la cuenta igual cuenta su cuota.
7. **La renovación se reclama sobre la fila, no con un lock.** El cliente del
   runtime tiene una sola conexión. Un lock de transacción la retendría
   mientras se llama a Schwab, y la renovación necesita la base para contar la
   cuota y registrar el evento. Quien renueva marca `refresh_claimed_until` con
   una sentencia condicionada y escribe sólo si su reclamo sigue vigente; los
   demás releen hasta 5 segundos.

El log de requests de Next imprimía la URL del callback con el código y el
`state`. Ahora esas visitas no se registran (`logging.incomingRequests`). Los
logs de la plataforma pueden conservar el query del callback. Es un riesgo
residual acotado: el código es de un solo uso, se consume en el mismo request
y no sirve sin el secret de la app.

## Enmienda del 2026-11-13: la cuenta en vivo (`F11-04`)

La cuenta se midió con la cuenta real antes de fijar los parsers, imprimiendo
sólo la estructura: claves, tipos y valores enumerados, nunca montos ni el
número de cuenta. Cinco puntos quedan decididos:

1. **La cuenta es `CASH`.** Schwab no informa poder de compra de margen. El
   overnight es `cashAvailableForTrading`, y el intradía es
   `currentIntradayBuyingPowerAmount` tal cual, con el de la apertura y el
   efectivo sin liquidar al lado. Una cuenta `MARGIN` se rechaza con nombre
   hasta medir sus saldos (decisión del owner).
2. **Posiciones y órdenes sin muestra.** La cuenta no tenía posiciones ni
   órdenes en 60 días. Sus parsers siguen el schema publicado y también son
   cerrados; el slice no se cierra hasta medir una posición y una orden reales
   (decisión del owner).
3. **Cadencia y topes** (`schwab-live-cadence-1.0.0`). Con la página visible,
   la cuenta cada 60 s y las cotizaciones cada 15 s durante la sesión regular de
   Nueva York; 5 minutos fuera de ella. Una lectura son cuatro pedidos
   (`accountNumbers`, la cuenta y dos ventanas de órdenes), y con la página
   abierta todo el día suman ~2.400 de `schwab-trader` y ~1.800 de
   `schwab-marketdata`. Los topes pasan a 3.000 y 2.000 por día (decisión del
   owner), lejos de los 120 por minuto de Schwab.
4. **Las cotizaciones se piden por un alcance firmado**
   (`schwab-quote-scope-1.0.0`). Cada lectura de la cuenta firma, con una
   tercera subclave HKDF (`quote-scope`), los símbolos de las acciones y ETFs
   abiertos, con 10 minutos de vida. La acción de cotizaciones verifica la firma
   y cotiza esos símbolos y ningún otro: el cliente no elige un ticker, y
   cotizar no vuelve a leer la cuenta.
5. **El cruce va aparte.** Valuación, sector y CEDEAR se piden en otra acción
   que sólo lee la base de análisis, con 8 s de techo y una vez por conjunto de
   símbolos. La cuenta se dibuja sin esperarla, y si la base no responde la
   tabla dice por qué. La identidad busca el ticker sólo entre listings activos
   en dólares: un CEDEAR en BYMA puede compartirlo con su subyacente.

Las órdenes abiertas se leen en dos ventanas
(`schwab-open-orders-window-1.0.0`): todas las de 7 días y las `WORKING` de 60,
que es el rango que documenta Schwab. Una GTC ingresada antes no aparece, y la
página lo dice.

## Enmienda del 2026-11-14: transacciones y diario (`F11-05`)

Antes de fijar el parser se midieron tres años de la cuenta real (195
transacciones, 115 de ellas `TRADE`), imprimiendo sólo la estructura y conteos:

1. **Rango por pedido: un año.** Con más, Schwab responde `400` («must not be
   more than a year»). La historia llega a tres años.
2. **Hora de ejecución: el `time` de la transacción.** Coincide al segundo con
   `executionLegs[].time` de su orden en 8 de 8; `tradeDate` cae a veces 10 a 12
   horas antes. Un `TRADE` no trae fecha de liquidación: queda `null`.
3. **El dinero cuadra solo.** El `netAmount` de un `TRADE` es exactamente la
   suma de los `cost` de sus ítems (instrumento y cuatro tasas), 115 de 115; en
   los movimientos de caja, la de los `amount`, 80 de 80. El parser lo verifica
   en cada fila. Precio por cantidad no siempre da el costo: el dinero sale de
   `netAmount`.
4. **Las órdenes reales traen claves que el schema publicado no tenía**
   (`uniformSymbol`, `firmActionType`): el parser de `/cuenta` las suma, y doce
   órdenes reales lo pasan.
5. **Un solo login activo.** Conectar Production invalidó el refresh token
   local (`http_400`). La conexión muestra `renewal_failed`
   (`schwab-connection-status-1.1.0`) en vez de «Conectada».

**El refresh no es un job durable.** La sección 8 pedía un job con lease y
admisión. Medido, ponerse al día es un pedido de ~0,4 s y la primera carga,
cinco. La sincronización (`schwab-transaction-sync-1.0.0`) corre en la acción
que la pide, bajo un reclamo con vencimiento sobre la fila de la cuenta —como la
renovación del token—, y cada corrida queda en un log append-only con ventana,
pedidos y conteos (`TM-11`, `TM-16`). Un reclamo vigente se ve en la base antes
de gastar un pedido. La primera carga baja ventanas de un año hacia atrás hasta
una vacía; después se compara desde lo verificado menos 7 días. Una revisión es
un hash distinto, una transacción que deja de venir queda `withdrawn`, y más de
un décimo de cambios pone la corrida en cuarentena (`mass_change_guard`).

**Trades** (`trade-round-trip-fifo-1.0.0`): un ciclo de posición de cero a cero
por cuenta e instrumento (el `instrumentId` de Schwab, que sobrevive a un cambio
de ticker), con FIFO para lo realizado de un trade abierto y prorrata al centavo
cuando una ejecución cruza de largo a corto. Una salida sin entrada a la vista
queda `opened_before_history`, nunca leída como un corto. Con los datos reales,
los 47 trades cerrados suman exactamente sus `netAmount` y el realizado total es
la suma de los 115 `netAmount` de `TRADE`.

## Enmienda del 2026-11-14: P&L del día y calendario (`F11-06`)

**Realizado por salida, no por trade.** Lo realizado de una sesión es lo que
realizaron las salidas ejecutadas en ella. Una salida parcial de un swing cuenta
el día en que se vendió, como en el reporte de ganancias de un broker. Medido
sobre los 47 trades reales, cambia un solo trade frente a fechar todo en el
cierre. Para que el calendario reconcilie con el diario,
`trade-round-trip-fifo-1.1.0` le da a cada salida lo que realizó al centavo
—su neto más el costo FIFO de lo que consumió— y la salida que cierra el ciclo
se lleva el resto. Lo realizado de un trade abierto pasa a ser la suma de sus
salidas.

**Las fórmulas de la sección 9** que entran:

- `trading-daily-pnl-1.0.0`: sesión de cada salida, semana de lunes a viernes
  entera aunque cruce de mes y mes con sus días. Una salida sin entrada en la
  historia se cuenta aparte y no suma. Un día sin salidas es `null`.
- `trade-r-multiple-1.0.0`, como lo fija la sección 9, con dos precisiones. La
  entrada y la cantidad son el promedio de entradas y todo lo que entró, porque
  el riesgo es el de la posición entera. Un stop del lado equivocado o igual a la
  entrada es `null` con motivo, no un R. El total de un período en R existe sólo
  si todas sus salidas lo tienen. El stop llega con el plan de `F11-07`; hasta
  entonces todo R es `null` con `no_planned_stop`.
- `open-day-pnl-1.0.0`: lo abierto del día es la suma de lo que Schwab publica
  por posición, sin recalcularlo con una cotización. Si a una posición le falta
  la cifra, el total es `null`.

**Lo abierto se lee al abrir el diario, sin cadencia.** Son dos `GET`
(`accountNumbers` y la cuenta con posiciones). La lectura con cadencia sigue en
`/cuenta`. Repetirla en el diario duplicaría el consumo de `schwab-trader` con
las dos páginas abiertas, y el tope diario es de 3.000.

## Enmienda del 2026-11-14: el diario por trade (`F11-07`)

**Lo que el owner decidió** antes de la migración:

- **Setups:** una base declarada en el código (`trading-setups-1.0.0`, los que
  enseñarán las lecciones de `F11-10`) más los suyos, `own-<slug>`, en la base
  de trading. El prefijo hace imposible que uno propio pise uno declarado.
- **Estado:** el emocional al operar (lista cerrada de ocho) **y** el de
  revisión (`pending`/`reviewed`).
- **Adherencia:** regla por regla —entrada, stop, target y tamaño—, cada una
  cumplida, rota o sin marcar. La marca el owner: deducirla de las ejecuciones
  confundiría un deslizamiento con una regla rota.
- **Rutina:** checklist propio y nota por sesión, liviana y opcional. El owner
  no sabe si la va a completar; va al final del slice y el slice puede cerrar
  sin ella si después de usar el diario no la quiere.

**La anotación** (`trade-annotation-1.0.0`, migración de trading `0003`) se
guarda como revisiones append-only en `trade_annotations`, como las
transacciones: corregir el stop deja visible el que se había planeado. La clave
es la del trade sin la cuenta, `schwab:<instrumentId>:<fillId>`, que dan los
IDs de Schwab y sobrevive a una sincronización; la URL es
`/diario/<instrumentId>-<fillId>`, sin la cuenta. Guardar compara la revisión
que el owner editaba: si otra pestaña guardó antes, no escribe y lo dice. Las
notas son texto plano de hasta 4.000 caracteres, en NFC, sin controles ni
marcas bidi, y se muestran escapadas (`TM-12`).

**El stop planeado le da R al diario.** `trade-r-multiple-1.0.0` no cambia:
recibe el stop de la anotación vigente, así que el calendario, la franja «Hoy»
y la tabla muestran R donde hay plan. `trade-plan-1.0.0` agrega la relación
beneficio/riesgo planeada (con la entrada planeada o, sin ella, la ejecutada, y
nombra cuál) y la distancia de cada precio a la entrada en R. Un stop o un
target del lado equivocado es `null` con motivo, nunca un número.

**Velas de Schwab, medidas antes del gráfico** (`/marketdata/v1/pricehistory`,
cuenta real, 2026-11-14):

| Frecuencia            | Llega hasta                   | Alcanza a                  |
| --------------------- | ----------------------------- | -------------------------- |
| 1 minuto              | 2026-09-28 (~47 días)         | ningún day trade del owner |
| 5, 10, 15 y 30 minuto | 2026-03-02 (~8,5 meses)       | 2 de 17 day trades         |
| diaria                | años (2024 medido sin límite) | los 47 trades              |

- Un pedido devuelve como mucho **40.000 velas** (~3,9 MB).
- Los precios llegan con hasta seis decimales: se leen del texto fuente.
- La vela diaria viene fechada a la medianoche de Chicago.
- Sin horario extendido se respeta la ventana pedida; con horario extendido, el
  `endDate` no se respetó, así que el parser recorta él mismo.
- Fuera del alcance de los minutos, el día de un day trade se dibuja con velas
  diarias y la resolución se nombra. Nunca se inventa una vela.

**El gráfico** (`trade-chart-1.0.0`, `schwab-price-history-1.0.0`) pide las
velas con `loadTradeChart` al abrir el trade, un `GET` a `schwab-marketdata`
(dos si las de minutos vienen vacías), y no las guarda. Un day trade de los
últimos 40 días va con velas de 1 minuto y uno de los últimos 240 con velas de
5, con margen sobre lo medido; el resto, y todo swing, con velas diarias desde
120 días antes de la entrada. Cada ejecución cae en la vela que contiene su hora.

**Schwab ajusta su historia hacia atrás.** Medido sobre los 47 trades reales (47
pedidos): las 115 ejecuciones encontraron su vela, pero 11 caen fuera de su
rango. Nueve son de TSLQ, a un tercio del precio de su vela, por un reverse
split posterior. Dos son de PAGS, ~5 % arriba de una vela anterior a un
dividendo. Las velas vienen ajustadas y las ejecuciones conservan lo que se
pagó. Des-ajustar exigiría los eventos, que este slice no lee, así que el
gráfico cuenta y nombra las ejecuciones fuera de su vela en vez de mover
precios.

**La rutina** (`trading-routine-1.0.0`, migración de trading `0004`) entró en el
slice a pedido del owner. Tiene dos fases, antes de la apertura y al cierre.
Cada una lleva hasta 12 ítems que escribe el owner, y por sesión guarda lo
tildado y una nota, como revisiones append-only (`session_routines`). Retirar un
ítem sólo escribe `retired_at`: las sesiones que lo tildaron lo siguen nombrando
tachado. La sesión es la fecha de Nueva York, y en un fin de semana es la del
lunes siguiente, que es la que se prepara (`routine-session-1.0.0`). Nunca se
guarda una sesión futura. La rutina es opcional: no bloquea ni avisa, y el
calendario marca los días que la tienen.

## Enmienda del 2026-11-15: estadísticas del diario (`F11-08`)

**Medido antes de fijar las reglas** sobre los 47 trades reales: todos cerrados
y largos, ninguno con stop planeado ni setup; las entradas caen entre las 9 y
las 15 de Nueva York, sin pre ni post market; 34 tickers, sólo 4 con tres
trades o más.

**`trading-stats-1.0.0`**, como lo fija la sección 9, con estas precisiones:

- **Muestra:** los trades cerrados. Un trade abierto o abierto antes de la
  historia se cuenta aparte, nunca como cero.
- **Win rate:** ganadores sobre todos los cerrados. Un trade en cero no gana y
  cuenta en el denominador.
- **Expectancy en dinero:** lo realizado sobre la cantidad de trades.
- **Expectancy en R:** el R medio de los trades que lo tienen, con su `n` y
  cuántos faltan. No sigue la regla del calendario de `F11-06` (un total en R
  sólo con todas las salidas): un total parcial engaña, una media de la parte
  con stop es una muestra. Los trades viejos nunca tendrán stop, porque el plan
  no se puede rehacer, y exigirlo en todos dejaría la cifra en `null` para
  siempre. Sin ningún trade con R es `null` con el motivo del primero.
- **Profit factor:** ganancia bruta sobre pérdida bruta, `null` con `no_losses`
  sin pérdidas y 0 sin ganancias.
- **Drawdown:** sobre la curva de lo realizado salida por salida
  (`trading-daily-pnl-1.0.0`), acumulada desde cero. La mayor caída desde un
  máximo previo en dinero, con el máximo, el piso, la salida que lo recuperó y
  dónde está hoy la curva contra su máximo. Sin capital de la cuenta no hay
  porcentaje.
- **Cortes:** setup vigente (sin setup es su grupo), hora de reloj y día de la
  semana **de la entrada** en Nueva York, ticker y day o swing. Un grupo con
  menos de 5 trades se marca como muestra chica.
- **Moneda:** una sola; trades en dos dan `currency_mismatch` y no se suma nada.

**La superficie** es `/diario/estadisticas`, hermana de `/diario` con el
selector «Trades · Estadísticas». Lee la base de trading y nada más: no pide
nada a Schwab ni a la base de análisis. Los cortes son una tabla con barras en
sus celdas, así la tabla es también el equivalente accesible.

## Enmienda del 2026-11-15: planner, riesgo abierto y reglas (`F11-09`)

**Lo que decidió el owner.** El planner del Flask no estaba en esta máquina, así
que el 2026-11-15 se le preguntó qué mide cada regla:

- **El 6 % es el riesgo abierto hoy:** `Σ (precio − stop) × cantidad` de las
  posiciones abiertas contra el valor de liquidación de Schwab. Un stop ya
  sobre la entrada sigue arriesgando lo que hay entre el precio y el stop. Ni
  el riesgo inicial ni la variante mensual de Elder.
- **El stop de una posición:** el del plan del trade abierto en el diario; sin
  plan, la orden stop viva de Schwab, mostrada al lado y marcada si difiere.
- **Las reglas se editan en el portal**, con valores por defecto que el agente
  propone midiendo.
- **El planner vive en `/cuenta` y no cotiza:** el owner escribe entrada, stop y
  target. El cliente sigue sin nombrar un ticker ante Schwab.

**Valores por defecto, medidos** sobre los 47 trades reales y la práctica
publicada (2 % y 6 % de Elder, límites diarios del 2 al 5 % del capital, la
regla de los tres strikes):

| Regla             | Defecto | Por qué                                                                      |
| ----------------- | ------- | ---------------------------------------------------------------------------- |
| Riesgo por trade  | 2 %     | el planner del Flask                                                         |
| Riesgo abierto    | 6 %     | el planner del Flask                                                         |
| Pérdida diaria    | 4 %     | dos stops completos; el peor día medido (−1.319, dos swings) queda debajo    |
| Trades por sesión | 3       | 38 de 39 sesiones con entradas tuvieron una o dos; el máximo fue tres        |
| Pérdidas seguidas | 3       | sólo una sesión lo pasó: seis pérdidas chicas seguidas en TSLA el 2024-06-06 |

**`position-size-risk-1.0.0`.** El precio de una posición es su cotización o,
sin ella, market value sobre cantidad. Varias órdenes stop dan el precio más
bajo y cubren la posición sólo si suman toda la cantidad
(`stop_order_partial` si no). Un precio en o bajo el stop es
`price_through_stop`, nunca riesgo cero. Sin stop es `no_stop`, y el total del
6 % es `null` con los símbolos que faltan: un parcial mostraría menos riesgo del
que hay. Como la cuenta es `CASH`, sólo se miden largos de acciones y ETFs; el
resto se nombra. El planner da acciones enteras hacia abajo con el mínimo entre
el 2 %, el buying power overnight y lo que le queda al 6 %, y nombra el tope que
decidió. Sin riesgo abierto conocido, el tope del 6 % no se calcula.

**`trading-rules-1.0.0`.** Tres estados y dos más: `stop` (no abrir otro trade),
`warning` (un paso más llega a `stop`: otro stop completo al riesgo por trade
ya no entra, o falta un trade o una pérdida), `ok`, `off` (regla apagada) y
`unknown` con motivo, nunca `ok` por falta de dato. La pérdida del día es lo
realizado en la sesión de Nueva York más el P&L abierto del día de Schwab
(`open-day-pnl-1.0.0`), contra el valor de liquidación al abrir. Un trade cuenta
en la racha al cerrar; uno en cero la corta. Las reglas se guardan como
revisiones append-only (migración de trading `0005`, `trading_risk_settings`),
con una sola vigente y `for update`, como la rutina.

**Lo que lee la página.** Los planes, las reglas y la actividad del día salen de
la base de trading en `readAccountRisk`, al abrir y cada vez que cambian las
posiciones o los round trips de la cuenta. Antes sincroniza las transacciones si
pasó la cadencia o, con ese cambio, siempre. El cálculo corre en el cliente con
la lectura vigente. No hay pedidos nuevos a Schwab fuera de esa sincronización.

## Enmienda del 2026-11-15: las lecciones (`F11-10`)

**Lo que decidió el owner** antes de escribir código:

- **La infraestructura de términos se hace ahora** y la comparten las lecciones
  y `EDU-01`: un glosario versionado con definición, fórmula, por qué importa y
  fuente (`glossary-1.0.0`), cargado sólo con términos de trading
  (`trading-glossary-1.0.0`, 33 términos y 11 fuentes). `EDU-01` suma después
  los de valuación sobre la misma estructura.
- **Una lección es visual:** un gráfico anotado, de tres a seis reglas de una
  línea, los errores comunes plegados y, en un setup, el historial propio del
  diario. Nada de prosa de curso.
- **Los ejemplos son un esquema más los trades propios.** El patrón se dibuja
  con velas declaradas en el repo, que no caducan ni gastan cuota; los ejemplos
  con velas de Schwab son los trades del owner etiquetados con el setup, que se
  abren en `/diario/<trade>` con el gráfico de `F11-07`. Se descartó un ejemplo
  fijo por ticker y fecha: Schwab sirve velas de 1 minuto de unos 47 días y de
  5 minutos de unos 8 meses, así que un ejemplo intradía dejaría de dibujarse.
  También un ticker elegido en la lección: el cliente nombraría un ticker ante
  Schwab, lo que `F11-04` evitó a propósito.

**`technical-lessons-1.0.0`.** Siete conceptos (velas, tendencia, soportes y
resistencias, volumen y VWAP, medias, RSI y MACD, gestión de riesgo) y una
lección por cada código de `trading-setups-1.0.0`; un setup declarado sin
lección, o con dos, rompe el test. Las reglas numeran las marcas del gráfico y,
al elegirlas, llevan el cursor a su vela. Las velas son
`schematic-candles-1.0.0`: tramos con un cierre exacto al final, zigzag con
semilla, techo y piso opcionales y velas declaradas enteras donde la forma
enseña. **El test comprueba que el dibujo muestra lo que dice el texto:** que el
martillo tiene la mecha de 2× el cuerpo, que la ruptura cierra fuera con 2× el
volumen, que la divergencia del RSI existe, que el cruce del MACD es el primero
después del máximo, y en cada setup que la entrada cae en su vela, que
reward/risk es al menos 1,5 y que el stop no se toca antes del target. La
lección de riesgo calcula su ejemplo con el planner de `F11-09` (cuenta 10.000,
2 %, entrada 50, stop 48: 100 acciones).

**`technical-indicators-1.0.0`.** SMA, EMA sembrada con la SMA, VWAP anclado
por sesión sobre el precio típico, RSI con el suavizado de Wilder y MACD
(12, 26, 9), en `number`: son ayudas de dibujo, no dinero. Sin historia
suficiente es `null`; un precio no positivo o no finito rechaza la serie con
motivo; un RSI sin subas ni bajas es `null`, no 50. Los valores se verificaron
contra fracciones exactas calculadas aparte, incluida la planilla de Wilder.

**El historial** (`readSetupHistory`, `readSetupSummaries`) lee los trades
etiquetados de la base de trading con `trading-stats-1.0.0`, igual que
`/diario/estadisticas`. El contenido de las lecciones se sirve en cualquier
modo, porque es código del repo; el historial sólo en el runtime personal con
la base de trading, y si la base no responde lo dice con una referencia. Las
estadísticas y la página de un trade enlazan el setup con su lección.

## Enmienda del 2026-11-16: el screener de Finviz (`F11-13`)

**Lo que decidió el owner:** el armador tiene que ser lo más útil posible, el
JSON del Flask es viejo y no es la referencia, y lo que Finviz marca Elite no
aparece como opción. El screener amplio sigue siendo Finviz (ADR 0016): el
portal arma un link y el navegador del owner lo abre.

**Medido.** Finviz no publica términos encontrables; su `robots.txt` cierra
`/screener?*`, `/chart` e `/image` a robots. El portal no baja nada de Finviz y
no embebe sus gráficos ni imágenes: sólo enlaza. El catálogo sale de una página
que el owner guardó con su navegador, cuyo JSON embebido trae cada filtro con
sus opciones, sus grupos y la marca `isEliteOnly`, y un `screenerFiltersVersion`
que cambia cuando Finviz cambia filtros. El link de prueba volvió reescrito de
`ind_` a `industry_`: el prefijo de un filtro es su clave más `_`.

**`finviz-screener-page-1.0.0`** es un parser cerrado de esa página; una clave
desconocida la rechaza por nombre, porque puede ser una marca de Elite.
`pnpm finviz:catalog` regenera el JSON del catálogo y
**`finviz-screener-catalog-1.0.0`** fija por test el `filtersVersion` que nombra:
78 variables, 2.317 opciones; vistas y señales declaradas en el código con su
evidencia.

**`finviz-screener-url-1.0.0`** arma `screener/stocks?v=&f=&s=` en el orden del
catálogo, un valor por variable, y lee un link pegado nombrando lo que no
reconoce. **`finviz-screener-strategy-1.0.0`** guarda la consulta con nombre como
revisiones en la base de trading (migración `0007`), sin la cuenta Schwab, y la
vuelve a validar al leerla. Las acciones reciben la selección, nunca una URL.

## Enmienda del 2026-11-25: day y swing en bolsillos separados (`F11-18`)

**Lo que preguntó el owner.** `/cuenta` decía «3 trades» y no se sabía si eso
contaba lo operado en el día. Contaba todo: las cuatro reglas de
`trading-rules-1.0.0` mezclaban day y swing, y el gap de un swing consumía la
pérdida del día. El owner quiere usar su cash en algunos swings y operar en el
día con el resto.

**Medido antes, sobre los 62 trades reales** (32 day, 30 swing): en noviembre
de 2026 el límite de 3 se pasó con day trades solos (7 el 19/11, 4 el 25/11),
de USD 3–5,5k cada uno; las compras brutas del día llegaron a USD 34,6k el
19/11. Los swings, de USD 1–3k y hasta unos cinco a la vez, hicieron casi
todo el resultado y todas las pérdidas grandes, ninguno con stop. La cuenta es
`CASH`: el PDT no rige, pero lo vendido se liquida en T+1, así que recomprar
con eso y vender en el día es una good faith violation.

**Lo que decidió el owner** (2026-11-25):

| Decisión                      | Valor                                                       |
| ----------------------------- | ----------------------------------------------------------- |
| Reparto                       | 70 % del valor de liquidación para swing; el resto para day |
| Tipo de un trade              | automático: day si vive dentro de una sesión de Nueva York  |
| Pérdida diaria, trades, racha | sólo day trades                                             |
| Riesgo por trade              | day 0,5 %, swing 2 %, los dos sobre la cartera entera       |
| Riesgo abierto                | 6 % de la cartera, medido en las posiciones swing           |

**`trading-book-1.0.0`.** Un trade es day si cerró en la sesión en que abrió
o, abierto, abrió en la de hoy; lo que pasa la noche es swing, también un
trade anterior a la historia. Una posición sin trade en el diario usa la
cantidad que Schwab publica al cierre de la sesión anterior y, sin ella, es
day. Una compra pensada como swing usa el capital day el día que entra: es la
consecuencia buscada de no declarar el tipo.

**`trading-rules-2.0.0`.** Seis reglas en dos filas. Day: **capital** (lo
comprado hoy en day trades, con comisiones, contra el 30 % del valor de
liquidación al abrir; lo comprado y no lo neto, por la liquidación en T+1),
pérdida diaria (realizado por day trades más el P&L del día de Schwab de las
posiciones day), trades por sesión y racha. Swing: **exposición** (valor de
mercado de las swing contra el 70 % del valor de liquidación) y riesgo abierto.
Los topes de capital no tienen `warning`: ningún monto es «un trade más». La
pérdida diaria por defecto pasa de 4 % a **1,5 %**, tres stops day completos, el
máximo de trades por sesión; el resto de los defectos de `1.0.0` sigue. Una
revisión guardada con `1.0.0` se lee con sus valores y los defectos para el
reparto y el riesgo day, y guardar sobre ella escribe una completa (migración
de trading `0008`, dos columnas nulas en las revisiones viejas y un check que
exige las dos o ninguna).

**`position-size-risk-2.0.0` y `position-size-amount-1.1.0`.** El planner
elige day o swing: el riesgo por trade del tipo, el buying power, lo que le
queda a su capital y, en swing, al 6 %. Por monto marca pasarse del capital del
tipo, sin recortar.

**`pre-market-plan-1.1.0`.** Cada idea de `/plan` dice day o swing; el stop
automático y el tamaño usan los del tipo. Una revisión anterior se lee swing:
usaba el riesgo por trade de entonces. `accountRisk` es el cálculo que leen
`/cuenta` y `/plan`, así que las dos superficies dicen lo mismo.

## Controles del threat model

| Control | Cómo se cierra en la Fase 11                                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TM-01` | Superficies sólo en `personal`, con el modo resuelto en el request; `locked` no abre bases ni Schwab.                                                                             |
| `TM-02` | Claves en variables server-only, tokens cifrados y centinelas del build sobre las variables nuevas.                                                                               |
| `TM-03` | Callback y actions con modo verificado, schema cerrado, `state` de un solo uso y errores con `request_id`.                                                                        |
| `TM-04` | Nada de la cuenta se cachea; las rutas son dinámicas.                                                                                                                             |
| `TM-05` | Parsers cerrados por endpoint, con cuarentena y revisiones.                                                                                                                       |
| `TM-08` | Tres fuentes con host, paths y método exactos; ninguna admite escritura sobre `/trader/v1/`.                                                                                      |
| `TM-10` | Topes diarios, kill switch y polling acotado a la página visible y a las posiciones abiertas.                                                                                     |
| `TM-11` | Refresh de transacciones como job durable con lease y admisión.                                                                                                                   |
| `TM-12` | Notas escapadas; el gráfico del trade se dibuja con datos, no con HTML externo.                                                                                                   |
| `TM-14` | Variables de Schwab y de la base de trading sólo en local y en Production.                                                                                                        |
| `TM-15` | Sin payload crudo, export ni transferencia a IA de la cuenta hasta su propia ADR.                                                                                                 |
| `TM-16` | Corridas de ingesta append-only y log de conexión, renovación y vencimiento, sin tokens.                                                                                          |
| `TM-17` | Nuevo: una credencial del broker filtrada lee la cuenta u opera. Lo cierran las secciones 2 y 5: no hay escritura alcanzable, _Order Limit_ 0 y tokens cifrados con vida acotada. |

## Consecuencias

- **Un solo portal.** La cuenta, el diario y el riesgo conviven con la
  valuación, los sectores y el acceso CEDEAR de cada posición.
- **Un diario verificable.** El P&L de cada round trip reconcilia al centavo
  con lo que Schwab cobró y pagó.
- **Una segunda base.** Suma una cadena de migraciones, un snapshot, un rol y
  un runbook más. Es el precio de aislar cuota, credenciales y recuperación.
- **Login semanal inevitable.** Si el owner no reconecta, la cuenta muestra
  datos viejos marcados como tales; nunca datos inventados.
- **Ejecución afuera.** Las órdenes siguen en thinkorswim. Si algún día entran
  al portal, hará falta otra ADR: una confirmación por orden que es
  autenticación de aplicación, y pruebas con dinero real porque no hay paper
  trading.
- **Riesgos abiertos.** Los términos de Schwab todavía no se leyeron. La API
  puede cambiar sin aviso. El proyecto nuevo también es Free.

## Alternativas descartadas

- **La misma base, en un schema aparte.** Comparte la cuota y las
  credenciales, justo lo que falló en noviembre.
- **Otra cuenta de Neon.** No hace falta y arriesga un bloqueo.
- **Un servicio Python aparte (FastAPI y Schwabdev).** Son dos stacks, dos
  deploys y autenticación entre ellos. Las librerías Python quedan como
  referencia de formatos.
- **Mantener el Flask.** Arreglar sus fallas de seguridad cuesta más que
  portar sus fórmulas.
- **Un ticket de órdenes en el portal.** El owner decidió operar a mano, y
  sin paper trading cada bug se paga con dinero.
- **Streaming de cotizaciones.** Competiría con thinkorswim por la única
  conexión, y las Functions no mantienen sockets abiertos.

## Fuentes

Consultadas el 2026-11-13:

- [schwab-py: autenticación y vida de los tokens](https://schwab-py.readthedocs.io/en/latest/auth.html)
- [schwab-py: plantillas de órdenes](https://schwab-py.readthedocs.io/en/latest/order-templates.html)
- [Schwabdev](https://github.com/tylerebowers/Schwabdev)
- [Edge Trader for Schwab: configuración de la app y _Order Limit_](https://github.com/simonro/edge-trader-for-schwab#your-schwab-app)
- [WilmerHale: aprobación de la reforma de la FINRA Rule 4210](https://www.wilmerhale.com/en/insights/client-alerts/20260423-sec-approves-amendments-to-finra-rule-4210-replacing-day-trading-margin-requirements-with-a-modernized-intraday-margin-standard)
- [Neon: planes y precios](https://neon.com/pricing)
- [Neon: política de uso aceptable](https://neon.com/docs/security/acceptable-use-policy)
