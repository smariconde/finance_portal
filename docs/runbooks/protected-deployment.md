# Despliegue personal protegido

- Slice: `F6-06`; controles `TM-14`, `TM-01`, `TM-02` y `UI-02`.
- Estado: preparación; sin recurso remoto provisionado ni protección verificada.
- Contrato: [ADR 0008](../architecture/adr/0008-remote-personal-access.md).

## Decisión pendiente

Antes de crear recursos, registrar en una ADR el proveedor PostgreSQL elegido,
región, plan y límite de gasto, recuperación disponible, roles de runtime y
migración, y si se trasladará la base personal o se constituirá otra. La ADR 0008
exige esa decisión para la dependencia hosteada. El destino previsto es Vercel;
crear un proyecto no confirma que su URL esté protegida.

La propuesta a revisar es Vercel con **Vercel Authentication / All Deployments**
y PostgreSQL con endpoint pooled y directo. Neon es un candidato, no una
dependencia elegida. No se instalan integraciones ni se aceptan planes en esta
preparación.

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

Una vez aceptada la ADR del hosting:

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
5. Ejecutar `pnpm db:migrate` desde un entorno administrativo con
   `DATABASE_DIRECT_URL` apuntando explícitamente al destino. El script carga
   `.env.local`; una variable ya exportada tiene prioridad. Revisar el destino
   sin imprimir credenciales. Procedimiento y recuperación en
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
