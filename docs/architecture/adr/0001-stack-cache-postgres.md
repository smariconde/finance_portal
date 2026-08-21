# ADR 0001: stack, cache de Next.js y conexiones PostgreSQL

- Estado: aceptado
- Fecha: 2026-08-21
- Alcance: Fase 0B.1

## Contexto

El portal necesita servir una demo deterministica sin secretos y una instancia
personal con datos reales protegidos. Las paginas deben leer snapshots ya
persistidos, nunca consultar proveedores durante el render, y conservar datos,
provenance y valuaciones entre ejecuciones de Functions.

Next.js 16 ofrece dos modelos de cache. Mezclarlos implicitamente haria dificil
razonar sobre freshness e invalidacion. A la vez, abrir el pool por defecto de un
driver desde cada instancia serverless puede agotar las conexiones de Postgres.

## Decision

### Aplicacion

- Mantener una sola aplicacion Next.js 16 con App Router, React Server Components
  por defecto, TypeScript estricto, pnpm y runtime Node.js.
- Mantener el monolito modular. El dominio no importa Next.js, React, Drizzle ni
  SDKs externos.
- Server Components invocan servicios de aplicacion directamente. Route Handlers
  se reservan para limites HTTP reales; no se hace `fetch` interno a la propia app.
- El acceso a base, secretos y proveedores vive bajo `src/server/` y usa
  `server-only`.

### Modelo de cache de Next.js 16

- Activar `cacheComponents: true` y adoptar exclusivamente Cache Components para
  nuevas lecturas cacheadas.
- Postgres o los fixtures versionados son la fuente de verdad. La cache de Next.js
  es derivada, descartable y nunca prueba que un dato financiero este vigente.
- Una lectura se cachea solo si declara de forma explicita:
  - identidad de dataset o agregado;
  - modo `demo | personal`;
  - parametros como entidad, fecha, moneda y periodo;
  - version de fixture, parser, formula o metodologia cuando afecte el resultado;
  - politica de freshness e invalidacion.
- Las funciones elegibles usan `'use cache'`, `cacheLife` y `cacheTag`. No se
  introduce `unstable_cache` ni convenciones del modelo anterior.
- Los tags usan namespaces estables, por ejemplo `source:<id>`,
  `company:<id>:snapshot:<id>` y `valuation:<snapshot-id>`. No se derivan de
  secretos ni de texto libre sin normalizar.
- Despues de publicar un snapshot en una transaccion exitosa:
  - un Route Handler o job usa `revalidateTag(tag, 'max')` cuando admite
    stale-while-revalidate;
  - una Server Action usa `updateTag(tag)` cuando el owner necesita
    read-your-own-writes inmediato.
- `revalidatePath` queda para cambios estructurales de una ruta, no como
  invalidacion habitual de datos.
- Configuracion, health sensible, borradores, progreso de jobs y datos cuyo estado
  actual no tolere staleness se leen sin cache compartida.
- Los snapshots inmutables identificados por version pueden usar una vida larga.
  Una correccion crea una version nueva e invalida los indices que apuntan a
  "ultimo", sin reescribir el historico.
- Las descargas de proveedores no usan la Data Cache como almacenamiento. El job
  controla cuota, validacion e idempotencia y publica en Postgres antes de
  invalidar cualquier lectura.
- Nunca se cachean secretos, credenciales, payloads restringidos por licencia ni
  respuestas que puedan cruzar los modos `demo` y `personal`.

### PostgreSQL, Drizzle y pooling

- Usar PostgreSQL provisionable mediante Vercel Marketplace, sin acoplar el
  dominio a un proveedor concreto.
- Usar Drizzle ORM con el driver Postgres.js en runtime Node.js. La instalacion y
  el primer schema se difieren al slice de persistencia de Fase 1.
- `DATABASE_URL` es exclusivamente la URL pooled del runtime. Toda lectura y
  escritura normal usa esa variable.
- `DATABASE_DIRECT_URL` es exclusivamente la URL directa para Drizzle Kit,
  migraciones y tareas administrativas controladas. Ninguna ruta normal puede
  importarla.
- Crear un cliente reutilizable por isolate. En desarrollo se conserva un
  singleton a traves de hot reload; no se crea un cliente por repository ni por
  request.
- Configurar Postgres.js con `max: 1`, timeout de conexion acotado e
  `idle_timeout`. El pooler externo absorbe la concurrencia entre Functions.
- Usar `prepare: false` por compatibilidad conservadora con poolers en modo
  transaction. Esta opcion puede revisarse si el proveedor elegido documenta y
  valida prepared statements end-to-end.
- Functions y procesos web no ejecutan migraciones al arrancar. Las migraciones
  corren una vez, en un job controlado y con la conexion directa.
- No mantener una transaccion abierta mientras se llama a un proveedor. La
  ingesta escribe staging y hace una transaccion corta para publicar el snapshot
  y su provenance de forma atomica.
- Region de Functions y region primaria de Postgres se eligen juntas. El limite
  efectivo del pooler se define despues de conocer el plan contratado y se prueba
  con concurrencia antes de habilitar datos live.

## Matriz inicial de cache

| Lectura                              | Fuente             | Cache Next.js                     | Invalidacion                     |
| ------------------------------------ | ------------------ | --------------------------------- | -------------------------------- |
| Catalogos y definiciones versionadas | Postgres o fixture | larga, por tag                    | nueva version publicada          |
| Snapshot financiero por ID           | Postgres           | larga, por ID/version             | solo correccion versionada       |
| Ultimo snapshot de empresa o fuente  | Postgres           | acotada, por tag                  | publicacion atomica              |
| Screener derivado                    | Postgres           | acotada y parametrizada           | cambios en datasets dependientes |
| Valuacion guardada por snapshot      | Postgres           | larga, por version                | nueva corrida o correccion       |
| Health de configuracion y progreso   | entorno/Postgres   | sin cache compartida              | no aplica                        |
| Preferencias y borradores del owner  | Postgres           | sin cache compartida inicialmente | read-your-own-writes             |
| Respuesta cruda de proveedor         | proveedor          | no usar como almacenamiento       | pipeline de ingesta              |

Los tiempos concretos se fijan junto con la cadencia y el contrato de cada
dataset. Ningun TTL generico sustituye `as_of`, `available_at` o el estado de
freshness que muestra la UI.

## Consecuencias

### Positivas

- Existe un solo modelo de cache para Next.js 16.
- La perdida o invalidacion total de la cache no pierde informacion financiera.
- La publicacion atomica y los tags alinean la UI con snapshots versionados.
- El runtime no multiplica por diez las conexiones de cada Function.
- La aplicacion conserva portabilidad entre proveedores PostgreSQL compatibles.

### Costos y riesgos

- Cada agregado cacheado necesita un inventario explicito de dependencias y tags.
- `max: 1` limita concurrencia dentro de un isolate; primero se optimizan queries
  y batching, y solo se aumenta con medicion y presupuesto de conexiones.
- `prepare: false` sacrifica una optimizacion a cambio de compatibilidad con
  transaction pooling.
- Cache Components requiere pruebas especificas de invalidacion, modo y freshness.

## Alternativas descartadas

- **Modelo anterior de cache de Next.js:** evita el flag, pero prolonga APIs y
  convenciones que el proyecto tendria que migrar mas adelante.
- **Postgres como simple cache de proveedores:** no alcanza; snapshots,
  provenance, valuaciones y preferencias son estado durable del producto.
- **Pool local grande por Function:** el total escala con cada isolate y puede
  agotar `max_connections`.
- **Driver HTTP especifico de un proveedor:** puede reconsiderarse si mediciones
  reales justifican el acoplamiento. No se necesita para el primer vertical.
- **Migraciones automaticas al iniciar:** varias Functions pueden competir y una
  migracion fallida bloquearia trafico normal.

## Verificacion requerida

En este slice:

- `next.config.ts` activa `cacheComponents`;
- typecheck, tests y build siguen pasando;
- las variables pooled/direct permanecen separadas y sin valores reales.

Antes de cerrar el slice de persistencia de Fase 1:

- test de repositorio contra Postgres real;
- test que demuestra que runtime no lee `DATABASE_DIRECT_URL`;
- test de invalidacion despues de publicacion y de aislamiento `demo | personal`;
- prueba de concurrencia contra el pooler elegido y registro de conexiones pico;
- migracion `up` reproducible ejecutada fuera del runtime web.

## Fuentes primarias

- [Next.js: Cache Components](https://nextjs.org/docs/app/getting-started/cache-components)
- [Next.js: revalidacion](https://nextjs.org/docs/app/getting-started/revalidating)
- [Next.js: `cacheTag`](https://nextjs.org/docs/app/api-reference/functions/cacheTag)
- [Drizzle ORM: PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)
- [Postgres.js: conexiones y serverless](https://github.com/porsager/postgres)
- [Vercel: Postgres mediante Marketplace](https://vercel.com/docs/postgres)

## Revisar esta decision cuando

- se elija el proveedor y plan PostgreSQL concreto;
- una medicion demuestre que el driver o `max: 1` es un cuello de botella;
- Next.js cambie el contrato estable de Cache Components;
- una ingesta necesite un worker o runtime distinto de Node.js;
- la aplicacion deje de ser single-owner.
