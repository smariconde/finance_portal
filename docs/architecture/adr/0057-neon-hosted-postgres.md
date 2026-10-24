# ADR 0057: PostgreSQL personal en Neon

- Estado: aceptado para configurar el proyecto existente en `F6-06`.
- Fecha: 2026-10-24.
- Relacionadas: ADR 0001, 0004, 0008 y 0015.

## Decisión

El owner elige Neon y suministra el proyecto que creó y su rama `production`.
Se enlaza ese recurso; la configuración no crea otro proyecto, cambia de plan
ni habilita servicios adicionales. Se verificaron Free, AWS N. Virginia y
PostgreSQL 17.11 contra el recurso autenticado antes del traslado.

`neon.ts` declara PostgreSQL mediante la base incluida en cada rama y conserva
Auth desactivado, según el alcance personal sin cuentas. No agrega política de
TTL ni cambios de cómputo para las ramas existentes. La infraestructura se
revisa con `neon config plan` antes de `neon deploy`. El archivo `.neon` contiene
el enlace local a los identificadores privados y queda fuera de Git.

Se conserva Drizzle, `postgres.js`, el schema y las migraciones existentes.
`@neon/config` es una herramienta de desarrollo versionada en el lockfile;
ningún módulo de dominio ni ruta importa el SDK de Neon. El validador de entorno
existente sigue siendo la frontera del runtime.

## Entornos y credenciales

Antes de enlazar se respalda `.env.local` en un directorio privado fuera del
repositorio. Como contiene las conexiones locales vigentes, el enlace usa
`--no-env-pull` y la descarga explícita de PostgreSQL va a `.env.neon.local`.
El deploy también usa `--no-env-pull`. El CLI actual admite ambas opciones.

Neon devuelve inicialmente la conexión pooled como `DATABASE_URL` y la directa
como `DATABASE_URL_UNPOOLED`. Tras crear el rol aprobado, `.env.neon.local`
conserva `DATABASE_URL` con `finance_portal_runtime` y adapta la conexión directa
del owner a `DATABASE_DIRECT_URL` para migraciones. El rol de runtime tiene DML
sobre las 45 tablas públicas actuales y futuras; no tiene CREATE en `public`,
TEMP, SUPERUSER, CREATEDB, CREATEROLE ni BYPASSRLS. Se retiró TEMP de PUBLIC en
esta base dedicada; el owner conserva sus permisos administrativos.

`dev:neon` y `start:neon` cargan ese perfil explícito y escuchan en localhost;
`db:migrate:neon` usa la conexión administrativa. `.env.local` permanece intacto
y la integración sigue usando la base local descartable. Los comandos del
perfil ajustan a dos segundos el intento por dirección de Node: la prueba
desde esta máquina mostró timeouts intermitentes con el valor predeterminado.
Esto no cambia el timeout de las Functions ni el driver del portal.

El MCP del agente usa OAuth y se limita al proyecto del owner; su configuración
vive en el perfil del agente, sin API key en el repo. Los tokens de CLI/OAuth y
los enlaces de conexión no se incluyen en logs públicos ni documentación.
El owner completó la autenticación del CLI y el MCP quedó autenticado por OAuth.

## Aplicación y recuperación

El owner autorizó expresamente el traslado completo de las 46 tablas al proyecto,
rama y base suministrados, y la creación y alcance del rol de runtime. Se
comprobó que el destino estuviera vacío y que no hubiera jobs ni leases locales
abiertos. El dump de PostgreSQL 17 usa un snapshot exportado compartido con su
manifiesto; el restore es una sola transacción sin `--clean`, con journal de
Drizzle y sin copiar roles ni ACLs del servidor local.

Antes de las pruebas de la aplicación coincidieron las 46 tablas por conteo y
hash de contenido de sus filas; el archivo del backup también se verificó por
SHA-256. El backup y su manifiesto son privados, fuera del repositorio; la base
local se conserva. El journal está actualizado, el gate point-in-time pasa y
las diez corridas AAPL/AMZN se reproducen sin divergencias en Neon. La prueba
del runtime usa ese rol limitado, no el owner.

Free tiene una ventana de recuperación limitada y no se presenta como una
política de backup suficiente. Se mantienen backups privados antes de
migraciones y traslados; contratar más retención o cambiar de plan requiere una
decisión explícita. No se habilitan llamadas a fuentes ni IA para probar la
conexión.

La aplicación sigue ejecutándose localmente o en Vercel protegido. Neon no
despliega el frontend. `TM-14` y el gate de `F6-06` siguen abiertos hasta verificar
la protección real de Vercel y completar el job remoto, replay y walkthrough.

## Verificación

Revisar el plan remoto antes de aplicar, comprobar conexiones pooled y directa
sin imprimir sus valores, ejecutar build y comprobar ambos runtimes. Una prueba
de conexión sin schema o sin datos no se informa como una valuación completa.
La evidencia de ejecución se registra en el backlog y el roadmap. `npm run
build` con Turbopack encontró la restricción de puertos del entorno incluso
con ejecución ampliada; `npm run build -- --webpack` pasó. Esa limitación no se
oculta ni se cambia el comando de build habitual para sortearla.

Fuentes: [skill Neon](https://neon.com/.well-known/agent-skills/neon/SKILL.md),
[skill PostgreSQL](https://neon.com/.well-known/agent-skills/neon-postgres/SKILL.md)
y [pooling](https://neon.com/docs/connect/connection-pooling).
