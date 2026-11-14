# Conexión con Schwab

- Estado: procedimiento de `F11-03` a `F11-05`
- Decisión: [ADR 0076](../architecture/adr/0076-schwab-read-only-account-trading-journal.md),
  secciones 2, 5, 6 y 7 y su enmienda del 2026-11-13
- Relacionados: [base de trading](trading-database.md) y
  [presupuesto por fuente](source-budgets.md)

`/cuenta` conecta la cuenta Schwab del owner **en modo lectura**. El portal
nunca envía, reemplaza ni cancela órdenes. Hay tres controles independientes:

- la puerta sólo admite `GET` hacia `/trader/v1/` y `/marketdata/v1/`, y un
  test de la allowlist lo fija;
- el código no tiene operaciones de órdenes;
- la app de Schwab tiene _Order Limit_ 0.

## Variables

| Variable              | Para qué                                                                              | Dónde                         |
| --------------------- | ------------------------------------------------------------------------------------- | ----------------------------- |
| `SCHWAB_APP_KEY`      | `client_id` de la app; la puerta la manda en Basic al endpoint de token               | local y Production            |
| `SCHWAB_APP_SECRET`   | secret de la app; sólo viaja en Basic hacia `/v1/oauth/token`                         | local y Production            |
| `SCHWAB_CALLBACK_URL` | `redirect_uri`, idéntico a un callback registrado en la app                           | local y Production, distintos |
| `TRADING_SECRET_KEY`  | 32 bytes en base64 (`openssl rand -base64 32`); de ella se derivan subclaves por HKDF | local y Production, distintas |

- **Preview** no recibe ninguna de estas variables (`TM-14`). Si aparecen, el
  health las marca `degraded` y se ignoran.
- **Perder la clave** sólo obliga a reconectar: los tokens viejos dejan de
  abrir y la conexión se rehace con un login.
- **`SCHWAB_CALLBACK_URL` acepta dos formas:**
  - `https://<host>/cuenta/schwab/callback`, el callback del portal;
  - `https://127.0.0.1:<puerto>` en la raíz, sólo fuera de Vercel. Es el
    callback que la app ya tenía registrado para el Flask: la raíz reenvía
    `code`, `state` y `error` al callback real.

## La app en el portal de Schwab

Sus términos prohíben acceder a developer.schwab.com con herramientas
automatizadas. El owner navega y el agente lee capturas.

Estado registrado el 2026-11-13, en «App Details»:

- **Status:** «Ready For Use».
- **Order Limit:** 0, antes 120.
- **Callback URL:**
  - `https://127.0.0.1:5000`
  - `https://finance-portal-flame.vercel.app/cuenta/schwab/callback`
  - `https://127.0.0.1:3443/cuenta/schwab/callback`

Para cambiarla:

1. **Dashboard → Apps → View Details → Modify App.**
2. Los callbacks van separados por coma. «Enter App Name.» en rojo con el
   nombre cargado se resuelve reescribiendo una letra del nombre.
3. Un callback recién registrado puede tardar en propagarse aunque la app
   siga en «Ready For Use». El síntoma es un loop en el login de Schwab que
   nunca vuelve al portal; el log del servidor no muestra ningún
   `GET /cuenta/schwab/callback`.

## Un solo login activo

Schwab mantiene **un** refresh token vigente por app y usuario. Conectar en un
entorno invalida el del otro: el 2026-11-14, el login de Production hizo que la
renovación local fallara diez minutos después (`refresh_failed`, `http_400`).
Local y Production no pueden estar conectados a la vez; para medir en local hay
que conectar en local y después reconectar Production.

## Conectar en local

```bash
pnpm certs:local        # certificado autofirmado en .certs/, 30 días
pnpm dev:https          # https://127.0.0.1:3443, callback del portal
pnpm dev:https:5000     # https://127.0.0.1:5000, callback del Flask en la raíz
```

1. Abrir `/cuenta` en ese origen y aceptar una vez la advertencia del
   certificado.
2. «Conectar con Schwab» → login → elegir la cuenta → volver a `/cuenta`.
3. La página muestra el último login, el vencimiento a 7 días, el aviso desde
   24 horas antes y el registro de eventos.

`next dev --experimental-https` sin certificado propio descarga mkcert e
instala una autoridad de certificación en el sistema. Por eso el script lo
genera con `openssl`.

## Qué pasa en cada pedido

- **`connectSchwab`** no recibe input. Emite un `state` de 32 bytes con 10
  minutos de vida y guarda sólo su SHA-256. Lo deja en la cookie
  `__Secure-schwab-oauth-state`, acotada al path del callback, y redirige a
  Schwab.
- **`GET /cuenta/schwab/callback`:**
  - borra la cookie;
  - consume el `state` en una sola sentencia;
  - canjea el código por la puerta;
  - sella los dos tokens con AES-256-GCM, con un AAD por tipo;
  - redirige con un código cerrado.

  Ante un error, la redirección lleva una referencia y no expone detalles.

- **El access token** dura 30 minutos. El proveedor de la puerta lo renueva
  cuando le queda menos de un minuto, reclamando la fila: un solo pedido
  renueva y los demás esperan hasta 5 segundos. El login vence a los 7 días
  de autorizar, y renovar no lo corre.
- **La cuota** de las tres fuentes —100, 1.000 y 1.000 pedidos por día— se
  cuenta en la base de trading. El kill switch también vive ahí.
- **El registro** (`schwab_connection_events`) guarda un código cerrado y el
  `request_id`. Nunca guarda un token, un código de autorización ni un `state`.
- **El log de requests** de Next no registra visitas con `code`, `state` o
  `session` en el query.

## Verificación del 2026-11-13

La primera prueba se hizo con la cuenta real del owner, en local, por el
callback del Flask:

- **Conexión:** el evento `connected` quedó registrado y el `state` se consumió
  una vez.
- **Tokens:** sobres de formato 1 (`schwab-token-envelope-1.0.0`), con access
  de 30 minutos y login de 7 días.
- **Renovación forzada:** se marcó el access como vencido, se renovó y el
  vencimiento del login no se movió.
- **Lectura por la puerta:** `GET /trader/v1/accounts/accountNumbers` respondió
  200 con una cuenta, usando el bearer provisto.
- **Cuota:** 2 pedidos a `schwab-oauth` y 1 a `schwab-trader`, en la base de
  trading.

## Fallas y qué hacer

| Lo que muestra `/cuenta`        | Causa y salida                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| «El pedido de conexión no vale» | El `state` venció, ya se usó o la cookie no llegó (otro navegador, otro puerto). Conectar de nuevo.                                                            |
| «Autorización cancelada»        | Se canceló en Schwab. Conectar de nuevo.                                                                                                                       |
| «Schwab no entregó los tokens»  | El canje falló; el registro guarda `http_<status>` o `token_unexpected_shape`. Si es esto último, Schwab cambió la respuesta y el parser la rechazó (`TM-05`). |
| «Base de trading no disponible» | La base de trading no respondió; la de análisis no interviene. Ver [base de trading](trading-database.md).                                                     |
| «Login vencido»                 | Pasaron 7 días. Reconectar; no hay forma automática.                                                                                                           |
| `refresh_failed` en el registro | Schwab rechazó la renovación, la puerta no tenía cuota o el sobre no abre (otra `TRADING_SECRET_KEY`). Reconectar.                                             |

## Cuenta en vivo

Con la conexión vigente, `/cuenta` lee la cuenta en el request y después la
relee desde el navegador, sólo con la página visible:

| Qué                         | En sesión de Nueva York | Fuera de sesión | Pedidos                  |
| --------------------------- | ----------------------- | --------------- | ------------------------ |
| Cuenta (saldos, posiciones) | cada 60 s               | cada 5 min      | 4 de `schwab-trader`     |
| Cotizaciones                | cada 15 s               | cada 5 min      | 1 de `schwab-marketdata` |

- **Qué se lee.** Saldos, poder de compra overnight (disponible para operar)
  e intradía (tal cual lo informa Schwab), posiciones y órdenes abiertas. Nada
  de eso se guarda.
- **Cotizaciones.** Sólo de acciones y ETFs abiertos, por un alcance que firma
  el servidor. Sin posiciones no se pide ninguna.
- **LIVE/STALE.** LIVE hasta dos períodos de la cadencia. Si una lectura
  falla, queda en pantalla la anterior con su hora, marcada STALE, y el motivo.
- **Cruce.** Valuación, sector y CEDEAR salen de la base de análisis. Si no
  responde, la cuenta se ve igual y la tabla lo dice.
- **Órdenes.** Todas las de 7 días y las activas de hasta 60. Una GTC más
  vieja no aparece.

Lo que puede mostrar en lugar de la cuenta:

| Mensaje                      | Causa y salida                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| «Sin acceso a la cuenta»     | No hay token: sin conectar, login vencido o renovación fallida. Reconectar.                         |
| «Schwab rechazó el token»    | `http_401`. Reconectar.                                                                             |
| «Se agotó la cuota del día»  | Tope de 3.000 o 2.000 cumplido. Se repone a las 0 h UTC; ver el consumo con `pnpm trading:sources`. |
| «Cuenta de margen sin medir» | Schwab informa `MARGIN`. Medir sus saldos y declarar el parser antes de mostrarla.                  |
| «Schwab cambió el formato»   | Un parser cerrado rechazó la respuesta. El log tiene el código; medir la forma nueva.               |
| «Schwab no respondió»        | La puerta cortó (`egress_*`). La página reintenta en la próxima lectura.                            |

## Transacciones y diario

`/diario` lee las transacciones guardadas en la base de trading y arma los
trades; al abrirse pide a Schwab sólo si pasó la cadencia de la cuenta (un
minuto en sesión, cinco fuera):

| Caso                 | Pedidos a `schwab-trader`                     |
| -------------------- | --------------------------------------------- |
| Primera carga        | 1 de `accountNumbers` y 1 por año hacia atrás |
| Ponerse al día       | 2: `accountNumbers` y una ventana             |
| Otro pedido en curso | ninguno: el reclamo se ve en la base          |

- **Medido el 2026-11-14:** tres años, 195 transacciones, 5 pedidos en la
  primera carga, 47 trades.
- **«Sin actualizar» en el diario:** el ⓘ dice el código. `mass_change_guard`
  significa que Schwab cambió o retiró más de un décimo de lo comparado y nada
  se escribió; mirar `schwab_transaction_runs` antes de aceptarlo.
- **Nada del payload** se guarda: sólo la transacción normalizada, con la cuenta
  como HMAC (`schwab-account-key-1.0.0`). Otra `TRADING_SECRET_KEY` deja las
  transacciones guardadas bajo una cuenta que ya no se reconoce.

## Cuota y kill switch

La cuota y el kill switch de las fuentes de Schwab viven en la base de
trading:

```bash
pnpm trading:sources                                                  # consumo y controles
pnpm trading:sources --source schwab-trader --disable --reason "…" --apply
pnpm trading:sources --source schwab-trader --enable --reason "…" --apply
```

`pnpm ingestion:sources` escribe en la base de análisis y se niega con una
fuente `schwab-*`; `trading:sources` se niega con cualquier otra. Quitar
`SCHWAB_APP_SECRET` del entorno sigue frenando la renovación del token.
