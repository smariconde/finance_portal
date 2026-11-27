# Captura de inmuebles

La extensión del perfil Inmuebles de Brave lee cada ficha y listado de un
portal declarado que se abre y los envía al portal
([ADR 0089](../architecture/adr/0089-real-estate-intelligence-cordoba.md)).
Este runbook cubre instalarla, conectarla, actualizarla, frenarla y congelar
una página como corpus.

## Perfil dedicado

Un perfil de Brave sin sesión en ningún portal: un bloqueo no puede alcanzar
la cuenta de Mercado Libre ni la de Mercado Pago.

1. Ícono de perfil (arriba a la derecha) → **Añadir perfil** → «Inmuebles».
2. Sin sincronizar ni iniciar sesión en ningún portal desde ese perfil.

## Instalar

```sh
pnpm extension:build
```

En el perfil Inmuebles: `brave://extensions` → **Modo desarrollador** →
**Cargar desempaquetada** → `extensions/listings/.output/chrome-mv3`. El ID
tiene que ser `gmhcgoihkkneboibeanlkemldaalnikk`: lo fija la `key` del
manifest, y el endpoint rechaza cualquier otro origen.

## Conectar

El endpoint existe sólo en modo `personal` con `CAPTURE_TOKEN` válido
(base64url de al menos 32 bytes):

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

- **Local**: `CAPTURE_TOKEN=…` en `.env.local` y `pnpm dev`. En el popup,
  **Conexión**: portal `http://127.0.0.1:3000/`, el token y el bypass vacío.
- **Production**: `CAPTURE_TOKEN` en las variables de Production de Vercel
  (nunca en Preview, `TM-14`). En el popup: portal
  `https://finance-portal-flame.vercel.app/`, el token y el secreto de bypass
  de Vercel.

El popup se cierra al cambiar de ventana: cargar la conexión en dos vueltas
(portal y token, **Guardar**; después el bypass, **Guardar**), porque un campo
vacío conserva lo guardado. El bypass que ya usa el MCP del owner sirve:

```sh
python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.claude.json')))['mcpServers']['portal']['headers']['x-vercel-protection-bypass'],end='')" | wl-copy
curl -s -o /dev/null -w "%{http_code}\n" -H "x-vercel-protection-bypass: $(wl-paste)" https://finance-portal-flame.vercel.app/api/inmuebles/captura
```

`405` es un bypass válido (la ruta sólo acepta `POST`); `302` o `401` es que
Vercel no lo aceptó y el pedido no llegó al portal. El token de Production
está en `.env.capture-production.local` (ignorado por git):
`wl-copy < .env.capture-production.local`.

El ítem «Captura de inmuebles» de `/configuracion` dice si la ruta está
abierta. Copiar el token sin mostrarlo:

```sh
grep '^CAPTURE_TOKEN=' .env.local | cut -d= -f2 | wl-copy
```

Un campo vacío al guardar conserva el secreto anterior: el popup nunca lo
muestra.

## Usar

Navegar el portal a paso humano. Cada página que carga se lee sola; nada se
pide por fuera de lo que el owner abre. El popup muestra:

| Campo        | Qué dice                                                      |
| ------------ | ------------------------------------------------------------- |
| En cola      | Capturas que esperan al endpoint; «descartadas» si se llenó   |
| Último envío | Cuándo el endpoint aceptó un lote                             |
| Estado       | «Al día» o la falla con nombre                                |
| Hoy          | Páginas, avisos, desafíos y rechazos por portal (día de BA)   |
| Resultados   | Avisos nuevos, revisiones, vistos sin cambios, fuera de orden |

Lo guardado se ve en `/inmuebles`.

## Fallas

| Estado en el popup                         | Qué hacer                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| Falta la conexión                          | Completar **Conexión**                                                   |
| Token o bypass inválido                    | Revisar `CAPTURE_TOKEN` y el bypass; recargar la extensión no hace falta |
| El portal no sirve capturas (modo o token) | El runtime no es `personal` o no tiene `CAPTURE_TOKEN`                   |
| Tope diario alcanzado                      | Esperar al día siguiente (UTC); lo visto queda en la cola                |
| Portal no disponible / Sin red             | Nada: reintenta cada cinco minutos, o **Enviar ahora**                   |
| Lote rechazado por su forma                | Un adapter roto: ver el log `listing-capture` con su `X-Request-Id`      |

Un **desafío** (Cloudflare, captcha) no se resuelve: se cierra la pestaña. El
popup lo cuenta; dos días seguidos es motivo para dejar el portal.

## Barrido programado

`listing-sweep-1.0.0`: una vez por día, entre las 08:30 y las 11:30 de Buenos
Aires, la extensión abre una pestaña en segundo plano (sin foco) y recorre hasta 25 páginas por
portal a paso humano. Necesita Brave abierto con el perfil Inmuebles; si a esa
hora estaba cerrado, corre al abrirlo ese mismo día.

| En el popup             | Qué hace                                                                  |
| ----------------------- | ------------------------------------------------------------------------- |
| Pausar / Reanudar       | Frena el barrido del portal hasta reanudarlo                              |
| Barrer ahora            | Corre sin esperar la hora; relanza un día detenido, nunca uno con desafío |
| Reactivar tras desafíos | Aparece después de dos días seguidos con desafío                          |
| Seguir este aviso       | En una ficha: se revisa todos los días (hasta 20)                         |
| Guardar esta búsqueda   | En un listado: se recorre por «más recientes» (hasta 10)                  |
| Páginas por día         | Baja el tope de 25; nunca lo sube                                         |

Cerrar la pestaña del barrido lo detiene por el día. Un desafío bloquea el
portal por el día; dos días seguidos lo pausan.

## Frenar

```sh
pnpm ingestion:sources --source inmuebles-captura --disable --reason "…" --apply
```

Revocar: rotar `CAPTURE_TOKEN` en el entorno. La extensión encola hasta que
reciba el nuevo.

## Actualizar

Después de cambiar el código de la extensión: `pnpm extension:build` y ↻ en
`brave://extensions`.

## Congelar una página como corpus

1. En la página abierta, **Exportar página** en el popup (queda en
   Descargas).
2. En seco y después escribiendo:

   ```sh
   pnpm inmuebles:corpus --file ~/Downloads/remax-ar-….json --name casa-centro
   pnpm inmuebles:corpus --file ~/Downloads/remax-ar-….json --name casa-centro --write
   ```

3. Revisar el `.expected.json` contra la página y buscar contacto en el
   archivo reducido antes de commitear. El exportado crudo no se copia: borrarlo
   de Descargas.
