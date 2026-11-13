# ADR 0076: cuenta Schwab de solo lectura y diario de trading

- Estado: propuesta; espera la aceptación del owner.
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
  Eso pide una ADR propia.

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
