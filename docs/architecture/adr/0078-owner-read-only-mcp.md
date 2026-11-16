# ADR 0078: MCP de solo lectura para la IA del owner

- Estado: aceptada por el owner el 2026-11-16.
- Fecha: 2026-11-16.
- Alcance: enmienda la sección 1 de la
  [ADR 0076](0076-schwab-read-only-account-trading-journal.md), que dejaba
  afuera «transferir datos de la cuenta a una IA, incluido un MCP de solo
  lectura» hasta esta ADR. Acota el guardrail «sin autenticación de
  aplicación» de la [ADR 0004](0004-personal-first-runtime.md) y la
  [ADR 0008](0008-remote-personal-access.md) para una sola ruta.
- Relacionadas: [ADR 0005](0005-request-time-runtime-boundary.md),
  [ADR 0009](0009-egress-boundary.md),
  [ADR 0020](0020-source-daily-budget-kill-switch.md),
  [ADR 0033](0033-ai-layer-industry-resolution.md) y
  [ADR 0073](0073-neon-free-network-transfer-recovery.md).

## Contexto

El owner quiere que su asistente de IA vea lo que hace y tiene en el portal:
las valuaciones, las matrices, Argentina, el diario, las estadísticas y el
plan. Hoy la única forma es copiar y pegar desde las páginas.

Un MCP (_Model Context Protocol_) es la interfaz estándar para eso: el
asistente descubre herramientas y las llama. El owner decidió el 2026-11-16:

- **Qué lee:** análisis (valuaciones, matrices, Argentina), diario y
  estadísticas, y plan con su watchlist. La cuenta en vivo (posiciones,
  saldos y órdenes) queda afuera.
- **Qué no lee:** sólo lo sensible. Los trades, las notas y los planes no lo
  son para él.
- **Derechos:** que su asistente lea datos de Yahoo, Damodaran y el resto es
  uso personal, y lo acepta.
- **Dónde:** sólo remoto, desde Production en Vercel, para usarlo él solo.
  Primero desde su computadora.
- **Autenticación:** un token, sin OAuth, que le parece demasiado para un uso
  personal.

Se midió antes de decidir (2026-11-16):

- **El protocolo.** La especificación vigente es la del 2026-07-28. El
  transporte remoto es _Streamable HTTP_: `POST` de JSON-RPC a una ruta. La
  autorización es opcional; si se implementa, la especificación pide OAuth.
  Un token fijo en un header queda fuera de ese flujo, pero el cliente que el
  owner va a usar lo admite.
- **El cliente.** Claude Code agrega un servidor remoto con
  `claude mcp add --transport http <nombre> <url> --header "…"`; que acepte
  dos `--header` a la vez se comprueba en el slice. No se midió si los
  conectores de claude.ai admiten un header propio: quedan para otra ADR.
- **Vercel.** Production tiene Deployment Protection, que corta todo pedido
  sin login de Vercel: un `401` o la página de login. _Protection Bypass for
  Automation_ existe en todos los planes. Es un secreto por proyecto que viaja
  en el header `x-vercel-protection-bypass` y saltea la protección de
  **todos** los deployments del proyecto, no de una ruta. Se pueden crear
  varios secretos y revocarlos por separado.
- **El SDK.** `@modelcontextprotocol/server` 2.4.0 (Apache-2.0, de
  Anthropic) es la línea estable v2 y reemplaza a `@modelcontextprotocol/sdk`
  v1. Depende sólo de `zod` y de su `core`. `createMcpHandler(factory)`
  devuelve un `fetch(Request) → Response` sin estado: crea un servidor por
  pedido y no guarda nada entre pedidos. **No verifica tokens, `Host` ni
  `Origin`:** eso queda del lado de quien lo monta.

## Decisión

### 1. Alcance: lo guardado, nunca la red

El MCP es una ruta del portal que lee lo que ya está en las bases y nada
más:

- **Lee:** las valuaciones registradas con su procedencia, las matrices de
  riesgo y de divergencias de un sector, el tablero de Argentina, los trades
  del diario con sus anotaciones y R, las estadísticas y las ideas del plan.
- **No abre la red:** ninguna herramienta llama a Schwab, la SEC, Yahoo ni a
  un modelo, ni gasta cuota. Tampoco encola jobs ni dispara las Server
  Actions que descargan. Si un dato falta, la herramienta lo dice con el
  mismo motivo que la página.
- **No escribe:** no hay herramienta que guarde, anote, archive ni borre.
- **No lee la cuenta en vivo:** ni posiciones ni saldos ni órdenes. Sin una
  llamada a Schwab no hay forma de leerlas, y el owner no las pidió.

### 2. Lo sensible nunca sale

Ninguna herramienta devuelve, y un test lo verifica sobre la salida de cada
una:

- tokens de Schwab, `SCHWAB_APP_KEY`, `SCHWAB_APP_SECRET`,
  `TRADING_SECRET_KEY`, el token del MCP, el secreto de bypass, ninguna URL
  de base ni variable de entorno;
- el número de cuenta y su HMAC (`accountKey`); se muestran los últimos
  cuatro dígitos, como en las páginas;
- el `state` de OAuth, el log de conexión con Schwab y los payloads crudos.

### 3. Herramientas: las lecturas de las páginas, con schema cerrado

- **Una herramienta por lectura existente.** Cada herramienta envuelve el
  mismo loader que su página (`loadSectorRiskMatrix`, `readJournal`,
  `readTradingStats`, la lectura de la valuación…). Nunca hay una segunda
  copia de la lógica que pueda divergir.
- **Entradas cerradas.** Un ticker con la regex del portal, un código de
  sector de la taxonomía declarada, una referencia de trade con su schema.
  Nunca SQL, URL, ruta de archivo ni texto libre que llegue a una consulta
  (`TM-07`).
- **Salidas declaradas.** Zod las valida y llevan su procedencia: fecha
  efectiva, corte de conocimiento, versiones de fórmula y fuentes, como en
  la página. Los montos van como texto decimal, nunca como `number`.
- **Catálogo versionado** (`portal-mcp-tools-1.0.0`). El primer slice
  implementa valuaciones y diario; las demás entran de a una, cada una con
  su test.
- **Tamaño acotado.** Cada respuesta tiene un tope (256 KB). Una lectura más
  grande, como una serie larga de Argentina, se pide por rango y nunca se
  trunca en silencio. La cuota de transferencia de Neon
  ([ADR 0073](0073-neon-free-network-transfer-recovery.md)) se mide en el
  slice.

### 4. Transporte: una ruta sin estado en Production

- **Ruta.** `src/app/mcp/route.ts` es un Route Handler que acepta `POST` y
  responde `405` a lo demás. Monta `createMcpHandler` de
  `@modelcontextprotocol/server`, que es la dependencia nueva que decide esta
  ADR, con versión exacta en el lockfile (`TM-13`).
- **Sin estado.** No hay sesiones, ni reanudación, ni notificaciones del
  servidor. Cada pedido crea su servidor y lo descarta.
- **Dinámica.** La ruta resuelve el modo en el request
  ([ADR 0005](0005-request-time-runtime-boundary.md)) y no se cachea
  (`TM-04`).
- **Dónde existe.** En Production. En local, para desarrollar contra la base
  local. Nunca en Preview: su variable no se carga ahí (`TM-14`).

### 5. Autenticación: dos secretos, cada uno con su tarea

Un pedido pasa por dos puertas independientes:

1. **Vercel deja entrar.** Header `x-vercel-protection-bypass` con un secreto
   de _Protection Bypass for Automation_ creado sólo para el MCP, con el
   rótulo «MCP del owner».
2. **El portal deja leer.** Header `Authorization: Bearer <token>`, con
   `MCP_ACCESS_TOKEN`: 32 bytes aleatorios en base64url, sólo en local y en
   Production.

Los dos secretos se separan porque guardan cosas distintas:

- **El de bypass abre todo el proyecto**, no sólo `/mcp`: con él, cualquier
  página se lee sin login de Vercel. Equivale a una sesión robada, que la
  [ADR 0076](0076-schwab-read-only-account-trading-journal.md) ya acepta
  porque no puede operar. Se revoca desde Vercel sin tocar el portal.
- **El token es el permiso de la ruta.** Si se filtra sin el de bypass, no
  pasa la protección. Si se filtra el de bypass sin el token, se leen las
  páginas pero el MCP responde `401`. Se rota cambiando la variable y
  redeployando.

La verificación del token:

- compara el SHA-256 del header con el del token con `timingSafeEqual`, para
  no filtrar el valor por tiempo;
- sin `MCP_ACCESS_TOKEN`, o con uno de menos de 32 bytes, la ruta responde
  `404` y el health dice «MCP: deshabilitado» nombrando la variable, nunca
  `degraded` (como la base de trading);
- antes del token exige `servesRealData(health)`: un runtime `locked`
  responde `404` sin abrir una base (`TM-01`);
- rechaza un pedido con header `Origin`, porque un navegador nunca es un
  cliente legítimo de esta ruta y así se corta un CSRF o un DNS rebinding
  (`TM-12`); además valida `Host` con `hostHeaderValidationResponse` del SDK.

Esto **no** es autenticación de aplicación en el sentido de las ADR 0004 y
0008: no hay usuarios, sesiones, roles ni login. Es una credencial de máquina
para una sola ruta, y el resto del portal sigue protegido sólo por la
plataforma. El guardrail sigue en pie para todo lo demás.

El owner configura el cliente así, con los dos valores en su llavero y nunca
en un archivo del repo:

```bash
claude mcp add --scope user --transport http portal https://<dominio>/mcp \
  --header "Authorization: Bearer $MCP_ACCESS_TOKEN" \
  --header "x-vercel-protection-bypass: $MCP_VERCEL_BYPASS"
```

### 6. Derechos: el asistente del owner es uso personal

- **Una dimensión nueva en el registro de fuentes:** `ownerAssistant`. Dice
  si los datos de la fuente pueden llegar al asistente de IA que el owner usa
  por el MCP.
- **Por qué no `aiTransfer`.** Esa dimensión gobierna que el portal mande
  evidencia a un modelo en tareas propias, con ZDR y una policy
  ([ADR 0033](0033-ai-layer-industry-resolution.md)). Por ejemplo, F6-11 le
  oculta el precio al modelo para no anclarlo. Reusarla abriría esas tareas
  a datos que hoy no reciben.
- **Valor inicial:** `owner_accepted` en todas las fuentes registradas, por
  decisión del owner, con fecha y motivo («uso personal: el asistente del
  owner lee lo que el owner ya ve»). Comafi y Schwab incluidos: los datos de
  Comafi son ratios normalizados que el portal ya muestra, y los de Schwab
  son las transacciones del owner.
- **Cómo se aplica.** Cada herramienta declara las fuentes que lee, y una
  fuente `restricted` o `unknown` saca sus datos de la respuesta con su
  motivo. Así una fuente futura que lo prohíba se declara y se respeta sin
  tocar las herramientas (`TM-15`).
- **Nunca público.** Igual que `owner_accepted` en Yahoo, no habilita
  ninguna superficie pública.

### 7. Registro y límites

- **Log por llamada** (`TM-16`): `request_id`, herramienta, versión del
  catálogo, resultado, duración y bytes. Nunca los argumentos con valores ni
  la respuesta.
- **Tope diario** de llamadas, contado en PostgreSQL por día UTC como los
  presupuestos de la [ADR 0020](0020-source-daily-budget-kill-switch.md),
  con su kill switch (`pnpm ingestion:sources --source portal-mcp …`). Un
  loop del asistente no agota la Function ni la transferencia de Neon
  (`TM-10`). El valor se fija midiendo en el slice.
- **Errores** con `request_id`, sin almacenamiento, SQL ni host (`TM-02`).

### 8. Inyección de instrucciones

Lo que devuelve el MCP puede traer texto que no escribió el owner: nombres de
empresas, extractos de 10-K o notas pegadas. El asistente lo lee como datos.
Como el MCP no tiene herramientas que escriban ni que abran la red, una
instrucción inyectada no puede hacer nada en el portal (`TM-09`). Lo que el
asistente haga con otras herramientas suyas es responsabilidad de su
cliente, y el runbook lo advierte.

## Controles del threat model

| Control | Cómo se cierra                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `TM-01` | `servesRealData` antes del token; `locked` responde `404` sin abrir una base.                                               |
| `TM-02` | Token y bypass sólo en variables server-only; test de centinelas sobre la salida de cada herramienta; errores sin detalles. |
| `TM-03` | Route Handler con token comparado en tiempo constante, `Origin` rechazado, `Host` validado y entradas con schema cerrado.   |
| `TM-04` | Ruta dinámica, sin cache.                                                                                                   |
| `TM-07` | Entradas tipadas y cerradas; las consultas son las de los loaders existentes.                                               |
| `TM-08` | Ninguna herramienta usa la puerta de egress.                                                                                |
| `TM-09` | Sin herramientas de escritura ni de red: una inyección no tiene a qué llegar.                                               |
| `TM-10` | Tope diario con kill switch y tope de tamaño por respuesta.                                                                 |
| `TM-13` | `@modelcontextprotocol/server` con versión exacta y lockfile congelado en CI.                                               |
| `TM-14` | `MCP_ACCESS_TOKEN` sólo en local y Production; secreto de bypass propio y revocable.                                        |
| `TM-15` | `ownerAssistant` por fuente; una fuente que no lo admite sale de la respuesta con su motivo.                                |
| `TM-16` | Log por llamada sin argumentos ni respuesta.                                                                                |
| `TM-17` | El MCP no tiene ningún camino a Schwab: ni lectura en vivo ni órdenes.                                                      |

## Consecuencias

- **El asistente ve el portal** sin copiar y pegar, con la misma procedencia
  que la página.
- **Una dependencia y una variable más:** `@modelcontextprotocol/server` y
  `MCP_ACCESS_TOKEN`, más un secreto de bypass que se administra en Vercel.
- **Una dimensión de derechos más** en el registro, con su migración del
  espejo en PostgreSQL.
- **Sólo clientes que mandan headers:** Claude Code y Claude Desktop sirven;
  claude.ai y el celular no, hasta que una ADR decida OAuth.
- **Riesgo aceptado:** quien tenga los dos secretos lee todo lo que el MCP
  expone. Mitigación: revocar el bypass en Vercel o rotar el token, cada uno
  sin tocar al otro.

## Alternativas descartadas

- **OAuth para claude.ai y el celular.** Es lo que pide la especificación,
  pero exige un servidor de autorización y un login propios: autenticación
  de aplicación completa para un solo usuario. El owner lo descartó.
- **MCP local por stdio.** No pasa por Vercel ni necesita token, pero sólo
  sirve en la máquina con `.env.local` y el owner pidió remoto.
- **Sólo el secreto de bypass.** Abre el proyecto entero y no distingue al
  MCP de cualquier otro pedido: si se filtra, no hay una segunda puerta.
- **Quitar la protección de Production o abrir una excepción.** Las
  excepciones de Vercel son por dominio de preview, no por ruta, y
  desproteger Production pone los datos en una URL pública.
- **Reusar `aiTransfer`.** Mezcla el asistente del owner con las tareas IA
  del portal (sección 6).
- **`@modelcontextprotocol/sdk` v1 o `mcp-handler`.** v1 trae Express, Hono,
  CORS y rate limiting que el portal no usa; `mcp-handler` suma OpenTelemetry
  como peer. El paquete v2 da el `fetch` sin estado y nada más.
- **Leer la cuenta en vivo.** El owner no la pidió, y haría que el asistente
  gaste cuota de Schwab.

## Fuentes

Consultadas el 2026-11-16:

- [Claude Code: conectar servidores MCP](https://code.claude.com/docs/en/mcp)
- [MCP: autorización (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [MCP TypeScript SDK v2: servir por HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http)
- [Vercel: acceso automatizado y de agentes](https://vercel.com/docs/deployment-protection/automated-agent-access)
- [Vercel: Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
- `npm view @modelcontextprotocol/server@2.4.0` y su README (Apache-2.0,
  dependencias `zod` y `@modelcontextprotocol/core`).
