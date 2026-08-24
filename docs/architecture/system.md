# Arquitectura del sistema

- Estado: aceptada como arquitectura objetivo incremental
- Versión: 0.2
- Fecha: 2026-08-21
- Decisiones base:
  [`adr/0001-stack-cache-postgres.md`](adr/0001-stack-cache-postgres.md),
  [`adr/0002-runtime-modes-persistence-exposure.md`](adr/0002-runtime-modes-persistence-exposure.md)
  y
  [`adr/0003-decimal-arithmetic-valuation-engine.md`](adr/0003-decimal-arithmetic-valuation-engine.md)
- Contratos transversales:
  [`../security/threat-model.md`](../security/threat-model.md) y
  [`../design/interface-foundations.md`](../design/interface-foundations.md)
- Alcance activo: Fase 1, `F1-05`; no describe capacidades futuras como implementadas

## Objetivo

Portal Financiero evoluciona como un monolito modular Next.js. Una sola aplicación
compone páginas, casos de uso, dominio puro, repositorios y adaptadores. La
arquitectura prioriza trazabilidad financiera, ejecución simple y sustitución de
proveedores antes que distribución prematura.

La aplicación implementada hoy contiene el shell, health y la base de persistencia
de `F1-02`: schema/migración Drizzle, conexión pooled personal y repositorio demo
aislado. Proveedores, datos financieros y motores se agregan únicamente en los
slices autorizados por el roadmap.

## Topología objetivo

```text
Browser
  -> Next.js App Router
       -> Server Components ─────────────┐
       -> Server Actions                 │
       -> Route Handlers                 │
                                          v
                                Application services
                                  -> Pure domain
                                  -> Repository ports
                                  -> Provider ports
                                          |
                         +----------------+----------------+
                         v                                 v
                  PostgreSQL/fixtures             External providers
                                                    (jobs only)
```

Los Server Components leen snapshots mediante servicios de aplicación. Los
proveedores externos sólo participan en procesos de ingesta o investigación
controlados; nunca en el render de una página.

## Límites y dependencias

| Capa             | Responsabilidad                                                        | Puede depender de                          | No puede depender de                                   |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| `domain`         | identidades, reglas, fórmulas, invariantes y errores de negocio        | utilidades puras y tipos del mismo dominio | React, Next.js, Drizzle, red o SDKs                    |
| `application`    | orquestar casos de uso, ports, transacciones lógicas y DTOs            | dominio y contratos propios                | UI, payloads crudos o clientes concretos               |
| `infrastructure` | implementar repositorios, parsers y adaptadores                        | application/domain y librerías técnicas    | componentes o decisiones de presentación               |
| `ui`             | presentar DTOs y capturar intención del usuario                        | application DTOs y componentes compartidos | JSON de proveedor, SQL, secretos o fórmulas duplicadas |
| `server`         | DB, configuración, seguridad, proveedores y observabilidad server-only | infrastructure y librerías de runtime      | código importable por el browser                       |
| `app`            | rutas, layouts y composición web                                       | UI y application services                  | acceso directo a SDKs externos                         |

Una dependencia siempre apunta hacia reglas más estables. Un dominio puede
definir un port; la infraestructura lo implementa. La infraestructura no filtra
sus DTOs de proveedor hacia la UI.

## Estructura objetivo

```text
src/
  app/
    (portal)/
    api/
  components/
    ui/
    charts/
  modules/
    companies/
      domain/
      application/
      infrastructure/
      ui/
    screeners/
    growth-gap/
    valuation/
    argentina/
    research/
    configuration/
  server/
    db/
    providers/
    ai/
    observability/
    security/
  shared/
    domain/
    contracts/
    utils/
drizzle/
tests/
  fixtures/
  contract/
  integration/
  e2e/
```

No se crean carpetas vacías para simular avance. Cada módulo aparece con el slice
que implementa su primer contrato ejecutable.

## Caminos de ejecución

### Lectura de página

1. Un Server Component valida parámetros de ruta o búsqueda.
2. Invoca un servicio de aplicación directamente, sin `fetch` HTTP interno.
3. El servicio consulta un repository port.
4. El repositorio lee fixtures versionados en `demo` o PostgreSQL en `personal`.
5. El servicio devuelve un DTO sin secretos, raw restringido ni detalles del
   proveedor.
6. La UI muestra valor, unidad, fecha, freshness y calidad.

### Mutación del owner

1. Una Server Action o Route Handler valida modo, payload y tamaño.
2. En `demo`, la operación persistente o costosa falla con un error seguro.
3. En `personal`, el servicio aplica invariantes y persiste una transacción corta.
4. La invalidación ocurre después del commit exitoso.
5. El resultado registra actor operativo único, versión y trazabilidad; no agrega
   un modelo multiusuario.

### Ingesta

1. Un refresh manual, cron o worker reclama un ingestion run idempotente.
2. El adaptador aplica presupuesto, paginación, timeout, retry y backoff.
3. Zod valida el payload y el parser lo transforma a DTOs propios.
4. Staging conserva provenance, errores y raw según la licencia.
5. Una transacción corta publica un snapshot completo o conserva el último válido.
6. Recién después de publicar se invalidan tags derivados.

Nunca se mantiene una transacción abierta durante una llamada de red. Un error de
schema, respuesta vacía o cuota no reemplaza datos válidos por vacío.

### Valuación

1. El caso de uso fija un input snapshot y su fecha de conocimiento.
2. El selector determinista elige método o devuelve `unsupported_method`.
3. Los supuestos estructurados pasan por policy checks.
4. El dominio puro calcula escenarios y sensibilidad.
5. El resultado guarda input hash, engine version, política numérica y evidencia.
6. Recalcular el snapshot no llama proveedores ni IA.

## Frontera web y runtime

- React Server Components son el default.
- Client Components se limitan a interacción local, tablas y gráficos que
  necesiten hidratación.
- Route Handlers existen para cron, streaming, webhooks o consumidores HTTP
  reales; no son una API pública prometida.
- Server Actions se reservan para mutaciones originadas en la UI.
- Toda frontera alcanzable por red valida schema, modo, tamaño, presupuesto y
  errores.
- DB, secrets, proveedores e IA comienzan con `import "server-only"`.
- El runtime de aplicación es Node.js; no se selecciona Edge para módulos que
  dependan de DB, precisión o SDKs sin una decisión explícita.

## Persistencia

PostgreSQL es la fuente durable en modo personal. Fixtures versionados son la
fuente de la demo. La migración base materializa manifiestos temporales de snapshots;
los registros de fuentes e ingestas pertenecen a `F1-03` y crecerán por migraciones
versionadas.

`DATABASE_URL` es la conexión pooled exclusiva del runtime. La conexión directa
`DATABASE_DIRECT_URL` sólo puede ser leída por Drizzle Kit, migraciones o tareas
administrativas controladas. Las Functions no ejecutan migraciones al iniciar.

Los contratos aceptados son el
[modelo de identidad](../data/identity-model.md) y el
[contrato point-in-time](../data/point-in-time-contract.md). `F1-02` materializa el
envelope temporal base; las relaciones completas de identidad y observaciones se
implementan en sus slices posteriores. Rigen estas invariantes:

- los tickers no son claves estables;
- el tiempo efectivo y el tiempo de conocimiento son distintos;
- la disponibilidad pública y el registro local responden preguntas distintas;
- una revisión crea lineage y no destruye el valor anterior;
- joins entre proveedores exigen identidad y vigencia explícitas.

## Cache

El proyecto usa Cache Components de Next.js 16 conforme al ADR 0001.

- PostgreSQL o un fixture versionado siguen siendo la fuente de verdad.
- Toda función cacheada incluye modo, dataset, parámetros y versiones relevantes
  en su identidad.
- Snapshots inmutables pueden tener vida larga; índices de “último” se invalidan
  después de una publicación atómica.
- `cacheTag` usa namespaces estables y nunca contiene secretos.
- Health, configuración sensible, progreso y read-your-own-writes se leen sin
  cache compartida inicialmente.
- Respuestas de proveedor no se almacenan en la Data Cache como sustituto de la
  ingesta.

## Contratos y representación de datos

Zod es la fuente de verdad en runtime para variables, request boundaries,
payloads externos, fixtures y DTOs persistidos. Los tipos TypeScript se derivan
de schemas o representan contratos internos deliberados.

Reglas comunes:

- valores financieros sensibles cruzan límites como strings decimales;
- `null` requiere razón y no equivale a cero;
- unidad, moneda, período y timezone son parte del dato;
- una observación distingue raw, normalized y estado del raw;
- errores externos se mapean a categorías propias y no filtran payloads;
- fechas se serializan en ISO 8601 y declaran la semántica de `as_of`,
  `available_at` y `fetched_at`.

## Modos y configuración

El runtime se resuelve exclusivamente en servidor con dos ejes:

- `APP_MODE=demo | personal` expresa las capacidades solicitadas;
- `APP_RUNTIME_ACCESS=public | local | protected` declara el límite de acceso.

La declaración no prueba por sí sola que un deployment esté protegido. El
despliegue debe verificar esa protección fuera de la aplicación. Una combinación
inválida o insegura degrada al modo efectivo `demo`; nunca amplía capacidades.

### `demo`

- arranca sin DB ni credenciales;
- usa fixtures creados para el repositorio;
- rechaza ingesta live, IA y mutaciones persistentes;
- no sirve payloads capturados de la instancia personal.

### `personal`

- exige PostgreSQL pooled;
- sólo es efectivo con `APP_RUNTIME_ACCESS=local` fuera de Vercel o con
  `APP_RUNTIME_ACCESS=protected` en un Vercel Preview protegido;
- Vercel Production permanece en `demo`, aunque se solicite `personal`;
- sólo habilita un módulo cuando sus variables y gate están completos;
- mantiene keys server-owned y no introduce cuentas o BYOK.

El modo personal desplegado comienza con refresh manual. No se configura cron
live mientras Production permanezca en `demo`, porque el cron gestionado de
Vercel invoca el deployment de Production y no el Preview protegido.

`getConfigHealth()` informa `ready | degraded | disabled`, variables faltantes y
un mensaje seguro. Nunca devuelve valores del entorno.

## Errores y degradación

Los errores de dominio son valores tipados o excepciones propias que la capa web
mapea a estados estables. Una respuesta HTTP interna futura usa un envelope con
código, mensaje seguro, request ID y detalles permitidos por schema.

Estados mínimos:

- configuración inválida o módulo deshabilitado;
- dato faltante o no aplicable;
- snapshot stale pero utilizable;
- provider unavailable, cuota o timeout;
- parser/schema incompatible;
- identidad ambigua;
- input o método no soportado;
- policy check rechazado.

La degradación queda acotada al módulo o fuente afectada y conserva el último
snapshot válido cuando su freshness todavía se comunica honestamente.

## Seguridad y observabilidad

- Secrets y URLs de DB se redactan en logs y DTOs.
- Los endpoints costosos tienen límite global, timeout, payload máximo y kill
  switch antes de habilitarse.
- Research usa allowlist y bloquea destinos privados para reducir SSRF.
- Los logs estructurados incluyen request ID, modo, módulo, operación, latencia,
  retries, filas y freshness.
- Ingestas registran fuente, parser, cursor, counts, cuota y backoff.
- Valuaciones registran snapshot, input hash y engine version.
- IA, cuando sea autorizada, registra modelo/proveedor efectivos, tokens, costo y
  policy outcome sin prompts completos por defecto.

## Estrategia de pruebas

| Nivel       | Responsabilidad                                                            |
| ----------- | -------------------------------------------------------------------------- |
| unit        | dominio puro, schemas y edge cases sin red                                 |
| property    | invariantes financieras con precondiciones explícitas                      |
| contract    | parser/adaptador contra fixtures sanitizados y fallas externas             |
| integration | migraciones, repositorios, atomicidad e idempotencia con Postgres real     |
| E2E         | flujos de usuario, modos, degradación, teclado y accesibilidad             |
| eval        | evidencia, schema, abstención, seguridad y costo de capacidades IA futuras |

Los tests de integración live no sustituyen fixtures reproducibles ni bloquean
un cambio por una caída externa sin diagnóstico.

## Presupuestos y evolución

- Lecturas comunes: objetivo p95 server menor a 1,5 segundos sin streaming
  externo.
- Screeners amplios usan consulta y paginación server-side.
- Charts y tablas interactivas se cargan sólo en las rutas que los necesitan.
- Backfills usan lotes, cursor, lease y checkpoint; no recorren el universo desde
  una request del usuario.
- Se extrae un worker cuando duración, retries, fan-out o CPU demuestren que una
  Function no alcanza.

## Decisiones y trabajo diferido

- ADR 0001 fija stack, Cache Components y conexiones PostgreSQL.
- ADR 0002 fija los modos efectivos, la persistencia durable y el límite de
  exposición de datos.
- El modelo de identidad y el contrato point-in-time fijan semántica; `F1-02`
  implementa su envelope base y los slices siguientes amplían tablas y queries.
- La matriz contractual de fuentes registra derechos, cache, retención y cuotas;
  ninguna fuente real está aprobada por defecto.
- `F1-02` fija Drizzle ORM, Postgres.js, la migración inicial y la composición de
  repositorios, verificadas contra PostgreSQL 17.11 local dedicado.
- Fase 2 decidirá el mecanismo durable de jobs si el refresh lo requiere.
- Ningún proveedor real, cuenta externa o recurso con costo se crea desde este
  documento.

## Gate de cambios arquitectónicos

Una nueva dependencia estructural, proveedor, runtime, base, mecanismo de jobs o
exposición pública requiere ADR con contexto, decisión, alternativas, riesgos,
rollback y condición de revisión. Todo cambio conserva una versión ejecutable y
actualiza el roadmap con evidencia.
