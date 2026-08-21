# ADR 0002: modos de runtime, persistencia durable y exposición de datos

- Estado: aceptado
- Fecha: 2026-08-21
- Alcance: Fase 0B.5
- Decisiones relacionadas: [ADR 0001](0001-stack-cache-postgres.md) y
  [matriz de uso de proveedores](../../data/provider-use-matrix.md)

## Contexto

El repositorio es público, pero la instancia con datos reales pertenece a un único
owner. El mismo artefacto debe servir una demo anónima reproducible y una instancia
personal sin incorporar login, cuentas, sesiones, multi-tenancy ni BYOK.

`APP_MODE` ya distinguía `demo | personal`, pero por sí solo no demostraba que el
destino personal fuera privado. También faltaba fijar qué estado es durable, qué puede
cruzar al browser y cómo falla una combinación insegura.

Vercel separa Production y Preview. Standard Protection protege previews y deployment
URLs, pero no el production domain; proteger todos los dominios requiere un alcance de
protección superior. Además, Vercel Cron invoca exclusivamente Production. Mientras
Production sea la demo pública, no puede ejecutar ingestas personales mediante Cron.

## Decisión

### Dos ejes server-only

El runtime se resuelve exclusivamente en servidor con dos variables:

- `APP_MODE=demo | personal`: datos y capacidades solicitadas.
- `APP_RUNTIME_ACCESS=public | local | protected`: límite operativo declarado.

`APP_RUNTIME_ACCESS` no se expone con `NEXT_PUBLIC_` y no reemplaza la protección real
de plataforma. Es una atestación del operador que el checklist de despliegue debe
verificar externamente. `NEXT_PUBLIC_APP_URL`, `Host`, `Origin`, headers reenviados y la
presencia de una key no prueban privacidad.

Una combinación inválida nunca intenta “arreglar” `personal`: el modo efectivo pasa a
`demo`, las capacidades live quedan deshabilitadas y health informa el nombre de la
variable problemática sin devolver su valor.

| Modo solicitado  | Acceso declarado   | Runtime           | Modo efectivo    | Motivo                                           |
| ---------------- | ------------------ | ----------------- | ---------------- | ------------------------------------------------ |
| ausente o `demo` | ausente o `public` | cualquiera        | `demo`           | default seguro                                   |
| inválido         | cualquiera         | cualquiera        | `demo` degradado | schema cerrado                                   |
| `personal`       | ausente o `public` | cualquiera        | `demo` degradado | una URL pública no puede servir datos personales |
| `personal`       | `local`            | fuera de Vercel   | `personal`       | instancia controlada por el owner                |
| `personal`       | `local`            | Vercel            | `demo` degradado | una Function desplegada no es localhost          |
| `personal`       | `protected`        | Vercel Preview    | `personal`       | requiere Vercel Authentication verificada        |
| `personal`       | `protected`        | Vercel Production | `demo` degradado | Production permanece pública y fixture-only      |
| `personal`       | `protected`        | otro runtime      | `demo` degradado | protección no verificable por este contrato      |

La detección de Vercel usa sus variables de sistema `VERCEL=1` y
`VERCEL_ENV=preview | production`. Esto sólo evita combinaciones incoherentes; no
consulta ni certifica la configuración de Deployment Protection.

### Topología autorizada

| Destino                    | Variables                                           | Datos                | Persistencia                           | Capacidades live                     |
| -------------------------- | --------------------------------------------------- | -------------------- | -------------------------------------- | ------------------------------------ |
| demo local o pública       | `APP_MODE=demo`, `APP_RUNTIME_ACCESS=public`        | fixtures versionados | ninguna mutación durable del visitante | ninguna                              |
| personal local             | `APP_MODE=personal`, `APP_RUNTIME_ACCESS=local`     | snapshots del owner  | PostgreSQL                             | sólo módulos cuyo gate esté aprobado |
| personal Preview protegido | `APP_MODE=personal`, `APP_RUNTIME_ACCESS=protected` | snapshots del owner  | PostgreSQL                             | refresh manual; sin Vercel Cron      |
| Vercel Production          | `APP_MODE=demo`, `APP_RUNTIME_ACCESS=public`        | fixtures versionados | sin datos personales                   | ninguna                              |

No se crea una tercera modalidad “public-live”. Tampoco se comparte una base personal
con una demo para seleccionar filas mediante filtros: el modo demo no abre el repository
personal. Una futura Production protegida, URL live para terceros o plataforma distinta
requiere otra ADR y revisión contractual/regulatoria.

### Matriz de capacidades

| Capacidad                         | `demo`        | `personal`                                            |
| --------------------------------- | ------------- | ----------------------------------------------------- |
| leer fixtures versionados         | permitido     | sólo para tests o ejemplos explícitos                 |
| leer/escribir snapshots del owner | deshabilitado | permitido con PostgreSQL y fase aprobada              |
| llamar proveedores financieros    | deshabilitado | permitido sólo por adaptador aprobado                 |
| refresh manual                    | deshabilitado | permitido con presupuesto, idempotencia y audit trail |
| Vercel Cron live                  | deshabilitado | diferido mientras Production sea demo                 |
| mutaciones persistentes           | deshabilitado | permitido por casos de uso acotados                   |
| IA/research                       | deshabilitado | diferido a Fase 7 con budget y data map               |
| export                            | sólo fixtures | sólo campos y fuentes autorizados por la matriz       |

La presencia de DB o credenciales no cambia esta tabla. Cada capacidad necesita dos
condiciones: modo efectivo `personal` y módulo `ready` según su gate.

## Persistencia durable

### Fuentes de verdad

- `demo`: fixtures sintéticos, deterministas y versionados en el repositorio.
- `personal`: PostgreSQL para snapshots, provenance, ingestas, uso/cuota, valuaciones y
  estado durable del owner.
- Cache Components: proyección derivada y descartable; nunca persistencia.
- Variables de entorno: configuración y secretos, nunca datos financieros.
- Browser storage: tema, densidad y borradores no sensibles; nunca cache financiero,
  credenciales, provider raw ni snapshot autoritativo.

Las clases `R0` a `R4` de la matriz de proveedores rigen raw, operaciones,
normalizados y trazas IA. Backups heredan licencia, retención y borrado. Una fuente
revocada puede exigir borrado físico; si se permite, queda un tombstone sin contenido
para explicar la discontinuidad.

### Aislamiento de modo

- Los fixtures no contienen payloads capturados, IDs privados ni hashes reversibles de
  datos personales.
- Una cache key o tag incluye el modo efectivo y nunca puede devolver una entrada de
  `personal` a `demo`.
- El repository se selecciona en composición server-only; el browser no elige backend
  enviando `mode=personal`.
- Un export o backup personal se genera fuera de la ruta demo y conserva atribución,
  licencia y provenance.
- Invalidar cache no borra Postgres, reinicia cuota ni modifica retención.

## Límite de exposición

| Frontera                      | Permitido                                                                        | Prohibido                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| repositorio público           | código, schemas, migraciones, fixtures sintéticos y docs                         | `.env*` reales, dumps, recordings, payloads licenciados, exports y logs personales             |
| HTML/RSC                      | DTO minimizado, source ID, fechas, unidad, quality y valores permitidos por modo | secretos, URLs de DB, headers, provider raw, prompts internos y trazas privadas                |
| props a Client Components     | datos de presentación estrictamente necesarios                                   | objetos de repositorio, contratos de proveedor, credentials o flags de autorización confiables |
| Route Handlers/Server Actions | envelope seguro, request ID y errores tipados                                    | stack traces, SQL, payload externo, existencia de secretos o detalles de protección            |
| logs/traces                   | modo efectivo, módulo, operación, métricas y IDs opacos                          | keys, cookies, Authorization, prompts completos, documentos y valores de env                   |
| cache/tags                    | IDs estables, modo, dataset, versión y parámetros normalizados                   | texto libre sensible, tokens, URLs firmadas y provider raw                                     |
| IA/research                   | hechos mínimos y evidence IDs autorizados                                        | raw licenciado, datos personales, secretos, portfolio o tesis privada no necesaria             |

Los Route Handlers y Server Actions se tratan como endpoints públicos aunque la UI no
los enlace. El check de modo ocurre en la frontera web y se repite en el servicio de
aplicación para impedir bypass por una nueva ruta.

Política de respuesta futura:

- una ruta live/IA/cron en `demo` responde `404 capability_not_available` sin efectos;
- una mutación demo invocada desde UI retorna un resultado tipado `disabled`;
- un módulo personal sin gate o configuración responde `503 module_disabled`;
- credencial de cron ausente o inválida responde `401` antes de reclamar un job;
- validación usa Zod, tamaño acotado y mensajes sin eco del input sensible.

## Cron y trabajo programado

- No se agrega `vercel.json` ni cron en esta fase.
- Vercel Cron sólo invoca Production y Production es `demo`; por lo tanto, un cron live
  sería una contradicción de configuración.
- El primer modo personal usa refresh manual y jobs acotados.
- Un cron futuro requiere destino protegido compatible, `CRON_SECRET` de al menos 16
  caracteres, comparación `Authorization: Bearer`, idempotencia, lock, cursor, breaker y
  recuperación manual. La protección de plataforma no reemplaza el secreto del endpoint.

## Secretos y configuración

- Sólo `NEXT_PUBLIC_APP_NAME` y `NEXT_PUBLIC_APP_URL` pueden cruzar al bundle; no son
  controles de seguridad.
- DB, cron, providers e IA usan nombres server-only e imports `server-only`.
- En Vercel Preview/Production, las keys y URLs de DB se marcan Sensitive. Cambiar una
  variable requiere redeploy para afectar un deployment existente.
- Production demo no recibe provider keys, `DATABASE_URL` personal ni `CRON_SECRET`.
- Preview personal usa secretos distintos de cualquier futuro entorno productivo.

## Implementación inicial

Este slice incorpora el contrato sin integrar DB ni proveedores:

- `.env.example` agrega `APP_RUNTIME_ACCESS=public` como default seguro;
- `getConfigHealth()` devuelve modo efectivo y acceso declarado;
- `personal` sin frontera privada válida cae a `demo`;
- Vercel Production no puede activar `personal`;
- tests cubren local, Preview protegido, Production y no exposición de secretos.

La implementación de un guard reutilizable para Route Handlers y Server Actions se
difiere al primer slice que cree una de esas fronteras.

## Consecuencias

### Positivas

- Una variable `APP_MODE=personal` mal copiada a Production no publica datos live.
- El browser no controla el repository ni la capacidad efectiva.
- Demo y personal comparten código sin compartir estado, cache o secretos.
- La ausencia de cron live es explícita y no una promesa operativa incumplida.

### Costos y riesgos

- `APP_RUNTIME_ACCESS=protected` sigue siendo una declaración y exige verificación
  externa de Vercel Authentication.
- Preview protegido no recibe Vercel Cron; el owner comienza con refresh manual.
- Mantener Production fixture-only impide usarla como instancia personal hasta una nueva
  decisión y, posiblemente, un plan de protección distinto.
- Cada endpoint futuro debe aplicar el guard y pruebas de matriz, no sólo confiar en UI.

## Alternativas descartadas

- **Sólo `APP_MODE`:** no expresa si el deployment es público o privado.
- **Detectar privacidad por hostname/headers:** son señales manipulables y no prueban
  Deployment Protection.
- **Agregar auth propia:** contradice el alcance single-owner y aumenta superficie.
- **Compartir Postgres y filtrar por modo:** un error de query podría filtrar datos
  personales a la demo.
- **Habilitar cron en Production demo:** Vercel lo ejecutaría en el entorno equivocado.
- **Guardar snapshots en browser o cache Next.js:** no es durable ni server-only.

## Verificación requerida

En este slice:

- unit tests de resolución `demo | personal` y `public | local | protected`;
- health y UI no muestran valores secretos;
- `.env.example`, arquitectura y runbook usan el mismo contrato;
- format, lint, typecheck, tests y build pasan.

Antes del primer Preview personal:

- comprobar Vercel Authentication sobre la URL exacta y una request anónima;
- comprobar que Production devuelve demo y no tiene keys/DB personal;
- confirmar que previews de forks no reciben secretos;
- ejecutar tests de aislamiento de repository/cache cuando existan;
- registrar owner, fecha y evidencia de protección sin guardar cookies ni tokens.

## Fuentes primarias

- [Vercel: Deployment Protection](https://vercel.com/docs/deployment-protection)
- [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
- [Vercel: variables sensibles](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- [Vercel: Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Vercel: asegurar y operar cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Next.js: variables de entorno](https://nextjs.org/docs/app/guides/environment-variables)
- [Next.js: Server/Client Components y `server-only`](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js: seguridad de Route Handlers y Server Actions](https://nextjs.org/docs/app/guides/authentication)

## Revisar esta decisión cuando

- Production pueda quedar protegida bajo un plan y alcance verificados;
- se elija un scheduler que pueda invocar el runtime personal;
- aparezca el primer Route Handler, Server Action o export personal;
- el producto incorpore otro usuario o datos live para terceros;
- cambie el contrato de Deployment Protection o las variables de sistema de Vercel.
