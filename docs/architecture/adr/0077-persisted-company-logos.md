# ADR 0077: logos persistidos y marcas de trading

- Estado: aceptado por pedido expreso del owner el 2026-11-16.
- Sustituye la carga externa y la decisión de no persistir de la
  [ADR 0062](0062-company-logos-browser-loaded.md).
- Relacionadas: ADR 0004, 0009, 0020, 0073 y 0076.

## Contexto

El owner pidió descargar los logos y conservarlos en PostgreSQL para tenerlos
disponibles entre sesiones, aun si logo.dev deja de responder. Solicitó proceder
pese a las limitaciones registradas en ADR 0062. También pidió el cuadrado con
esquinas redondeadas de Finviz en trading, conservando el círculo en matrices y
gráficos. Esta mejora antecede a `F11-13`; no inicia ese slice.

## Decisión

- `logo-dev` se registra como fuente personal. La descarga y persistencia llevan
  `owner_accepted`, no `allowed`: es la decisión expresa del owner, no un cambio
  en los derechos concedidos por el proveedor. Exhibición pública, export e IA
  siguen cerrados. No se descargan imágenes de Finviz.
- La migración aditiva `0051_futuristic_the_fallen` crea `company_logo_assets`
  en la base de análisis, compartida por todo el portal. Trading conserva su
  base separada: allí no se duplica el activo visual.
- Cada activo tiene UUID, fuente, localizador del proveedor, versión del parser,
  PNG binario, SHA-256 binario y fecha de descarga. No se guarda una URL con
  token. El localizador por símbolo no es una FK a una entidad, security o
  listing, ni una afirmación de identidad. Es una imagen decorativa actual:
  no entra en snapshots, exports ni lecturas financieras point-in-time.
- `GET /api/company-logos/[ticker]` verifica el modo antes de construir storage.
  Lee primero la imagen guardada; funciona sin clave y sin egress cuando existe.
  Si falta, reserva su descarga con una lease de 60 segundos y token de fencing
  en PostgreSQL. No mantiene una transacción abierta durante la red.
- La descarga usa el egress medido existente: sólo `img.logo.dev/ticker/`,
  `GET`, sin redirects, 8 segundos y 256 KiB. Techo interno de 600 pedidos por
  día, compartido con el CLI y sujeto al kill switch. El gate de derechos
  se ejecuta antes de la llamada. No hay llamadas durante el render de páginas.
- Se conserva el localizador canónico de 128 × 128 px (`size=64`, retina,
  PNG, `fallback=404`). Se exige firma PNG, dimensiones y una única imagen;
  Sharp decodifica bajo un límite de píxeles y recodifica sin metadata antes
  de publicar. HTML, SVG, payload truncado y respuestas distintas de 200/404
  se rechazan. Nunca se publica una respuesta de error como logo.
- Un 404 se recuerda 24 horas; errores transitorios se reintentan después de
  cinco minutos. Un escritor cuya lease venció no puede sustituir la imagen o
  diferir el trabajo de su sucesor. Un logo válido no caduca ni se redescarga
  automáticamente; un cambio de marca o símbolo requiere revisión explícita.
- Las imágenes se sirven con `image/png`, `nosniff`, ETag y caché **privada**
  de 24 horas; ausencias y errores llevan `no-store`. No se aceptan URLs,
  queries, tamaños ni formatos elegidos por el cliente. La CSP vuelve a
  `img-src 'self' data:` y la clave deja de entregarse al navegador.
- Una clave CDN restringida por dominio puede requerir `LOGO_DEV_REFERER`:
  origen real de la aplicación, sin credenciales, path ni query. La allowlist
  declara esa variable y la puerta agrega el header sólo después de autorizar
  el destino. No se toma del request del navegador.
- `CompanyMark` conserva el círculo por defecto. `TickerMark` usa el cuadrado
  con radio proporcional del 20 %, 24 px en tablas y 32 px en la cabecera del
  trade, `contain`, fondo claro y monograma con el mismo contorno. Se aplica
  a cuenta, órdenes, diario, estadísticas por ticker, lecciones y plan. Las
  marcas circulares de matrices y gráficos conservan su geometría y tamaño.

## Operación y consecuencias

`pnpm logos:ingest --universe` lista los símbolos de las membresías vigentes y
conocidas de la base local, sin red ni escrituras. Con `--apply` baja sólo los
faltantes. `--ticker KO --ticker AAPL` acota la selección. La variante
`logos:ingest:neon` superpone el perfil privado Neon al local. Ver el
[runbook](../../runbooks/company-logos.md).

Los bytes viven sólo en la base privada. El repositorio conserva una fixture
PNG sintética para el contrato del proveedor. El rollback elimina únicamente
esta tabla de activos recuperables, sin tocar observaciones. Antes de migrar
Neon rige la verificación de snapshot de ADR 0073; la migración es compatible
con el código anterior, que todavía carga del CDN.

## Evidencia

El estado de descarga real, los tests y la revisión a 1440/390 px se registran
en `F11-16` del backlog y en el registro de sesiones del roadmap.

## Fuentes

- [Logo.dev: imágenes y parámetros](https://www.logo.dev/docs/logo-images/introduction).
- [Logo.dev: self-hosting](https://www.logo.dev/docs/platform/self-hosting).
