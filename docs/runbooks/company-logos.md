# Logos de empresas

Implementación y decisión del owner: [ADR 0077](../architecture/adr/0077-persisted-company-logos.md).
Las imágenes viven en la base de análisis, también para trading.

## Preparación

1. Aplicar `pnpm db:migrate` en local. La tabla nueva es `company_logo_assets`.
2. Mantener `LOGO_DEV_PUBLISHABLE_KEY` en el entorno del servidor. Para claves
   restringidas por dominio, declarar `LOGO_DEV_REFERER` con el origen real de
   la aplicación, por ejemplo `http://localhost:5000` en ese servidor local.
   En el deployment es su origen HTTPS. No usar el origen de otra aplicación.
3. Antes de aplicar `pnpm db:migrate:neon`, verificar el snapshot reciente
   según [ADR 0073](../architecture/adr/0073-neon-free-network-transfer-recovery.md).
   Un snapshot anterior no se reemplaza sin decisión del owner. Verificar
   después `pnpm db:status:neon`.
4. El runtime necesita SELECT, INSERT y UPDATE sobre la tabla nueva. Conservar
   la conexión administrativa fuera del runtime. El deployment también necesita
   la clave y el origen para descargar faltantes; no los necesita para leer un
   PNG que ya está guardado.

## Descarga inicial

```bash
# Plan de símbolos vigentes y conocidos; no descarga ni escribe.
pnpm logos:ingest --universe

# Descarga sólo los faltantes de la base local.
pnpm logos:ingest --universe --apply

# Selección explícita, incluso un ticker de trading fuera del universo.
pnpm logos:ingest --ticker KO --ticker AAPL --apply

# Mismo flujo contra el perfil Neon; conserva el destino local.
pnpm logos:ingest:neon --universe
pnpm logos:ingest:neon --universe --apply
```

El CLI limita la selección a 600 símbolos. La selección del universo usa tiempo
efectivo y de conocimiento al inicio de la corrida y las revisiones vigentes;
no exporta datos financieros. No hace falta una descarga previa para abrir
una pantalla: su imagen pide el mismo loader y reserva el faltante en la base.

La fuente comparte el presupuesto de 600 requests por día UTC entre navegador
y CLI. `pnpm ingestion:sources` permite inspeccionarlo y controlar el kill
switch existente. Las imágenes guardadas no consumen cuota del proveedor.

## Verificación y fallos

- El resultado `stored` identifica una imagen durable; también aparece cuando
  se reutiliza una existente. `missing` puede ser ausencia, falta de clave o
  reserva/cooldown vigente. `unavailable` identifica un fallo transitorio y
  hace que el CLI termine con código distinto de cero.
- Un 401 del CDN suele indicar que falta el origen exigido por la clave; un
  origen inválido se rechaza antes de abrir la conexión. Nunca imprimir la
  URL con el token ni registrar los headers del proveedor.
- Un 404 deja un monograma y se recuerda un día. Un error de red, cuota o
  validación difiere el reintento cinco minutos. No hay bucle de reintentos.
- En el navegador, el PNG propio responde con caché privada y ETag; quitar la
  clave y repetir un request sin caché debe seguir entregando la misma imagen
  guardada. El runtime trabado responde 404 sin abrir la base ni el proveedor.
- Una base sin `0051` entrega 503 al endpoint y la UI usa el monograma.
  Aplicar la migración en el destino correcto antes de revisar cobertura.
- Las imágenes no caducan en PostgreSQL. Cambios de marca o reasignaciones de
  símbolos requieren una revisión explícita; no borrar filas como un refresh
  rutinario ni modificar el grafo financiero para corregir una imagen.

La fixture `src/server/company-logos/fixtures/company-logo.png` es una placa
sintética RGBA de 128 × 128 px. No contiene una marca real ni una captura del
proveedor. Unit y contrato del proveedor se ejecutan sin red; integración
verifica binarios, reservas concurrentes, fencing y cooldown sobre PostgreSQL.

## Verificación en Neon del 2026-11-16

El owner autorizó reemplazar el snapshot anterior y aplicar antes del merge del
PR #134. Snapshot `f11-16-before-0051-2026-11-16`
(`snap-dry-sea-b7zx3g8p`, rama `production`, 13:46:03 UTC), migración `0051`
aplicada y journal 52 de 52. Se copiaron 528 PNG locales en una transacción,
con hash verificado y `ON CONFLICT DO NOTHING`, conservando fuente, parser y
fecha original: 4.100.599 bytes subidos, sin redescargar esas imágenes. La
consulta del faltante DUK devolvió ausencia; conserva monograma.

KO se leyó desde Neon con la clave del proveedor vacía: 1.496 bytes y el mismo
SHA-256. Vercel Production tiene configurado el origen real `LOGO_DEV_REFERER`;
la protección All Deployments sigue habilitada. No se guardaron payloads,
imágenes de empresas ni credenciales en el repositorio.
