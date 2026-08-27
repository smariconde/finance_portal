# Entorno y despliegue Vercel

## Filosofia de configuracion

La app debe arrancar con modulos opcionales deshabilitados y mostrar un setup health claro. El codigo es publico, pero las variables y la base pertenecen al owner. `APP_MODE=locked` no necesita keys ni base: no sirve nada. `APP_MODE=personal` solo es efectivo junto con un limite de acceso valido —local fuera de Vercel o Preview protegido— y una `DATABASE_URL` pooled. Ver [ADR 0004](../architecture/adr/0004-personal-first-runtime.md).

## Variables

```dotenv
# Publicas, nunca secretos
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Portal Financiero

# Core server-only
# Pooled runtime connection
DATABASE_URL=
# Direct connection, migrations/admin only
DATABASE_DIRECT_URL=
CRON_SECRET=
APP_ENV=development
APP_MODE=locked
APP_RUNTIME_ACCESS=public
LOG_LEVEL=info

# Mercado personal: provider inicial
MARKET_DATA_PROVIDER=alpaca
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
ALPACA_DATA_FEED=sip
MARKET_DATA_MAX_REQUESTS_PER_MINUTE=100
MARKET_DATA_MAX_REQUESTS_PER_RUN=1000

# SEC exige identificacion responsable
SEC_USER_AGENT=PortalFinanciero/0.1 contact@example.com

# IA e investigacion
OPENROUTER_API_KEY=
OPENROUTER_MODEL_FAST=
OPENROUTER_MODEL_REASONING=
OPENROUTER_ENFORCE_ZDR=true
OPENROUTER_DATA_COLLECTION=deny
OPENROUTER_PROVIDER_ALLOWLIST=
TAVILY_API_KEY=

# Opcionales
SENTRY_DSN=
```

No fijar model IDs en este documento: cambian. La fase que habilita IA consulta la lista actual, elige modelos compatibles con structured outputs, registra costo/capacidades/politica de datos en ADR y valida las variables. Las variables anteriores deben mapearse a controles por request y verificarse en metadata; no son controles por si solas.

## Esquema de validacion

Crear grupos:

- `core`: modo, base y cron cuando se use scheduling;
- `marketData`: keys de Alpaca solo en `personal`;
- `ai`: OpenRouter;
- `research`: Tavily;
- `observability`: opcional por fase.

`locked` rechaza cualquier configuracion de ingesta live aunque existan keys por error, y no abre PostgreSQL. `personal` exige Postgres y habilita modulos solo si sus variables estan completas. Tambien exige `APP_RUNTIME_ACCESS=local` fuera de Vercel o `APP_RUNTIME_ACCESS=protected` en un Vercel Preview. Una combinacion ausente, invalida o insegura queda en el modo efectivo `locked`; Vercel Production siempre queda `locked`. El modo se resuelve en cada request y no se hornea en el build ([ADR 0005](../architecture/adr/0005-request-time-runtime-boundary.md)), asi que un artefacto compilado en la maquina del owner no sirve datos al desplegarse en otro lado. `DATABASE_URL` usa pooling compatible con Functions; `DATABASE_DIRECT_URL` nunca se importa desde rutas normales y se reserva al job controlado de migracion. Si una cola/workflow se aprueba por ADR, agregar sus variables en ese cambio.

`getConfigHealth()` retorna `ready | degraded | disabled`, missing vars y mensaje seguro. Nunca incluye valores.

## Setup local

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

Comandos objetivo:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

## Modos de ejecucion

### Personal

- Opcion mas simple: `APP_MODE=personal` y `APP_RUNTIME_ACCESS=local` fuera de Vercel, con Postgres remoto o local y refresh manual.
- Opcion desplegada: `APP_MODE=personal` y `APP_RUNTIME_ACCESS=protected` en una Preview URL protegida con Vercel Authentication. La variable es una declaracion operativa; el checklist debe confirmar la proteccion real. No requiere construir login, sesiones ni tablas de usuarios.
- En Hobby, Standard Protection no protege el production domain. Por eso production queda `locked`; los datos reales se usan en localhost o en una URL que la plataforma confirme como protegida.
- No se programa Vercel Cron para este modo: el servicio invoca Production, no Preview. El refresh inicial es manual.

### Trabado

- `APP_MODE=locked`, `APP_RUNTIME_ACCESS=public`, sin base, sin keys y sin datos de ningun tipo.
- No es una demo: no hay conjunto de datos de reemplazo ni version reducida del producto. La ADR 0004 elimino esa rama a proposito, porque hacia que un entorno mal declarado pareciera funcionar.
- Solo queda disponible el diagnostico de `/configuracion`, que es lo que permite salir del estado.

## Vercel

1. Importar repo en Vercel.
2. Provisionar Postgres (Neon/Supabase/otro) desde Marketplace en region compatible.
3. Configurar Production con `APP_MODE=locked` y `APP_RUNTIME_ACCESS=public`; agregar keys solo al entorno Preview personal/protegido y marcarlas como sensibles.
4. Ejecutar migraciones mediante job controlado, no implicitamente desde cada Function.
5. No configurar cron live mientras Production este `locked`. Vercel Cron invoca Production, no Preview; el modo personal comienza con refresh manual. Una automatizacion posterior exige un nuevo ADR, un destino protegido y autenticacion verificable.
6. Configurar `maxDuration` solo en rutas que lo necesiten; no subirlo globalmente como parche.
7. Desplegar preview, correr E2E smoke y promover.
8. Registrar modelo de cache de la version Next.js instalada y probar invalidacion/freshness; no mezclar Cache Components y convenciones anteriores accidentalmente.

Ejemplo conceptual para una fase posterior, solo despues de aprobar un destino live protegido:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/daily-market-data", "schedule": "15 3 * * *" },
    { "path": "/api/cron/daily-argentina", "schedule": "45 11 * * *" }
  ]
}
```

Los cron usan UTC. En Hobby solo pueden ejecutarse diariamente y dentro de la hora, por lo que el portal no depende de precision intrahoraria. El precio objetivo es EOD.

## Check de deployment

- env health sin exponer secretos;
- migracion aplicada y rollback conocido;
- guard `personal | locked` y `public | local | protected` verificados;
- Preview personal confirmada como protegida fuera de la aplicacion; Production confirmada `locked`;
- region DB/Functions documentada;
- provider live smoke de bajo costo solo en `personal`;
- source registry/licencia vigente;
- no `NEXT_PUBLIC_*KEY*`;
- logs redacted y presupuesto de proveedor activo;
- disclaimer/metodologia/freshness visibles.
- uso personal/cache/export confirmado para el plan; ninguna URL anonima sirve datos;
- data map minimo revisado para IA/telemetria habilitadas;
- endpoints IA ausentes con el runtime trabado y con budget/kill switch en personal;
- pooling verificado y la URL directa ausente del runtime normal.

## Persistencia entre sesiones

Postgres es la fuente durable para snapshots, uso de cuota, preferencias, watchlists y valuaciones. El cache de Next.js puede invalidarse o desaparecer sin perder datos. `localStorage` se limita a tema, densidad de tabla y borradores no sensibles; `sessionStorage` no se usa como cache. Las API keys existen unicamente en variables server-only y se rotan desde el entorno.
