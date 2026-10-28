# ADR 0062: logos de empresas cargados por el navegador desde logo.dev

- Estado: aceptado
- Fecha: 2026-10-28
- Relacionadas: [ADR 0004](0004-personal-first-runtime.md),
  [ADR 0009](0009-egress-boundary.md),
  [ADR 0058](0058-didactic-valuation-result.md)

## Contexto

El owner pidió el logo de cada empresa en la valuación y en las otras
superficies, para que la lectura sea más didáctica: reconocer la empresa antes
de leer sus cifras.

Hasta ahora ningún recurso de terceros llega al navegador. La CSP limita las
imágenes a `'self'` y `data:`, y toda salida a la red pasa por una sola puerta
del servidor, con allowlist, derechos y presupuesto diario (ADR 0009, 0020).

Se revisaron las dos APIs de logos con plan gratuito el 2026-10-28:

- **logo.dev** resuelve por ticker (`img.logo.dev/ticker/AAPL`), con 500.000
  pedidos por mes y sin atribución para uso personal. Permite cachear en el
  navegador 24 horas. **Guardar las imágenes en infraestructura propia exige la
  licencia de self-hosting de un plan pago**. La clave publicable (`pk_`) está
  pensada para ir en el cliente y admite restricción por dominio.
- **Brandfetch** exige que el logo se embeba directo desde su CDN, con
  `Referer`. Tampoco admite servirlo desde la app.

Ninguna opción gratuita permite que el servidor baje el logo por la puerta de
egress y lo sirva desde el origen propio.

## Decisión

El navegador carga el logo directamente de `https://img.logo.dev`, con la
clave publicable. Es la primera excepción a «sólo recursos propios», acotada
así:

- **CSP:** `img-src` suma exactamente `https://img.logo.dev`. Ningún otro
  host, y ningún otro tipo de recurso (scripts, estilos ni `connect-src`).
- **Clave:** `LOGO_DEV_PUBLISHABLE_KEY`, leída en el servidor durante el
  request. No es secreta: termina en el HTML por diseño del proveedor. Por eso
  no lleva el prefijo `NEXT_PUBLIC_`, no se hornea en el build y no es un
  centinela de `TM-02`. Una clave que no tenga la forma `pk_…` se ignora.
- **Sólo modo personal:** los logos aparecen únicamente en superficies que
  sirven datos, y un runtime trabado no las sirve.
- **URL:** `ticker/<símbolo>?token=…&size=64&format=png&retina=true&fallback=404`.
  `fallback=404` hace que el proveedor no invente un monograma propio: sin
  logo, la app dibuja el suyo.
- **Monograma propio:** sin clave, ante un 404 o ante cualquier falla de carga,
  se muestran las iniciales de la empresa sobre un color estable derivado del
  ticker. El logo nunca es la única forma de identificar a la empresa: el
  nombre y el ticker están siempre al lado, y la imagen es decorativa
  (`alt=""`).
- **Fondo fijo:** el logo va sobre una placa clara en los dos temas, porque
  muchos logos son oscuros sobre transparente y desaparecerían en el tema
  oscuro.
- **Sin persistencia:** no se guarda ninguna imagen ni URL en la base. El
  navegador cachea según los headers del proveedor.

El logo es un elemento de identificación, no un dato financiero: no entra en
ningún snapshot, hash ni export, y no es point-in-time (es el logo actual,
aunque la corrida sea de otra fecha).

## Consecuencias

- logo.dev ve qué tickers abre el owner y desde qué origen, porque el header
  `Referrer-Policy: strict-origin-when-cross-origin` manda sólo el origen y
  el ticker va en la URL. Es el costo aceptado de no pagar por self-hosting.
- La restricción por dominio de la clave sigue funcionando, porque el origen
  viaja en el `Referer`.
- Sin clave configurada, la app funciona igual: todas las empresas tienen
  monograma y el navegador no habla con terceros.
- Reabrir si el owner contrata self-hosting —entonces el logo pasa a la puerta
  de egress y la CSP vuelve a `'self'`—, si cambian los términos de logo.dev o
  si aparece una superficie pública.

## Fuentes

- [logo.dev, precios](https://www.logo.dev/pricing)
- [logo.dev, cacheo](https://www.logo.dev/docs/platform/caching.md)
- [logo.dev, self-hosting](https://www.logo.dev/docs/platform/self-hosting.md)
- [logo.dev, imágenes de logos](https://www.logo.dev/docs/logo-images/introduction.md)
- [Brandfetch, guías del Logo API](https://docs.brandfetch.com/logo-api/guidelines.md)
