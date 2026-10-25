# Despliegue personal protegido

- Slice: `F6-06`; controles `TM-14`, `TM-01`, `TM-02` y `UI-02`.
- Estado: Neon operativo y Vercel Authentication / All Deployments activado;
  Production sirve `personal` con el rol pooled, Preview permanece `locked`.
  Faltan backup operativo, prueba del job y walkthrough del owner.
- Contrato: [ADR 0008](../architecture/adr/0008-remote-personal-access.md).

## Decisión de PostgreSQL

La [ADR 0057](../architecture/adr/0057-neon-hosted-postgres.md) registra la elección
de Neon y del proyecto existente suministrado por el owner, con PostgreSQL como
único servicio. Se verificaron rama `production`, AWS N. Virginia, PostgreSQL
17.11 y organización Free contra el recurso autenticado antes del traslado; la decisión
no contrata un plan pago. El destino de la aplicación sigue siendo Vercel;
crear un proyecto no confirma que su URL esté protegida.

La protección prevista es **Vercel Authentication / All Deployments** y la base
usa endpoint pooled y directo. El traslado conserva la base local y requiere
backup, destino vacío y verificación del restore.

## Configuración local de Neon

CLI oficial instalado en la máquina: `neon` 8.11.3. La configuración `neon.ts`
usa `@neon/config` 1.9.4 como dependencia de desarrollo y conserva Auth apagado.
El MCP de Codex se registró por OAuth, limitado al proyecto del owner; ese
registro y la autenticación OAuth se verificaron en esta máquina. Cada
colaborador configura su propia sesión; no hay tokens en el repositorio.

El owner completa `neon login` en el navegador. Después, desde la raíz:

```bash
neon link --org-id <org-id> --project-id <project-id> --branch production --no-env-pull -y
neon config plan
# Aplicar sólo después de revisar el plan contra el alcance PostgreSQL:
neon deploy --no-env-pull
neon env pull --services postgres --file .env.neon.bootstrap.local
```

`init` combinado también instala herramientas y descarga variables. Para esta
aplicación existente se usa la alternativa manual de la skill, que conserva
`.env.local`. Antes de la configuración se respaldó ese archivo en un directorio
privado fuera de Git. `.neon` y `.env.neon.local` quedan ignorados.

Esos comandos son de bootstrap. La descarga inicial ofrece `DATABASE_URL`
pooled y `DATABASE_URL_UNPOOLED` directa del owner; se conserva privadamente
antes de preparar el perfil definitivo. `.env.neon.local` usa ahora la pooled
del rol `finance_portal_runtime` y `DATABASE_DIRECT_URL` del owner. No volver a
descargar una conexión de owner sobre ese perfil: al renovar conexiones con el
CLI se elige explícitamente el rol y la base. No modificar `DATABASE_TEST_URL`
ni ejecutar la integración sobre Neon personal.

```bash
pnpm dev:neon
# O, para servir el artefacto ya compilado:
pnpm start:neon
# Sólo para administrar las migraciones:
pnpm db:migrate:neon
```

Los servidores del perfil escuchan en `127.0.0.1`. `.env.local` y los comandos
locales originales conservan sus conexiones anteriores. Para ejecutar una
lectura existente sobre Neon se cargan ambos archivos con el perfil al final:

```bash
node --network-family-autoselection-attempt-timeout=2000 \
  --env-file=.env.local --env-file=.env.neon.local --conditions=react-server \
  --import tsx scripts/audit-point-in-time.ts --page-size 500
node --network-family-autoselection-attempt-timeout=2000 \
  --env-file=.env.local --env-file=.env.neon.local --conditions=react-server \
  --import tsx scripts/replay-valuation.ts --ticker AAPL --ticker AMZN
```

Los dos segundos ajustan el intento por dirección de Node para esta conexión
local; no cambian el timeout del proveedor, la Function ni las fórmulas. El
driver y schema siguen siendo los existentes. Vercel recibe sólo la pooled del
runtime: la directa administrativa se queda fuera de su entorno.

## Traslado verificado el 2026-10-24

Con autorización explícita del owner, se restauró un dump consistente de la
personal local sobre Neon vacío, incluyendo el journal. Las 46 tablas
coincidieron por conteo y hashes de contenido antes de probar la aplicación.
Backup y manifiesto permanecen privados fuera de Git, y la base Docker se
conserva. El respaldo del traslado es temporal; no acredita una retención de
backups de producción. La política durable se define antes del uso remoto
continuado.

`finance_portal_runtime` tiene los cuatro permisos DML sobre las 45 tablas
públicas y permisos por defecto para las futuras tablas del owner. No puede
crear tablas persistentes ni temporales, roles o bases. Se verificaron TLS y
ambas conexiones; las migraciones están al día. El gate point-in-time pasó con
28.268 cadenas y 29.086 revisiones; 10 corridas AAPL/AMZN se reprodujeron sin
divergencias. El mismo build sirve el resultado desde Neon en localhost y niega
datos bajo el entorno sin declarar. Esto no prueba la protección de Vercel.

## Primer deployment Vercel verificado el 2026-10-24

El proyecto `smaricondes-projects/finance-portal` quedó vinculado al repo con
Next.js, `pnpm install --frozen-lockfile`, `pnpm build`, Node 22.x y Functions en
`iad1`, junto a Neon en N. Virginia. Vercel Authentication usa `All Deployments`.
Antes y después del deployment personal, los hosts de producción, Git y URL
generada conocidos devolvieron `302` al login de Vercel sin credenciales en las
seis rutas del paso 1. El detalle por host se conserva en un registro privado.

Production tiene `APP_MODE=personal`, `APP_RUNTIME_ACCESS=protected`, la URL
pooled de `finance_portal_runtime`, `SEC_USER_AGENT` y las claves OpenRouter y
Tavily como Secrets sólo de Production. Preview tiene `APP_MODE=locked`, acceso
declarado `protected` y ninguna conexión ni clave de proveedor. La conexión
administrativa y la base de test no se cargaron en Vercel.

El commit `549320e` se desplegó desde un archivo Git limpio; el manifiesto no
incluyó `.env.local`, `.env.neon.local`, `.neon` ni `.vercel`. El build quedó
`READY` bajo la protección de plataforma. La página de configuración autenticada
resolvió `personal` y la lectura autenticada de AAPL respondió `200` con datos.
No se inició un job ni se midió su duración; tampoco se hizo el walkthrough.

**Comportamiento observado del CLI:** `vercel deploy --prod --skip-domain`
asignó el alias del equipo pese a la opción, pero no el dominio principal.
Después de verificar el deployment, `vercel promote` asignó también el dominio
principal; todos los hosts conocidos siguieron redirigiendo anónimos al login.
No asumir staging sin alias por esa bandera: confirmar aliases después del deploy.
`vercel curl` generó automáticamente un bypass de automatización para la lectura;
se revocó tras la prueba y el proyecto terminó con cero bypasses activos. No
volver a usar `vercel curl` en este walkthrough sin planear su revocación.

## 1. Integrar y desplegar trabado

1. Integrar el slice anterior por PR con Quality y E2E aprobados. Crear la rama
   de despliegue desde `main` actualizado y registrar su commit.
2. Importar el repositorio en el proyecto del owner. Usar Next.js, la versión de
   Node de `.nvmrc`, `pnpm install --frozen-lockfile` y `pnpm build`.
3. Configurar inicialmente `APP_MODE=locked` y `APP_RUNTIME_ACCESS=public`, sin
   DB ni claves personales, tanto en Production como en Preview. No conectar
   automáticamente una base a todos los entornos.
4. Desplegar y abrir `/`, `/configuracion`, `/valuacion`, `/valuacion/AAPL`,
   `/valuacion/referencia` y una ruta inexistente. Todas niegan datos; el
   diagnóstico muestra nombres de variables, nunca valores.

El build no aplica migraciones. No se añade cron ni una cola externa.

## 2. Verificar la protección antes de dar acceso a datos

En Settings → Deployment Protection seleccionar Vercel Authentication y
**All Deployments**. Según la documentación revisada el 2026-10-24, este alcance
está disponible en todos los planes y cubre dominios de producción y URLs
generadas. **Standard Protection excluye los dominios de producción**: no basta
para declarar `protected` en ellos. Confirmar las opciones reales de la cuenta
antes de elegir un plan.

Inventariar el dominio de producción, aliases, URL generada y previews que puedan
recibir secretos. En una ventana privada nueva, sin sesión de Vercel, comprobar
cada host y las rutas del paso 1: la plataforma debe pedir autenticación antes
de servir la aplicación. Un `200` con el diagnóstico trabado prueba el runtime,
pero no la protección de la plataforma. Repetir autenticado y comprobar que sólo
el owner autorizado accede.

Revisar también excepciones, enlaces compartibles, trusted sources y bypasses de
automatización; una URL con un bypass válido no es una prueba anónima. No crear
bypasses para este walkthrough. Los PR de forks y las previews de otras ramas no
reciben DB ni claves personales.

Registrar fecha, commit/deployment, hosts probados, alcance y resultado en un
registro privado. En el repo sólo se guarda el resultado y una referencia sin
tokens, cookies ni URLs privadas. Si falla un host, conservar `locked` y corregir
la protección antes de seguir.

## 3. Preparar PostgreSQL

Este paso ya se verificó en Neon según la ADR 0057. El checklist se conserva
para recuperación o para otro entorno autorizado:

1. Crear una base personal dedicada, compatible con las migraciones PostgreSQL
   del repo. Elegir la región de Functions junto con la de la base y registrar
   la latencia; no fijar una región por suposición.
2. Obtener conexiones TLS pooled para runtime y directa para administración.
   El runtime usa `max: 1` y `prepare: false` en
   `src/server/db/runtime-client.ts`. Verificar conexiones observadas durante
   la prueba remota; el límite de un cliente no es un límite global de Functions.
3. Separar permisos: el runtime lee y escribe los datos que usa la app; el job
   de migración conserva DDL. No instalar la conexión administrativa en Vercel.
4. Elegir **una** estrategia de datos. Para trasladar la personal, detener
   escrituras, guardar un backup privado y restaurar en una base remota vacía,
   incluyendo `drizzle.__drizzle_migrations`; después aplicar sólo migraciones
   pendientes. Para empezar vacía, migrar y constituir el universo, referencias
   y registros mediante los comandos existentes. No ejecutar ambas estrategias
   sobre el mismo destino ni copiar sólo `valuation_runs`: sus snapshots y
   relaciones dependen del resto de la base.
5. En Neon, ejecutar `pnpm db:migrate:neon`; para otro entorno, `pnpm db:migrate`
   con `DATABASE_DIRECT_URL` exportada apuntando explícitamente al destino. El
   comando original carga `.env.local`; el perfil Neon carga `.env.neon.local`.
   Revisar el destino sin imprimir credenciales. Procedimiento y recuperación en
   [migraciones](database-migrations.md).
6. Auditar point-in-time y reproducir una corrida contra el destino con los
   comandos existentes. En una base sin revisiones suficientes, un gate
   `not_exercised` no cuenta como aprobado. No ejecutar integración contra la
   personal: `DATABASE_TEST_URL` siempre es otra base desechable.

Conservar el backup fuera del repositorio. Registrar la comprobación de restore
y la identidad del destino sin credenciales; no borrar ni sustituir la base local.

## 4. Habilitar sólo el entorno verificado

| Variable                                   | Destino                                                 |
| ------------------------------------------ | ------------------------------------------------------- |
| `APP_MODE=personal`                        | Sólo el entorno protegido ya probado                    |
| `APP_RUNTIME_ACCESS=protected`             | Mismo entorno; declaración operativa del owner          |
| `DATABASE_URL`                             | Endpoint pooled personal, server-only y sensible        |
| `SEC_USER_AGENT`                           | Identificación real requerida por las fuentes SEC       |
| `OPENROUTER_API_KEY`, `TAVILY_API_KEY`     | Claves del owner, si se habilitan esas tareas           |
| `NEXT_PUBLIC_APP_URL`                      | Origen de la instancia; nunca contiene secretos         |
| `DATABASE_DIRECT_URL`, `DATABASE_TEST_URL` | Fuera de Vercel; administración y tests respectivamente |

No copiar `.env.local` entero. No habilitar claves de proveedores que el runtime
no necesita. Fijar límites de crédito en las cuentas existentes y conservar
budgets y kill switches de PostgreSQL. Redeployar después de configurar el
entorno y repetir la prueba anónima sobre todos los hosts.

## 5. Comprobar el job y recorrer el producto

Autenticado, pedir una valuación de una empresa que ya tenga corrida y otra que
requiera datos. Registrar estado, tiempo, reanudación, llamadas y gasto; repetir
el pedido no debe duplicar ingestas ni corridas del mismo snapshot. Reabrir el
resultado debe ser una lectura sin llamadas a proveedores.

El worker vive en `after()`, cuyo tiempo también está sujeto a la duración de la
Function. El presupuesto de tiempo debe medirse en el plan elegido, tanto al
pedir desde `/valuacion` como al refrescar desde `/valuacion/[ticker]`; la matriz
sectorial usa otro worker. No dar por cerrado el despliegue sólo porque renderiza
la página. Si se corta, comprobar recuperación del claim y los leases, y ajustar
únicamente las rutas necesarias o registrar la decisión de ejecución durable
antes de continuar. No aumentar un timeout global ni agregar un cron como parche.

Ejecutar las tres tareas del [walkthrough](owner-walkthrough.md) sobre el ticker
real. El owner completa tiempos y respuestas; una ejecución automatizada no
reemplaza esa sesión. El runtime sin declarar se comprueba localmente sobre el
mismo commit, y la negativa anónima se comprueba además en la plataforma remota.

## Cierre y recuperación

`F6-06` sólo pasa a `done` con ADR aceptada, DB hosteada validada, protección
probada en cada host, job remoto completo, replay y registro del owner. Quality y
E2E deben pasar antes del merge. La preparación documental no cierra ese gate.

Ante exposición, quitar el acceso al deployment en la plataforma primero,
restablecer `locked/public`, retirar secretos y redeployar. Verificar también las
URLs de deployments anteriores: cambiar variables no los modifica. Revocar
credenciales o bypasses expuestos. Ante fallo funcional sin exposición, volver a
un deployment compatible con el schema; no ejecutar SQL descendente ni borrar
observaciones como parte de volver el código atrás.

## Fuentes primarias revisadas el 2026-10-24

- [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection).
- [Duración de Functions](https://vercel.com/docs/functions/configuring-functions/duration).
- [Next.js `after`](https://nextjs.org/docs/app/api-reference/functions/after).
- [Neon: pooling](https://neon.com/docs/connect/connection-pooling) y
  [migración con dump/restore](https://neon.com/docs/import/migrate-from-postgres),
  sólo como documentación del candidato.
